import { NextResponse, type NextRequest } from 'next/server';

/**
 * Realm-prefixed session cookies (§4.1 — separate web realms). Two realms
 * share this one Next app under the locked guiding decision (Admin Ops is
 * `/admin/*` routes here, not a new app) — the middleware branches on path
 * prefix instead of running two separate middlewares, and each realm's cookie
 * is checked only against its own routes so neither can authenticate the
 * other's pages.
 */
const SESSION_COOKIE = 'fleet_session';
const ADMIN_SESSION_COOKIE = 'admin_session';

function redirectTo(request: NextRequest, pathname: string, preserveNext = false): NextResponse {
  const url = request.nextUrl.clone();
  const from = url.pathname;
  url.pathname = pathname;
  url.search = '';
  if (preserveNext && from !== '/') url.searchParams.set('next', from);
  return NextResponse.redirect(url);
}

/**
 * §11.7's share-trip page — the ONE public route in this app (Phase 18).
 *
 * THIS MIDDLEWARE IS DENY-BY-DEFAULT, which is the right posture for a fleet
 * console and is exactly why the share page needs an explicit branch: without
 * it, `/t/{token}` redirects to `/login`, and a customer's spouse following a
 * link at nine at night is asked for a fleet-owner password. The failure is
 * silent in development — anyone testing while logged in never sees it — which
 * is what makes it worth naming here rather than leaving to the matcher.
 *
 * A PREFIX, NOT A REGEX OVER THE TOKEN. The route itself validates the token's
 * shape and the API validates it again; a middleware that tried to would be a
 * third place the format lives.
 */
const PUBLIC_PREFIXES = ['/t/'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  if (pathname === '/admin' || pathname === '/admin/login' || pathname.startsWith('/admin/')) {
    const hasSession = request.cookies.has(ADMIN_SESSION_COOKIE);
    const isLogin = pathname === '/admin/login';

    if (!hasSession && !isLogin) return redirectTo(request, '/admin/login', true);
    if (hasSession && isLogin) return redirectTo(request, '/admin/drivers');
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(SESSION_COOKIE);
  const isLogin = pathname === '/login';

  if (!hasSession && !isLogin) return redirectTo(request, '/login', true);
  if (hasSession && isLogin) return redirectTo(request, '/');
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
