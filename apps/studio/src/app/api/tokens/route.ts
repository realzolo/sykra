import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';
import { requireUser, unauthorized } from '@/services/auth';
import { getActiveOrgId } from '@/services/orgs';
import { query, queryOne, exec } from '@/lib/db';
import { createInMemoryRateLimiter, RATE_LIMITS } from '@/middleware/rateLimit';
import { formatErrorResponse } from '@/services/retry';

export const dynamic = 'force-dynamic';

const rateLimiter = createInMemoryRateLimiter(RATE_LIMITS.general);

const VALID_SCOPES = ['read', 'write', 'pipeline:trigger'] as const;
type Scope = typeof VALID_SCOPES[number];

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  // Format: sax_<32 random hex bytes>
  return 'sax_' + crypto.randomBytes(32).toString('hex');
}

// GET /api/tokens — list tokens for current user+org
export async function GET(request: NextRequest) {
  const rl = rateLimiter(request);
  if (rl) return rl;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();

    const tokens = await query<{
      id: string;
      name: string;
      token_prefix: string;
      scopes: string[];
      last_used_at: string | null;
      expires_at: string | null;
      created_at: string;
    }>(
      `select id, name, token_prefix, scopes, last_used_at, expires_at, created_at
       from api_tokens
       where user_id = $1 and org_id = $2
       order by created_at desc`,
      [user.id, orgId]
    );

    return NextResponse.json({ tokens });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}

// POST /api/tokens — create a new token
export async function POST(request: NextRequest) {
  const rl = rateLimiter(request);
  if (rl) return rl;

  const user = await requireUser();
  if (!user) return unauthorized();

  try {
    const orgId = await getActiveOrgId(user.id, user.email ?? undefined, request);
    if (!orgId) return unauthorized();

    const body = await request.json().catch(() => ({}));
    const name = String(body?.name ?? '').trim();
    const rawScopes: unknown[] = Array.isArray(body?.scopes) ? body.scopes : ['read'];

    if (!name) {
      return NextResponse.json({ error: 'name_required' }, { status: 400 });
    }
    if (name.length > 100) {
      return NextResponse.json({ error: 'name_too_long' }, { status: 400 });
    }

    const scopes = rawScopes.filter(
      (s): s is Scope => typeof s === 'string' && VALID_SCOPES.includes(s as Scope)
    );
    if (scopes.length === 0) {
      return NextResponse.json({ error: 'scopes_required' }, { status: 400 });
    }

    // Cap at 20 tokens per user per org
    const countRow = await queryOne<{ count: string }>(
      `select count(*)::text as count from api_tokens where user_id = $1 and org_id = $2`,
      [user.id, orgId]
    );
    if (Number(countRow?.count ?? 0) >= 20) {
      return NextResponse.json({ error: 'token_limit_reached' }, { status: 422 });
    }

    const plaintext = generateToken();
    const tokenHash = hashToken(plaintext);
    const tokenPrefix = plaintext.slice(0, 12); // "sax_" + first 8 hex chars

    await exec(
      `insert into api_tokens (user_id, org_id, name, token_hash, token_prefix, scopes)
       values ($1, $2, $3, $4, $5, $6)`,
      [user.id, orgId, name, tokenHash, tokenPrefix, scopes]
    );

    // Return plaintext ONCE — never stored
    return NextResponse.json({ token: plaintext, prefix: tokenPrefix, name, scopes }, { status: 201 });
  } catch (err) {
    const { error, statusCode } = formatErrorResponse(err);
    return NextResponse.json({ error }, { status: statusCode });
  }
}
