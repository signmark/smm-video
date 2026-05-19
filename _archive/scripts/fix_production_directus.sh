#!/bin/bash
# Quick fix for production Directus URL issue

echo "=== Fixing Production Directus URL ==="

# Copy the fixed directus.ts file to production server
echo "Updating client/src/lib/directus.ts..."

# Create the fix content
cat > /tmp/directus_fix.ts << 'EOF'
import axios from 'axios';
import { useAuthStore } from './store';

export const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_URL || 'https://directus.roboflow.tech';

export const directusApi = axios.create({
  baseURL: DIRECTUS_URL,
  headers: {
    'Content-Type': 'application/json',
  }
});

// Add request interceptor to handle auth token
directusApi.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers = {
        ...config.headers,
        'Authorization': `Bearer ${token}`
      };
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor to handle errors
directusApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    // If we get a 401 error and have a refresh token, try to refresh the access token
    if (error.response?.status === 401) {
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        try {
          const response = await axios.post(`${DIRECTUS_URL}/auth/refresh`, {
            refresh_token: refreshToken,
            mode: 'json'
          });

          const { access_token } = response.data.data;
          localStorage.setItem('auth_token', access_token);

          // Update auth store
          const auth = useAuthStore.getState();
          auth.setAuth(access_token, auth.userId);

          // Retry original request
          const originalRequest = error.config;
          originalRequest.headers['Authorization'] = `Bearer ${access_token}`;
          return axios(originalRequest);
        } catch (refreshError) {
          // If refresh fails, clear auth and throw error
          localStorage.removeItem('auth_token');
          localStorage.removeItem('refresh_token');
          const auth = useAuthStore.getState();
          auth.clearAuth();
          throw new Error('Session expired. Please log in again.');
        }
      }
    }

    // For other errors, throw with meaningful message
    const message = error.response?.data?.errors?.[0]?.message || 
                   error.response?.data?.error?.message ||
                   error.message ||
                   'An error occurred';
    throw new Error(message);
  }
);
EOF

echo "✓ Fix prepared"
echo "Now run: scp /tmp/directus_fix.ts root@nplanner.ru:/root/smm/client/src/lib/directus.ts"
echo "Then: docker-compose restart smm"