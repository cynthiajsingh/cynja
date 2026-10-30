// Media embeds are limited to an allowlist of providers. Articles store only
// { provider, id }; the iframe URL is always rebuilt from these templates, so
// no author-supplied URL or HTML ever reaches an iframe.

export const EMBED_PROVIDERS = ['youtube', 'vimeo', 'loom', 'spotify'] as const;
export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];

export interface EmbedRef {
  provider: EmbedProvider;
  id: string;
}

const ID_PATTERNS: Record<EmbedProvider, RegExp> = {
  youtube: /^[\w-]{11}$/,
  vimeo: /^\d{6,12}$/,
  loom: /^[a-f0-9]{32}$/,
  spotify: /^(episode|track|show|playlist|album)\/[A-Za-z0-9]{22}$/,
};

export const EMBED_HOSTS = ['www.youtube-nocookie.com', 'player.vimeo.com', 'www.loom.com', 'open.spotify.com'];

export function isValidEmbed(ref: { provider?: unknown; id?: unknown }): ref is EmbedRef {
  return (
    typeof ref.provider === 'string' &&
    (EMBED_PROVIDERS as readonly string[]).includes(ref.provider) &&
    typeof ref.id === 'string' &&
    ID_PATTERNS[ref.provider as EmbedProvider].test(ref.id)
  );
}

export function embedSrc(ref: EmbedRef): string {
  switch (ref.provider) {
    case 'youtube': return `https://www.youtube-nocookie.com/embed/${ref.id}`;
    case 'vimeo': return `https://player.vimeo.com/video/${ref.id}`;
    case 'loom': return `https://www.loom.com/embed/${ref.id}`;
    case 'spotify': return `https://open.spotify.com/embed/${ref.id}`;
  }
}

export function providerLabel(provider: EmbedProvider): string {
  return { youtube: 'YouTube', vimeo: 'Vimeo', loom: 'Loom', spotify: 'Spotify' }[provider];
}

/** Recognises share/watch/embed URLs from the allowed providers. */
export function parseEmbedUrl(input: string): EmbedRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^www\.|^m\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  let ref: EmbedRef | null = null;

  if (host === 'youtu.be' && parts[0]) ref = { provider: 'youtube', id: parts[0] };
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (parts[0] === 'watch') ref = { provider: 'youtube', id: url.searchParams.get('v') ?? '' };
    else if (['embed', 'shorts', 'live'].includes(parts[0] ?? '') && parts[1]) ref = { provider: 'youtube', id: parts[1] };
  } else if (host === 'vimeo.com' && parts[0]) ref = { provider: 'vimeo', id: parts[parts.length - 1] ?? '' };
  else if (host === 'player.vimeo.com' && parts[0] === 'video' && parts[1]) ref = { provider: 'vimeo', id: parts[1] };
  else if (host === 'loom.com' && (parts[0] === 'share' || parts[0] === 'embed') && parts[1]) ref = { provider: 'loom', id: parts[1] };
  else if (host === 'open.spotify.com') {
    const p = parts[0] === 'embed' ? parts.slice(1) : parts;
    if (p[0] && p[1]) ref = { provider: 'spotify', id: `${p[0]}/${p[1]}` };
  }
  return ref && isValidEmbed(ref) ? ref : null;
}
