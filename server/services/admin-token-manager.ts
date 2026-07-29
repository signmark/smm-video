/**
 * Singleton service for managing admin tokens to prevent duplicate authentication calls
 */

import { log } from '../utils/logger';
import axios from 'axios';

class AdminTokenManager {
  private static instance: AdminTokenManager;
  private adminToken: string | null = null;
  private tokenTimestamp: number = 0;
  private readonly tokenExpirationMs = 30 * 60 * 1000; // 30 minutes
  private isAuthenticating = false;
  private authPromise: Promise<string | null> | null = null;

  private constructor() {}

  public static getInstance(): AdminTokenManager {
    if (!AdminTokenManager.instance) {
      AdminTokenManager.instance = new AdminTokenManager();
    }
    return AdminTokenManager.instance;
  }

  /**
   * Gets a valid admin token, authenticating if necessary
   */
  public async getAdminToken(): Promise<string | null> {
    // Check if we have a valid cached token
    if (this.adminToken && (Date.now() - this.tokenTimestamp) < this.tokenExpirationMs) {
      return this.adminToken;
    }

    // If authentication is already in progress, wait for it
    if (this.isAuthenticating && this.authPromise) {
      return this.authPromise;
    }

    // Start authentication
    this.isAuthenticating = true;
    this.authPromise = this.authenticate();
    
    try {
      const token = await this.authPromise;
      return token;
    } finally {
      this.isAuthenticating = false;
      this.authPromise = null;
    }
  }

  /**
   * Проверяет, что статический токен ещё принимается Directus.
   * Дешёвый запрос /users/me: 200 → жив, иначе (401 протух / отозван) → нет.
   */
  private async isStaticTokenValid(token: string): Promise<boolean> {
    const directusUrl = process.env.DIRECTUS_URL;
    if (!directusUrl) return false;
    try {
      const r = await axios.get(`${directusUrl}/users/me?fields=id`, {
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: () => true,
      });
      return r.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Performs admin authentication
   */
  private async authenticate(): Promise<string | null> {
    try {
      const directusUrl = process.env.DIRECTUS_URL;

      // Статический сервисный токен используем ТОЛЬКО если он живой. Раньше его
      // брали безусловно; когда он протухал (INVALID_CREDENTIALS), все админские
      // операции падали 401, а рабочий вход по email/паролю не задействовался —
      // именно из-за этого не грузился список пользователей и фоновые задачи.
      const staticToken = process.env.DIRECTUS_STATIC_TOKEN;
      if (staticToken && await this.isStaticTokenValid(staticToken)) {
        this.adminToken = staticToken;
        this.tokenTimestamp = Date.now();
        return staticToken;
      }
      if (staticToken) {
        log('Статический admin-токен недействителен — вхожу по email/паролю', 'admin-token-manager');
      }

      // Fallback to login (рабочий путь, когда статик-токен протух/не задан)
      const email = process.env.DIRECTUS_ADMIN_EMAIL;
      const password = process.env.DIRECTUS_ADMIN_PASSWORD;

      if (email && password && directusUrl) {
        const authResponse = await axios.post(`${directusUrl}/auth/login`, {
          email,
          password,
          mode: 'json',
        });

        if (authResponse.data?.data?.access_token) {
          this.adminToken = authResponse.data.data.access_token;
          this.tokenTimestamp = Date.now();
          log('Admin token obtained via login', 'admin-token-manager');
          return this.adminToken;
        }
      }

      log('Failed to obtain admin token', 'admin-token-manager');
      return null;
    } catch (error: any) {
      log(`Error during admin authentication: ${error.message}`, 'admin-token-manager');
      return null;
    }
  }

  /**
   * Clears the cached token
   */
  public clearToken(): void {
    this.adminToken = null;
    this.tokenTimestamp = 0;
  }
}

export const adminTokenManager = AdminTokenManager.getInstance();