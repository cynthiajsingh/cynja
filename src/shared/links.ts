// Link validation shared by the editor's link dialog and the server-side sanitizer.

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * Turns user input into a safe href, or returns null when it is not allowed.
 * Accepts absolute http(s)/mailto/tel URLs, site-relative paths, #anchors and bare domains.
 */
export function normalizeHref(input: string): string | null {
  const value = input.trim();
  if (!value || value.length > 2048) return null;
  // Control characters and whitespace are how `java\tscript:`-style tricks get through.
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return null;
  if (value.startsWith('#')) return /^#[\w-]*$/.test(value) ? value : null;
  if (value.startsWith('//') || value.startsWith('\\')) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  if ((url.protocol === 'http:' || url.protocol === 'https:') && !/\./.test(url.hostname) && url.hostname !== 'localhost') {
    return null;
  }
  return url.href;
}

export function isExternalHref(href: string, siteOrigin: string): boolean {
  if (!/^https?:/i.test(href)) return false;
  try {
    return new URL(href).origin !== new URL(siteOrigin).origin;
  } catch {
    return true;
  }
}
