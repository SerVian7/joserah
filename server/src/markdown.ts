import { Marked, type RendererObject } from 'marked';
import { esc } from './layout.ts';

/** A link target that is safe to emit: http(s), mailto, an in-page anchor, or a relative link the caller resolves. Null drops it. */
export function safeHref(href: string, resolve?: (h: string) => string | null): string | null {
  const h = String(href ?? '').trim();
  if (/[\x00-\x1f\x7f]/.test(h)) return null;   // a browser strips tabs and newlines, so `java\tscript:` would still run
  if (/^(https?:|mailto:)/i.test(h)) return h;
  if (!h || h.startsWith('//') || h.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
  if (h.startsWith('#')) return h;
  return resolve ? resolve(h) : h;
}

/** Markdown to HTML: GFM (tables), raw HTML in the source escaped as text, only safe links and images kept. */
export function renderMarkdown(md: string, opts: { resolveHref?: (h: string) => string | null } = {}): string {
  const renderer: RendererObject = {
    html(token) { return esc(token.text); },
    link(token) {
      const inner = this.parser.parseInline(token.tokens);
      const href = safeHref(token.href, opts.resolveHref);
      return href ? `<a href="${esc(href)}"${/^https?:/i.test(href) ? ' rel="noopener noreferrer"' : ''}>${inner}</a>` : inner;
    },
    image(token) {
      const src = safeHref(token.href, opts.resolveHref);
      return src && !/^mailto:/i.test(src) ? `<img src="${esc(src)}" alt="${esc(token.text)}" loading="lazy">` : esc(token.text);
    },
  };
  const m = new Marked({ gfm: true, async: false, renderer });
  return m.parse(String(md ?? '')) as string;
}
