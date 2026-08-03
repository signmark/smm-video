export interface ServerConfig {
  directusUrl: string;
  environment: 'development' | 'production';
  logLevel: string;
  debugScheduler: boolean;
  verboseLogs: boolean;
}

let configRequest: Promise<ServerConfig> | null = null;

async function fetchServerConfig(): Promise<ServerConfig> {
  const response = await fetch('/api/config');
  if (!response.ok) {
    throw new Error(`Failed to load server config: ${response.status}`);
  }
  return response.json() as Promise<ServerConfig>;
}

export function getServerConfig(): Promise<ServerConfig> {
  if (!configRequest) {
    const request = fetchServerConfig();
    configRequest = request;
    request.catch(() => {
      if (configRequest === request) configRequest = null;
    });
  }
  return configRequest;
}

export function refreshServerConfig(): Promise<ServerConfig> {
  configRequest = null;
  return getServerConfig();
}

export function resetServerConfigForTests() {
  configRequest = null;
}
