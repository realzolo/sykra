import { NextRequest, NextResponse } from 'next/server';

const ORG_COOKIE = 'org_id';
const ORG_PATH_PREFIX = '/o';
const ORG_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DASHBOARD_PREFIXES = ['/projects', '/reports', '/rules', '/settings'];
const PUBLIC_PREFIXES = ['/login', '/auth', '/invite', '/privacy', '/terms'];

function isPublicPath(pathname: string) {
  if (pathname === '/') return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isDashboardPath(pathname: string) {
  return DASHBOARD_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (pathname.startsWith(`${ORG_PATH_PREFIX}/`)) {
    const parts = pathname.split('/').filter(Boolean);
    const orgId = parts[1];
    if (orgId && ORG_ID_RE.test(orgId)) {
      const response = NextResponse.next();
      response.cookies.set(ORG_COOKIE, orgId, {
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
        sameSite: 'lax',
      });
      return response;
    }
  }

  const orgId = request.cookies.get(ORG_COOKIE)?.value;
  if (orgId && ORG_ID_RE.test(orgId) && isDashboardPath(pathname)) {
    const nextUrl = request.nextUrl.clone();
    nextUrl.pathname = `${ORG_PATH_PREFIX}/${orgId}${pathname}`;
    return NextResponse.redirect(nextUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
