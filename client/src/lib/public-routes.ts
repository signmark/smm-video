export const PUBLIC_ROUTES = [
  '/login',
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/payment/success',
  '/payment/cancel',
  '/help',
  '/pricing',
];

export function isPublicRoute(pathname = window.location.pathname): boolean {
  return PUBLIC_ROUTES.some(p => pathname === p || pathname.startsWith(`${p}/`));
}

export function redirectToLogin(): void {
  if (!isPublicRoute()) {
    window.location.href = '/login';
  }
}
