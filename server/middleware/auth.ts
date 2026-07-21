/**
 * Compatibility alias for routes that still import the legacy middleware name.
 * Authentication is authoritative: every bearer session is validated through
 * Directus before the request can proceed.
 */
export { authenticateUser as authMiddleware } from './user-auth';
