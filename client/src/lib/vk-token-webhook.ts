function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function prepareVkTokenWebhook(campaignId: string): Promise<string | null> {
  const response = await fetch(`/api/vk/token-webhook/${campaignId}/prepare`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!response.ok) return null;

  const data = await response.json();
  return typeof data?.webhookUrl === 'string' ? data.webhookUrl : null;
}

export async function getVkTokenWebhookStatus(
  campaignId: string,
): Promise<{ ready?: boolean } | null> {
  const response = await fetch(`/api/vk/token-webhook/${campaignId}/status`, {
    headers: authHeaders(),
  });
  if (!response.ok) return null;
  return response.json();
}
