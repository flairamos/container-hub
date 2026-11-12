import {
  SEEDS,
  AWESOME_SOURCES,
  PROVIDER_HOMEPAGES,
  PROVIDER_CATEGORIES,
  CRAWL,
} from './config.mjs';
import {
  fetchPage,
  fetchJson,
  fetchText,
  mapLimit,
} from './lib/http.mjs';
import {
  cleanText,
  extractFirstParagraph,
  extractSiteMeta,
  parseFeed,
  truncateText,
} from './lib/html.mjs';
import {
  cleanUrl,
  hostOf,
  isBlockedUrl,
  isGithubRepo,
  githubRepoOf,
  siteKey,
  withWwwVariants,
} from './lib/url.mjs';
import { downloadGithubAvatar, downloadIcon, safeIconBase } from './lib/icon.mjs';
import { log, warn, truncate } from './lib/util.mjs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AI_TEXT =
  /\b(?:ai|llm|llms|gpt|agent|agents|agentic|model|models|ml|rag|mcp|chatbot|chatgpt|claude|gemini|copilot)\b|人工智能|大模型|智能体|生成式/i;

const GENERIC_LINK_TITLES = new Set([
  'here',
  'link',
  'website',
  'site',
  'demo',
  'docs',
  'documentation',
  'doc',
  'source',
  'code',
  'repo',
  'repository',
  'github',
  'npm',
  'pypi',
  'download',
  'install',
  'blog',
  'video',
  'twitter',
  'discord',
  'read more',
  'learn more',
  '官方',
  '官网',
  '文档',
  '链接',
  '点击',
  'intro',
  'introduction',
  'api key',
  'api keys',
  'get api key',
  'get api keys',
  'get started',
  'pricing',
  'playground',
  'console',
  'dashboard',
  'models',
  'overview',
  'quickstart',
  'home',
  'homepage',
  'platform',
  'free plan limits',
  'rate limits',
  'limits',
  'deprecations',
  'changelog',
  'release notes',
  'api reference',
  'status',
]);

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const README_CACHE_DIR = path.join(ROOT, 'data', 'cache', 'readmes');

function createCandidate(url, meta = {}) {
  let cleaned = cleanUrl(url);
  if (!cleaned || isBlockedUrl(cleaned)) return null;

  // awesome 清单里经常直接链到 API Key 页面或深层文档。
  // 对非 GitHub 链接收敛到站点首页，卡片更像“一个产品”而不是“一个后台页面”。
  if (meta.rootOnly && !isGithubRepo(cleaned)) {
    try {
      cleaned = `${new URL(cleaned).origin}/`;
    } catch {
      // keep cleaned
    }
  }

  const key = siteKey(cleaned);
  if (!key) return null;
  return {
    key,
    url: cleaned,
    title: cleanText(meta.title || '').slice(0, 80),
    description: truncateText(meta.description || '', 110),
    category: meta.category || '',
    hintCategory: meta.hintCategory || '',
    tags: [...new Set((meta.tags || []).map((tag) => cleanText(tag)).filter(Boolean))].slice(0, 6),
    sources: new Set(meta.source ? [meta.source] : []),
    weight: Number(meta.weight || 0),
    publishedAt: meta.publishedAt || '',
    priority: Number(meta.priority ?? 50),
    icon: '',
    fetchedAt: '',
    fetchError: '',
  };
}

function mergeCandidate(target, incoming) {
  if (!incoming) return target;
  // 同优先级时保留先出现的标题/分类，避免后写入的种子把前一个覆盖掉
  // （例如 huggingface.co 的官网与 /learn 课程页）。
  if (incoming.priority > target.priority || !target.title) {
    if (incoming.title) {
      target.title = incoming.title;
      target.priority = Math.max(target.priority, incoming.priority);
    }
  }
  if (incoming.description && (incoming.priority >= target.priority || !target.description)) {
    target.description = incoming.description;
  }
  if (incoming.category && (incoming.priority > target.priority || !target.category)) {
    target.category = incoming.category;
    target.priority = Math.max(target.priority, incoming.priority);
  }
  if (!target.hintCategory && incoming.hintCategory) target.hintCategory = incoming.hintCategory;
  if (incoming.weight > target.weight) target.weight = incoming.weight;
  if (incoming.publishedAt && (!target.publishedAt || incoming.publishedAt < target.publishedAt)) {
    target.publishedAt = incoming.publishedAt;
  }
  for (const source of incoming.sources) target.sources.add(source);
  for (const tag of incoming.tags) {
    if (target.tags.length < 6 && !target.tags.includes(tag)) target.tags.push(tag);
  }
  return target;
}

function addCandidate(map, url, meta = {}) {
  const candidate = createCandidate(url, meta);
  if (!candidate) return;
  const existing = map.get(candidate.key);
  if (existing) {
    mergeCandidate(existing, candidate);
  } else {
    map.set(candidate.key, candidate);
  }
}

function seedCandidates(map) {
  for (const seed of SEEDS) {
    addCandidate(map, seed.url, {
      ...seed,
      source: 'seed',
      priority: 100,
    });
  }
}

async function collectModelsDev(map) {
  const data = await fetchJson('https://models.dev/api.json', {
    timeout: 30000,
    retries: 1,
    maxBytes: 25 * 1024 * 1024,
  });
  if (!data || typeof data !== 'object') return 0;

  let added = 0;
  for (const [id, provider] of Object.entries(data)) {
    if (!provider || typeof provider !== 'object') continue;
    const name = cleanText(provider.name || id);
    if (!name) continue;
    const homepage = PROVIDER_HOMEPAGES[id] || provider.doc || provider.url;
    if (!homepage) continue;
    const cleaned = cleanUrl(homepage);
    if (!cleaned || isBlockedUrl(cleaned)) continue;
    const modelCount = provider.models && typeof provider.models === 'object'
      ? Object.keys(provider.models).length
      : 0;
    const description = modelCount
      ? `${name} 在 models.dev 收录 ${modelCount} 个模型，可通过 API 接入。`
      : `${name} 的模型与 API 文档。`;
    addCandidate(map, cleaned, {
      title: name,
      description,
      category: PROVIDER_CATEGORIES[id] || 'llm-provider',
      hintCategory: PROVIDER_CATEGORIES[id] || 'llm-provider',
      source: 'models.dev',
      weight: Math.min(7, 2 + Math.log10(modelCount + 1) * 2),
      priority: 55,
    });
    added += 1;
    if (added >= 60) break;
  }
  return added;
}

async function collectHn(map) {
  const since = Math.floor((Date.now() - 45 * 24 * 60 * 60 * 1000) / 1000);
  const queries = ['AI', 'LLM', 'agent'];
  let added = 0;

  for (const query of queries) {
    const params = new URLSearchParams({
      query,
      tags: 'show_hn',
      hitsPerPage: '30',
      numericFilters: `created_at_i>${since}`,
    });
    try {
      const data = await fetchJson(`https://hn.algolia.com/api/v1/search_by_date?${params}`, {
        timeout: 20000,
        retries: 1,
      });
      for (const hit of data?.hits || []) {
        if (!hit?.url) continue;
        const title = cleanText(hit.title || '').replace(/^show\s+hn:\s*/i, '').trim();
        const story = cleanText(hit.story_text || '');
        if (!title) continue;
        if (!AI_TEXT.test(`${title} ${story}`)) continue;
        const cleanStory = truncateText(story, 110);
        addCandidate(map, hit.url, {
          title,
          description: cleanStory || 'Hacker News 社区分享的 AI 项目。',
          source: 'hn',
          weight: 3 + Math.min(5, Math.log10((hit.points || 0) + 1) * 2),
          publishedAt: hit.created_at || '',
          priority: 45,
        });
        added += 1;
        if (added >= 75) break;
      }
    } catch (error) {
      warn('hn', `查询 ${query} 失败: ${error.message}`);
    }
    if (added >= 75) break;
  }
  return added;
}

async function resolveProductHuntLink(trackingUrl) {
  try {
    const response = await fetch(trackingUrl, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      },
      signal: AbortSignal.timeout(9000),
    });
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    return response.url || '';
  } catch {
    return '';
  }
}

async function collectProductHunt(map) {
  let xml;
  try {
    xml = await fetchText('https://www.producthunt.com/feed?category=ai', {
      timeout: 20000,
      retries: 1,
    });
  } catch (error) {
    warn('producthunt', `RSS 获取失败: ${error.message}`);
    return 0;
  }

  const entries = parseFeed(xml).slice(0, 30);
  const resolved = await mapLimit(entries, 4, async (entry) => {
    const rawLink = /href=["']([^"']*producthunt\.com\/r\/p\/[^"']+)["']/i.exec(
      entry.contentRaw || '',
    )?.[1];
    if (!rawLink) return null;
    const tracking = cleanText(rawLink).replace(/&amp;/g, '&');
    const finalUrl = await resolveProductHuntLink(tracking);
    if (!finalUrl || hostOf(finalUrl) === 'producthunt.com') return null;
    return { entry, finalUrl };
  });

  let added = 0;
  for (const item of resolved.filter(Boolean)) {
    const summary = extractFirstParagraph(item.entry.contentRaw) || item.entry.summary;
    addCandidate(map, item.finalUrl, {
      title: item.entry.title,
      description: summary ? `Product Hunt 推荐：${summary}` : 'Product Hunt 今日推荐的 AI 产品。',
      source: 'producthunt',
      weight: 4,
      publishedAt: item.entry.published || '',
      priority: 45,
    });
    added += 1;
  }
  return added;
}

/**
 * GitHub README 有三条取法，按可用性依次尝试：
 * 1. jsDelivr（不消耗 GitHub API 额度，国内外一般都可访问）
 * 2. ghproxy 代理的 raw.githubusercontent.com
 * 3. GitHub API（带 GITHUB_TOKEN 时额度更高）
 * 结果缓存 12 小时，避免每次本地调试都重复请求。
 */
async function fetchGithubReadme(repo, token = process.env.GITHUB_TOKEN) {
  await mkdir(README_CACHE_DIR, { recursive: true });
  const cacheFile = path.join(README_CACHE_DIR, `${repo.replace('/', '__')}.md`);
  try {
    const info = await stat(cacheFile);
    if (Date.now() - info.mtimeMs < 12 * 60 * 60 * 1000) {
      const cached = await readFile(cacheFile, 'utf8');
      if (cached.length > 200) return cached;
    }
  } catch {
    // cache miss
  }

  const sources = [
    `https://gcore.jsdelivr.net/gh/${repo}@main/README.md`,
    `https://gcore.jsdelivr.net/gh/${repo}@master/README.md`,
    `https://ghproxy.net/https://raw.githubusercontent.com/${repo}/main/README.md`,
    `https://ghproxy.net/https://raw.githubusercontent.com/${repo}/master/README.md`,
  ];

  let text = '';
  for (const url of sources) {
    try {
      const response = await fetchText(url, {
        timeout: 20000,
        retries: 0,
        maxBytes: 2 * 1024 * 1024,
      });
      if (response.length > 200 && !/^\s*<!DOCTYPE html/i.test(response)) {
        text = response;
        break;
      }
    } catch {
      // try next
    }
  }

  if (!text) {
    const headers = {
      accept: 'application/vnd.github.raw',
      'x-github-api-version': '2022-11-28',
    };
    if (token) headers.authorization = `Bearer ${token}`;
    text = await fetchText(`https://api.github.com/repos/${repo}/readme`, {
      timeout: 20000,
      retries: 0,
      maxBytes: 2 * 1024 * 1024,
      headers,
    });
    // API 偶尔退化成 JSON，再兜底解析一次。
    if (text.trim().startsWith('{')) {
      try {
        const data = JSON.parse(text);
        if (data.content) text = Buffer.from(data.content, 'base64').toString('utf8');
      } catch {
        // ignore
      }
    }
  }

  if (!text || text.length < 200) throw new Error('README 内容为空');
  await writeFile(cacheFile, text, 'utf8');
  return text;
}

function isMeaningfulText(text) {
  const plain = String(text || '').replace(/[^\p{L}\p{N}]/gu, '');
  return plain.length >= 4;
}

function parseAwesomeLinks(markdown) {
  const cleaned = String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');

  const links = [];
  const seen = new Set();
  const pattern = /(?<!!)\[([^\]]{2,100})\]\((https?:\/\/[^)\s]+)\)/g;

  for (const line of cleaned.split(/\r?\n/)) {
    pattern.lastIndex = 0;
    const match = pattern.exec(line);
    if (!match) continue;

    const title = cleanText(match[1])
      .replace(/[*_`~]/g, '')
      .replace(/^[▸►•·\-\s]+/, '')
      .trim();
    const url = match[2].replace(/&amp;/g, '&');
    if (!title || !url || !isMeaningfulText(title)) continue;
    if (GENERIC_LINK_TITLES.has(title.toLowerCase())) continue;
    if (/shields\.io|badge|badgen\.net|travis-ci/i.test(url)) continue;

    const tail = line
      .slice(match.index + match[0].length)
      .replace(/^[\s:：|—–-]+/, '')
      .replace(/^[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F\s|]+/gu, '')
      .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\|[^|]*$/, '')
      .replace(/^[\s,，.;；:：)\]}】）]+/, '')
      .replace(/^by\s*[-–—:]?\s*/i, '')
      .trim();
    const description =
      isMeaningfulText(tail) && !/^[).,;，。；]/.test(tail) ? truncateText(tail, 110) : '';

    const key = `${title}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ title: truncate(title, 80), url, description });
    if (links.length >= 160) break;
  }
  return links;
}

async function collectAwesome(map) {
  let added = 0;
  for (const source of AWESOME_SOURCES) {
    try {
      const markdown = await fetchGithubReadme(source.repo);
      const links = parseAwesomeLinks(markdown).slice(0, 60);
      for (const link of links) {
        addCandidate(map, link.url, {
          title: link.title,
          description: link.description || `收录于 ${source.repo.split('/')[1]} 清单。`,
          source: source.source,
          hintCategory: source.hintCategory,
          weight: 2,
          priority: 40,
          rootOnly: true,
        });
        added += 1;
      }
      log('awesome', `${source.repo}: ${links.length} 个链接`);
    } catch (error) {
      warn('awesome', `${source.repo} 读取失败: ${error.message}`);
    }
  }
  return added;
}

/**
 * 汇总所有信息源。单个源失败只记日志，不影响其它源。
 */
export async function collectCandidates() {
  const map = new Map();
  seedCandidates(map);
  log('crawl', `种子站点 ${map.size} 个`);

  const tasks = [
    ['models.dev', collectModelsDev(map)],
    ['hn', collectHn(map)],
    ['producthunt', collectProductHunt(map)],
    ['awesome', collectAwesome(map)],
  ];
  const results = await Promise.allSettled(tasks.map(([, promise]) => promise));
  results.forEach((result, index) => {
    const name = tasks[index][0];
    if (result.status === 'fulfilled') {
      log('crawl', `${name} 新增候选 ${result.value ?? 0} 个`);
    } else {
      warn('crawl', `${name} 失败: ${result.reason?.message || result.reason}`);
    }
  });

  return [...map.values()];
}

async function fetchSitePage(candidate) {
  let lastError;
  for (const url of withWwwVariants(candidate.url)) {
    try {
      const page = await fetchPage(url, {
        timeout: CRAWL.requestTimeout,
        retries: 0,
        maxBytes: 4 * 1024 * 1024,
      });
      return page;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('页面不可访问');
}

/**
 * 补全标题/描述/图标。人工种子已有标题描述时，只补图标。
 */
export async function enrichCandidate(candidate, options = {}) {
  const { existing = null, force = false, noIcons = false } = options;
  const existingIcon = candidate.icon || existing?.icon || '';

  if (isGithubRepo(candidate.url)) {
    const repo = githubRepoOf(candidate.url);
    if (!candidate.title) candidate.title = repo ? `${repo.owner}/${repo.repo}` : candidate.key;
    if (!candidate.description) {
      candidate.description = 'GitHub 上的 AI 开源项目。';
    }
    if (!noIcons && (force || !existingIcon)) {
      candidate.icon =
        (await downloadGithubAvatar(repo?.owner || '', candidate.key, {
          existingPath: existingIcon,
          force,
        })) || existingIcon;
    }
    candidate.fetchedAt = new Date().toISOString();
    return candidate;
  }

  try {
    const page = await fetchSitePage(candidate);
    const meta = extractSiteMeta(page.text, page.finalUrl);
    if (meta.challenge) throw new Error('反爬验证页');

    // 种子站点的人工标题/描述优先级最高；--refresh 只强制刷新图标。
    const curated = Number(candidate.priority) >= 90;
    if ((!candidate.title || (force && !curated)) && meta.title) {
      candidate.title = meta.title;
    }
    if ((!candidate.description || (force && !curated)) && meta.description) {
      candidate.description = meta.description;
    }

    if (!noIcons && (force || !existingIcon)) {
      candidate.icon =
        (await downloadIcon({
          hostKey: candidate.key,
          icons: meta.icons,
          siteUrl: page.finalUrl,
          existingPath: existingIcon,
          force,
          fileBase: safeIconBase(candidate.key),
        })) || existingIcon;
    }
    candidate.fetchedAt = new Date().toISOString();
  } catch (error) {
    candidate.fetchError = truncate(error.message, 80);
    // 首页抓不到时仍尝试用公共 favicon 服务补图标，避免热门卡片全是首字母。
    if (!noIcons && (force || !existingIcon)) {
      candidate.icon =
        (await downloadIcon({
          hostKey: candidate.key,
          icons: [],
          siteUrl: candidate.url,
          existingPath: existingIcon,
          force,
          fileBase: safeIconBase(candidate.key),
        })) || existingIcon;
    }
  }

  return candidate;
}

/**
 * 只对缺少元数据的候选做网络补全，避免每天重复抓全部站点。
 */
export async function enrichCandidates(candidates, options = {}) {
  const {
    existingMap = new Map(),
    force = false,
    noIcons = false,
    limit = CRAWL.enrichLimit,
  } = options;

  const needs = candidates.filter((candidate) => {
    const existing = existingMap.get(candidate.key);
    const icon = candidate.icon || existing?.icon;
    if (force) return true;
    if (!candidate.title || !candidate.description) return true;
    if (!noIcons && !icon) return true;
    return false;
  });

  const selected = needs
    .sort((a, b) => b.weight - a.weight || b.sources.size - a.sources.size)
    .slice(0, limit);

  log('enrich', `需要补全 ${needs.length} 个，本次处理 ${selected.length} 个`);
  let done = 0;
  await mapLimit(selected, CRAWL.concurrency, async (candidate) => {
    const existing = existingMap.get(candidate.key);
    await enrichCandidate(candidate, { existing, force, noIcons });
    done += 1;
    if (done % 10 === 0) log('enrich', `进度 ${done}/${selected.length}`);
  });

  for (const candidate of candidates) {
    if (!candidate.title) {
      candidate.title = hostOf(candidate.url) || candidate.key;
    }
    if (!candidate.description) {
      candidate.description = '一个值得关注的 AI 站点。';
    }
  }

  return candidates;
}
