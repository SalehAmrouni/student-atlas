// Minimal, safe Markdown renderer for Zeus replies.
// It never uses innerHTML: every node is created explicitly, links are limited
// to http(s), and `opp:<id>` links become in-app buttons that open details.

import { h, safeExternalUrl } from './dom.js';

// Underscore emphasis only counts at word boundaries, so snake_case stays intact.
const INLINE = /(\*\*([^*]+?)\*\*|(?<!\w)__([^_]+?)__(?!\w)|`([^`]+?)`|\[([^\]]+?)\]\(([^)\s]+?)\)|\*([^*\s][^*]*?)\*|(?<!\w)_([^_\s][^_]*?)_(?!\w))/g;

function renderInline(text, ctx) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, , bold1, bold2, code, linkText, linkUrl, em1, em2] = m;
    if (bold1 || bold2) out.push(h('strong', {}, renderInline(bold1 || bold2, ctx)));
    else if (code) out.push(h('code', { text: code }));
    else if (linkText) out.push(renderLink(linkText, linkUrl, ctx));
    else if (em1 || em2) out.push(h('em', {}, renderInline(em1 || em2, ctx)));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderLink(text, url, ctx) {
  if (url.startsWith('opp:')) {
    const id = url.slice(4);
    if (/^[a-z0-9-]{1,80}$/.test(id) && (!ctx.knownIds || ctx.knownIds.has(id))) {
      // A real inline link (buttons can't wrap mid-line); the chat intercepts the click.
      return h('a', { href: `/dashboard.html?q=${encodeURIComponent(text)}`, class: 'opp-link', role: 'button', dataset: { oppId: id } }, text);
    }
    return text;
  }
  const href = safeExternalUrl(url);
  if (!href || !/^https?:/i.test(url)) return text;
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
}

/**
 * Render markdown into a DocumentFragment.
 * Supports headings, bullet/numbered lists, paragraphs, bold, italics,
 * inline code, and links.
 */
export function renderMarkdown(src, ctx = {}) {
  const frag = document.createDocumentFragment();
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  let para = [];
  let list = null;

  const flushPara = () => {
    if (para.length) frag.append(h('p', {}, renderInline(para.join(' '), ctx)));
    para = [];
  };
  const flushList = () => {
    if (list) frag.append(list.el);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushPara(); flushList();
      frag.append(h(heading[1].length <= 2 ? 'h3' : 'h4', {}, renderInline(heading[2], ctx)));
      continue;
    }

    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (bullet || ordered) {
      flushPara();
      const type = bullet ? 'ul' : 'ol';
      if (!list || list.type !== type) {
        flushList();
        list = { type, el: h(type) };
        if (ordered && ordered[1] !== '1') list.el.setAttribute('start', ordered[1]);
      }
      list.el.append(h('li', {}, renderInline(bullet ? bullet[1] : ordered[2], ctx)));
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flushPara(); flushList(); continue; }

    if (list && /^\s{2,}\S/.test(raw)) {
      // continuation of the previous list item
      list.el.lastElementChild?.append(' ', ...renderInline(line.trim(), ctx));
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return frag;
}
