import { NextResponse } from 'next/server';
import { getSession, unauthorized, listOAuthProviders } from '@/services/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return unauthorized();

  const providers = await listOAuthProviders(session.user.id);
  return NextResponse.json({
    providers,
    githubLinked: providers.includes('github'),
  });
}
