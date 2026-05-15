/**
 * Kebab-case utilities for converting paths and strings
 */

/**
 * Converts a string into kebab-case, preserving file extensions and path separators.
 *
 * Examples:
 *   toKebabCase('Mi Página.html') => 'mi-pagina.html'
 *   toKebabCase('pages/Some Page/Other File.mmx') => 'pages/some-page/other-file.mmx'
 *
 * @param {string} input - The string to convert
 * @returns {string} Kebab-case string
 */
export function toKebabCase(input) {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed) return '';

  const normalizeSegment = (segment) => {
    if (!segment) return '';

    const dotIndex = segment.lastIndexOf('.');
    let base = segment;
    let ext = '';

    if (dotIndex > 0) {
      base = segment.slice(0, dotIndex);
      ext = segment.slice(dotIndex + 1);
    }

    base = base
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (ext) {
      ext = ext.toLowerCase();
      return `${base}.${ext}`;
    }

    return base;
  };

  return trimmed
    .replace(/\\/g, '/')
    .split('/')
    .map(normalizeSegment)
    .filter(Boolean)
    .join('/');
}

/**
 * Normalizes a page-relative href to kebab-case and converts .mmx extensions to .html.
 *
 * @param {string} href - The href value to normalize
 * @returns {string} Normalized href
 */
export function normalizePageHref(href) {
  if (typeof href !== 'string') return href;
  const trimmed = href.trim();
  if (!trimmed) return href;

  if (/^(?:https?:\/\/|\/\/|mailto:|tel:)/i.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/^([^#?]+)([?#].*)?$/);
  const pathPart = match ? match[1] : trimmed;
  const rest = match ? (match[2] || '') : '';

  const prefixMatch = pathPart.match(/^(?:\.\/|\.\.\/|\/)?(pages[\/].*)$/i);
  if (!prefixMatch) return trimmed;

  const prefix = pathPart.slice(0, pathPart.length - prefixMatch[1].length);
  const normalized = toKebabCase(prefixMatch[1]).replace(/\.mmx$/i, '.html');
  return `${prefix}${normalized}${rest}`;
}
