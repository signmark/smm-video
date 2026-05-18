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
   * Performs admin authentication
   */
  private async authenticate(): Promise<string | null> {
    try {
      // Try static token first (prefer dev token in Replit dev environment)
      const staticToken = process.env.ADMIN_TOKEN || process.env.DIRECTUS_DEV_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
      if (staticToken) {
        this.adminToken = staticToken;
        this.tokenTimestamp = Date.now();
        return staticToken;
      }

      // Fallback to login
      const email = process.env.DIRECTUS_ADMIN_EMAIL;
      const password = process.env.DIRECTUS_ADMIN_PASSWORD;
      const directusUrl = process.env.DIRECTUS_URL;

      if (email && password && directusUrl) {
        const authResponse = await axios.post(`${directusUrl}/auth/login`, {
          email,
          password
        });

        if (authResponse.data?.data?.access_token) {
          this.adminToken = authResponse.data.data.access_token;
          this.tokenTimestamp = Date.now();
          log('Admin token obtained successfully', 'admin-token-manager');
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