// lib/apiBase.ts: decides the backend's base URL. No React Native imports,
// so it can be unit-tested with plain Node (see apiBase.test.ts).

export type ApiBaseInput = {
  /** process.env.EXPO_PUBLIC_API_URL, e.g. "http://192.168.1.20:5001". */
  envUrl?: string;
  isDev: boolean;
  platform: string; // 'web' | 'ios' | 'android'
  /** Metro's host as Expo reports it, e.g. "192.168.1.20:8081" (dev only). */
  hostUri?: string | null;
  /** Backend port for the dev fallback. */
  devPort?: number;
};

/** "http(s)://host[:port]" with no path; a trailing slash is tolerated. */
function normalise(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`EXPO_PUBLIC_API_URL is not a valid URL: "${url}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`EXPO_PUBLIC_API_URL must start with http:// or https:// (got "${url}")`);
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`EXPO_PUBLIC_API_URL must be the server's base URL without a path, e.g. "http://192.168.1.20:5001" (got "${url}"); /api is added automatically`);
  }
  return parsed.origin;
}

/**
 * The backend's base URL (no trailing slash, no /api):
 *   1. EXPO_PUBLIC_API_URL, if set (any build)
 *   2. development only: web -> http://localhost:<port>;
 *      device/emulator -> the dev machine's LAN address from Metro, port <port>
 *   3. otherwise an error: a release build must say where the API is
 */
export function resolveApiBase({ envUrl, isDev, platform, hostUri, devPort = 5001 }: ApiBaseInput): string {
  if (envUrl && envUrl.trim()) return normalise(envUrl);

  if (isDev) {
    if (platform === 'web') return `http://localhost:${devPort}`;
    const host = hostUri ? hostUri.split(':')[0] : '';
    if (host) return `http://${host}:${devPort}`;
    throw new Error(
      'Could not work out the backend address for this device. Set EXPO_PUBLIC_API_URL in mobile/.env (see mobile/.env.example) and restart Expo.'
    );
  }

  throw new Error('EXPO_PUBLIC_API_URL is not set. Release builds need it (see mobile/.env.example).');
}
