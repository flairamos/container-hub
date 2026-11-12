/**
 * 轻量 HTML 解析：只提取导航卡片需要的 title / description / icon。
 * 不引入 cheerio，避免 Actions 每天安装依赖。
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  middot: '·',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
};

export function decodeEntities(value = '') {
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[key] ?? match;
  });
}

export function cleanText(value = '') {
  return decodeEntities(
    String(value)
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncateText(value, maxLength) {
  const chars = Array.from(cleanText(value));
  if (chars.length <= maxLength) return chars.join('');
  return `${chars.slice(0, maxLength).join('')}…`;
}

export function parseAttributes(tag = '') {
  const attributes = {};
  const body = String(tag).replace(/^<\s*[\w:-]+/, '').replace(/\/?>\s*$/, '');
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(body))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attributes[name] = decodeEntities(value);
  }
  return attributes;
}

function pickMeta(metaMap, keys) {
  for (const key of keys) {
    const value = metaMap.get(key);
    if (value && value.trim()) return value.trim();
  }
  return '';
}

/**
 * 站点 title 常常是 "OpenCode | The open source..." 这种 SEO 长标题。
 * 取分隔符切分后最短的一段作为品牌名。
 */
export function brandTitle(rawTitle) {
  const title = cleanText(rawTitle);
  if (!title) return '';
  const parts = title
    .split(/\s+(?:[|｜·•—–]|-)\s+|\s*[|｜]\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 80);
  if (parts.length > 1) {
    const sorted = [...parts].sort((a, b) => a.length - b.length);
    return sorted[0];
  }
  return title.slice(0, 80);
}

function isChallenge(title) {
  return /just a moment|attention required|checking your browser|verify you are human|enable javascript and cookies|cf-chl|access denied/i.test(
    title,
  );
}

function scoreIcon(icon) {
  const rel = icon.rel.toLowerCase();
  const sizes = [...String(icon.sizes).matchAll(/(\d+)\s*[xX]\s*(\d+)/g)]
    .map((match) => Math.max(Number(match[1]), Number(match[2])))
    .filter(Boolean);
  const size = sizes.length ? Math.max(...sizes) : 0;
  let score = size;
  if (rel.includes('apple-touch-icon')) score += 1000;
  if (/svg/.test(icon.type) || /\.svg(?:\?|$)/i.test(icon.url)) score += 500;
  if (size >= 128) score += 120;
  if (/\.(?:png|webp)(?:\?|$)/i.test(icon.url)) score += 60;
  if (/\.ico(?:\?|$)/i.test(icon.url)) score -= 80;
  if (rel.includes('mask-icon')) score -= 2000;
  return score;
}

export function rankIcons(icons, siteUrl) {
  const seen = new Set();
  const list = [];
  for (const icon of icons) {
    if (!icon?.url || seen.has(icon.url)) continue;
    seen.add(icon.url);
    list.push(icon);
  }
  if (siteUrl) {
    try {
      const fallback = new URL('/favicon.ico', siteUrl).toString();
      if (!seen.has(fallback)) {
        list.push({ url: fallback, rel: 'icon', type: 'image/x-icon', sizes: '' });
      }
    } catch {
      // ignore
    }
  }
  return list.sort((a, b) => scoreIcon(b) - scoreIcon(a));
}

/**
 * 从 HTML 中提取站点元数据。
 */
export function extractSiteMeta(html, siteUrl) {
  const source = String(html || '').slice(0, 2_000_000);

  const baseTag = /<base\b[^>]*>/i.exec(source);
  const baseAttrs = baseTag ? parseAttributes(baseTag[0]) : {};
  let baseUrl = siteUrl;
  if (baseAttrs.href) {
    try {
      baseUrl = new URL(baseAttrs.href, siteUrl).toString();
    } catch {
      baseUrl = siteUrl;
    }
  }

  const titleTagMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(source);
  const titleTag = titleTagMatch ? cleanText(titleTagMatch[1]) : '';

  const metaMap = new Map();
  for (const match of source.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (key && attrs.content) metaMap.set(key, attrs.content);
  }

  const icons = [];
  for (const match of source.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const rel = (attrs.rel || '').toLowerCase();
    if (!rel) continue;
    const relTokens = rel.split(/\s+/);
    if (
      !relTokens.includes('icon') &&
      !relTokens.includes('shortcut') &&
      !relTokens.includes('apple-touch-icon') &&
      !relTokens.includes('apple-touch-icon-precomposed') &&
      !relTokens.includes('mask-icon')
    ) {
      continue;
    }
    if (!attrs.href || attrs.href.startsWith('data:')) continue;
    try {
      icons.push({
        url: new URL(attrs.href, baseUrl).toString(),
        rel,
        type: attrs.type || '',
        sizes: attrs.sizes || '',
      });
    } catch {
      // ignore malformed icon URL
    }
  }

  const siteName = cleanText(pickMeta(metaMap, ['og:site_name', 'application-name']));
  const ogTitle = cleanText(pickMeta(metaMap, ['og:title', 'twitter:title']));
  const rawTitle = siteName || brandTitle(titleTag) || brandTitle(ogTitle) || ogTitle || titleTag;
  const description =
    cleanText(
      pickMeta(metaMap, [
        'description',
        'og:description',
        'twitter:description',
      ]),
    ) || '';

  let canonical = '';
  const canonicalMatch = source.match(/<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i);
  if (canonicalMatch) {
    canonical = parseAttributes(canonicalMatch[0]).href || '';
  }

  return {
    title: truncateText(rawTitle, 60),
    description: truncateText(description, 110),
    icons: rankIcons(icons, baseUrl),
    canonical,
    challenge: isChallenge(titleTag) && !description,
    language: (source.match(/<html\b[^>]*lang=["']([^"']+)/i)?.[1] || '').toLowerCase(),
  };
}

export function extractFirstParagraph(html = '') {
  const match = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(String(html));
  return match ? truncateText(cleanText(match[1]), 110) : '';
}

function readTag(block, names) {
  for (const name of names) {
    const pattern = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');
    const match = pattern.exec(block);
    if (match) return match[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
  }
  return '';
}

/**
 * 解析 Atom / RSS，返回 feed 条目。
 */
export function parseFeed(xml) {
  const blocks = [
    ...String(xml).matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
    ...String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi),
  ].map((match) => match[0]);

  return blocks.map((block) => {
    let link = '';
    const atomLink = /<link\b[^>]*href=["']([^"']+)["'][^>]*>/i.exec(block);
    if (atomLink) link = atomLink[1];
    if (!link) link = readTag(block, ['link']);
    const title = cleanText(readTag(block, ['title']));
    const summary = cleanText(
      readTag(block, ['summary', 'content:encoded', 'content', 'description']),
    );
    const published = cleanText(readTag(block, ['published', 'updated', 'pubDate']));
    const contentRaw = readTag(block, ['content:encoded', 'content', 'description', 'summary']);
    return {
      title,
      link: decodeEntities(link),
      summary,
      contentRaw,
      published,
    };
  });
}
