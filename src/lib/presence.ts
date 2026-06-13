export function isRecentlyOnline(value?: string) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() < 60_000;
}
