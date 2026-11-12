/**
 * URL 规范化与过滤。
 *
 * 和手册里的「去掉 www、query、hash」略有不同：
 * - 去重键按站点（host）聚合，因此同一个站点的不同内页不会重复出现；
 * - 真正展示/跳转的 URL 会保留路径（例如 notion.so/product/ai）。
 */

const TRACKING_PARAM = /^(utm_|ref$|ref_|referrer$|source$|campaign$|fbclid$|gclid$)/i;

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'twitter.com',
  'x.com',
  'facebook.com',
  'fb.com',
  'instagram.com',
  'linkedin.com',
  'youtube.com',
  'youtu.be',
  'reddit.com',
  'medium.com',
  'substack.com',
  'news.ycombinator.com',
  'arxiv.org',
  'wikipedia.org',
  't.me',
  'telegram.org',
  'discord.gg',
  'discord.com',
  'bit.ly',
  't.co',
  'dribbble.com',
  'behance.net',
  'pinterest.com',
  'tiktok.com',
  'apps.apple.com',
  'play.google.com',
  'npmjs.com',
  'pypi.org',
  'crates.io',
  'packagist.org',
  'rubygems.org',
]);

const BLOCKED_SUFFIXES = [
  '.local',
  '.internal',
  '.example',
  '.invalid',
  '.test',
];

const BLOCKED_EXTENSIONS =
  /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|pdf|zip|rar|7z|gz|tgz|mp4|mp3|wav|mov|avi|webm|css|js|mjs|json|xml|txt|md|woff2?|ttf|eot)$/i;

const GITHUB_RESERVED = new Set([
  'about',
  'account',
  'apps',
  'collections',
  'contact',
  'customer-stories',
  'enterprise',
  'events',
  'explore',
  'features',
  'issues',
  'login',
  'marketplace',
  'mobile',
  'new',
  'notifications',
  'orgs',
  'pricing',
  'readme',
  'search',
  'security',
  'settings',
  'signup',
  'site',
  'solutions',
  'sponsors',
  'topics',
  'trending',
  'users',
]);

export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 清理 URL 中不参与展示的参数与片段，但仍保留路径。
 */
export function cleanUrl(input, base) {
  if (!input) return null;
  let url;
  try {
    url = new URL(String(input).trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.username = '';
  url.password = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  // 导航站不需要搜索/筛选参数，统一切掉，避免同一页面重复。
  url.search = '';
  let result = url.toString();
  if (result.endsWith('/') && url.pathname !== '/') result = result.slice(0, -1);
  return result;
}

export function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

export function domainOf(value) {
  return hostOf(value);
}

export function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '::1') return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (host.startsWith('[') || host.includes(':')) return true;
  return false;
}

export function isBlockedUrl(value) {
  if (!isHttpUrl(value)) return true;
  let url;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (isPrivateHost(host)) return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (url.port && url.port !== '80' && url.port !== '443') return true;

  const path = url.pathname.toLowerCase();
  if (BLOCKED_EXTENSIONS.test(path)) return true;
  if (path.startsWith('/login') || path.startsWith('/signin') || path.startsWith('/signup')) {
    return true;
  }

  if (host === 'github.com') {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return true;
    if (GITHUB_RESERVED.has(segments[0].toLowerCase()) && segments[0].toLowerCase() !== 'features') {
      return true;
    }
    if (segments[0].toLowerCase() === 'features') return false;
    if (segments.length < 2) return true;
    if (segments.length > 2) return true;
  }

  if (host === 'producthunt.com' && /^\/(?:r|posts)\//i.test(path)) return true;

  return false;
}

/**
 * 去重键：普通站点按域名聚合，GitHub 按 owner/repo 聚合。
 */
export function siteKey(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (host === 'github.com') {
    const segments = url.pathname.split('/').filter(Boolean).map((s) => s.toLowerCase());
    if (segments[0] === 'features') return `github:${segments.join('/')}`;
    if (segments.length >= 2) return `github:${segments[0]}/${segments[1]}`;
    return 'host:github.com';
  }
  return `host:${host}`;
}

export function isGithubRepo(value) {
  try {
    const url = new URL(value);
    if (url.hostname.replace(/^www\./i, '').toLowerCase() !== 'github.com') return false;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 2) return false;
    if (GITHUB_RESERVED.has(segments[0].toLowerCase())) return false;
    return true;
  } catch {
    return false;
  }
}

export function githubRepoOf(value) {
  if (!isGithubRepo(value)) return null;
  const segments = new URL(value).pathname.split('/').filter(Boolean);
  return { owner: segments[0], repo: segments[1] };
}

export function withWwwVariants(value) {
  const variants = [];
  try {
    const url = new URL(value);
    const host = url.hostname;
    variants.push(url.toString());
    if (host.startsWith('www.')) {
      const copy = new URL(url);
      copy.hostname = host.slice(4);
      variants.push(copy.toString());
    } else {
      const copy = new URL(url);
      copy.hostname = `www.${host}`;
      variants.push(copy.toString());
    }
  } catch {
    // ignore
  }
  return [...new Set(variants)];
}
