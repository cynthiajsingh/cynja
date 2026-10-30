// Server-only configuration. Reads Netlify/Node environment variables first, then
// Astro's import.meta.env (which carries .env values during `astro dev`).
// Nothing here is ever imported by client-side code.

type EnvBag = Record<string, string | boolean | undefined>;
const metaEnv: EnvBag = (import.meta as unknown as { env?: EnvBag }).env ?? {};

export function env(name: string): string | undefined {
  const fromProcess = typeof process !== 'undefined' ? process.env[name] : undefined;
  const value = fromProcess ?? metaEnv[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function isProduction(): boolean {
  if (typeof metaEnv.PROD === 'boolean') return metaEnv.PROD;
  return env('NODE_ENV') === 'production';
}

export function databaseUrl(): string | undefined {
  return env('NETLIFY_DATABASE_URL') ?? env('DATABASE_URL');
}

const DEV_SECRET = 'dev-only-insecure-session-secret-do-not-use-in-production';

export function sessionSecret(): string {
  const secret = env('SESSION_SECRET');
  if (secret && secret.length >= 32) return secret;
  if (isProduction()) {
    throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters.');
  }
  return secret ?? DEV_SECRET;
}

/** Development/test only: where the embedded database and local media live. */
export function localDataDir(): string {
  return env('LOCAL_DATA_DIR') ?? '.data';
}

export function mediaStorageKind(): 'netlify-blobs' | 'local' {
  const kind = env('MEDIA_STORAGE');
  if (kind === 'local' || kind === 'netlify-blobs') return kind;
  return isProduction() ? 'netlify-blobs' : 'local';
}
