// Identifies images from their bytes (never from the filename or browser-declared
// type) and reads dimensions from the header without decoding the image.

export type ImageKind = 'jpg' | 'png' | 'webp' | 'gif' | 'avif';

export const MIME_BY_KIND: Record<ImageKind, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

const EXTENSIONS: Record<ImageKind, string[]> = {
  jpg: ['jpg', 'jpeg'],
  png: ['png'],
  webp: ['webp'],
  gif: ['gif'],
  avif: ['avif'],
};

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a) return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(b, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(b, 8, 12))) return 'avif';
  return null;
}

export function extensionMatches(kind: ImageKind, filename: string): boolean {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return EXTENSIONS[kind].includes(ext);
}

export function imageDimensions(kind: ImageKind, b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    switch (kind) {
      case 'png':
        return { width: dv.getUint32(16), height: dv.getUint32(20) };
      case 'gif':
        return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
      case 'webp': {
        const chunk = ascii(b, 12, 16);
        if (chunk === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
        if (chunk === 'VP8L') {
          const bits = dv.getUint32(21, true);
          return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        if (chunk === 'VP8X') {
          const w = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16));
          const h = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16));
          return { width: w, height: h };
        }
        return null;
      }
      case 'jpg': {
        let i = 2;
        while (i + 9 < b.length) {
          if (b[i] !== 0xff) { i++; continue; }
          const marker = b[i + 1]!;
          if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
          }
          i += 2 + dv.getUint16(i + 2);
        }
        return null;
      }
      case 'avif':
        return null;
    }
  } catch {
    return null;
  }
}
