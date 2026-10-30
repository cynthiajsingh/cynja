import { mergeAttributes, Node } from '@tiptap/core';
import { embedSrc, isValidEmbed, providerLabel, type EmbedProvider } from '../embeds.ts';

export const IMAGE_WIDTHS = [25, 50, 75, 100] as const;
export const IMAGE_ALIGNS = ['center', 'left', 'right', 'wide'] as const;
export type ImageAlign = (typeof IMAGE_ALIGNS)[number];

export interface FigureImageAttrs {
  src: string;
  alt: string;
  caption: string;
  width: number;
  align: ImageAlign;
  mediaId: string | null;
}

function clampWidth(value: unknown): number {
  const n = Number(value);
  return (IMAGE_WIDTHS as readonly number[]).includes(n) ? n : 100;
}

function cleanAlign(value: unknown): ImageAlign {
  return (IMAGE_ALIGNS as readonly string[]).includes(String(value)) ? (value as ImageAlign) : 'center';
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    figureImage: {
      insertFigureImage: (attrs: Partial<FigureImageAttrs> & { src: string }) => ReturnType;
    };
    embed: {
      insertEmbed: (attrs: { provider: EmbedProvider; id: string; title?: string }) => ReturnType;
    };
  }
}

/** Block image with alt text, caption, width and alignment, rendered as <figure>. */
export const FigureImage = Node.create({
  name: 'figureImage',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      caption: { default: '' },
      width: { default: 100 },
      align: { default: 'center' },
      mediaId: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-type="image"]',
        getAttrs: (el) => {
          const img = (el as HTMLElement).querySelector('img');
          if (!img) return false;
          return {
            src: img.getAttribute('src') ?? '',
            alt: img.getAttribute('alt') ?? '',
            caption: (el as HTMLElement).querySelector('figcaption')?.textContent ?? '',
            width: clampWidth((el as HTMLElement).getAttribute('data-width')),
            align: cleanAlign((el as HTMLElement).getAttribute('data-align')),
            mediaId: (el as HTMLElement).getAttribute('data-media-id'),
          };
        },
      },
      {
        tag: 'img[src]',
        getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute('src'), alt: (el as HTMLElement).getAttribute('alt') ?? '' }),
      },
    ];
  },

  renderHTML({ node }) {
    const width = clampWidth(node.attrs.width);
    const align = cleanAlign(node.attrs.align);
    const figureAttrs = {
      'data-type': 'image',
      'data-width': String(width),
      'data-align': align,
      ...(node.attrs.mediaId ? { 'data-media-id': node.attrs.mediaId } : {}),
      class: `fig fig-${align} w-${width}`,
    };
    const img = ['img', { src: node.attrs.src, alt: node.attrs.alt ?? '', loading: 'lazy', decoding: 'async' }];
    return node.attrs.caption
      ? ['figure', figureAttrs, img, ['figcaption', {}, String(node.attrs.caption)]]
      : ['figure', figureAttrs, img];
  },

  addCommands() {
    return {
      insertFigureImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

/** Allowlisted video/audio embed. Only { provider, id } is stored; the iframe src is derived. */
export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      provider: { default: null },
      id: { default: null },
      title: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-type="embed"]',
        getAttrs: (el) => {
          const ref = {
            provider: (el as HTMLElement).getAttribute('data-provider'),
            id: (el as HTMLElement).getAttribute('data-embed-id'),
          };
          if (!isValidEmbed(ref)) return false;
          return { ...ref, title: (el as HTMLElement).querySelector('iframe')?.getAttribute('title') ?? '' };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const ref = { provider: node.attrs.provider, id: node.attrs.id };
    if (!isValidEmbed(ref)) return ['p', {}, ''];
    const title = node.attrs.title || `${providerLabel(ref.provider)} embed`;
    return [
      'figure',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'embed',
        'data-provider': ref.provider,
        'data-embed-id': ref.id,
        class: `embed embed-${ref.provider}`,
      }),
      [
        'iframe',
        {
          src: embedSrc(ref),
          title,
          loading: 'lazy',
          allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen',
          allowfullscreen: 'true',
          referrerpolicy: 'strict-origin-when-cross-origin',
          frameborder: '0',
        },
      ],
    ];
  },

  addCommands() {
    return {
      insertEmbed:
        (attrs) =>
        ({ commands }) =>
          isValidEmbed(attrs) ? commands.insertContent({ type: this.name, attrs }) : false,
    };
  },
});
