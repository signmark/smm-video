export function sanitizeFacebookAccount(account: any) {
  return {
    id: account?.id,
    name: account?.name,
    category: account?.category,
    tasks: account?.tasks,
    link: account?.link,
    fan_count: Number(account?.fan_count || 0),
    hasAccessToken: Boolean(account?.access_token),
  };
}

export function sanitizeInstagramAccount(account: any) {
  return {
    instagramId: account?.instagramId,
    username: account?.username,
    name: account?.name,
    pageId: account?.pageId,
    pageName: account?.pageName,
  };
}
