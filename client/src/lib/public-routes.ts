export const PUBLIC_ROUTES = [
  '/login',
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/payment/success',
  '/payment/cancel',
];

export function isPublicRoute(): boolean {
  return PUBLIC_ROUTES.some(p => window.location.pathname === p || window.location.pathname.startsWith(p + '?'));
}

export function redirectToLogin(): void {
  if (!isPublicRoute()) {
    window.location.href = '/login';
  }
}
