import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, CATEGORY_IDS, CRAWL, SITE } from './config.mjs';
import { collectCandidates, enrichCandidates } from './crawler.mjs';
import { Classifier, normalizeCategory, ruleClassify } from './classifier.mjs';
import { mapLimit, probeUrl } from './lib/http.mjs';
import { hostOf, siteKey } from './lib/url.mjs';
import { clamp, isRecent, log, nowIso } from './lib/util.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const DATA_PATH = path.join(DATA_DIR, 'data.json');
const PREVIEW_PATH = path.join(DATA_DIR, 'data.preview.json');
const CACHE_PATH = path.join(DATA_DIR, 'cache', 'llm-classify.json');

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--') && !arg.includes('=')));
  const values = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith('--') && arg.includes('='))
      .map((arg) => {
        const index = arg.indexOf('=');
        return [arg.slice(0, index), arg.slice(index + 1)];
      }),
  );
  return {
    dryRun: flags.has('--dry-run'),
    skipPing: flags.has('--skip-ping'),
    noIcons: flags.has('--no-icons'),
    force: flags.has('--refresh'),
    noLlm: flags.has('--no-llm'),
    skipEnrich: flags.has('--skip-enrich'),
    limit: Number(values['--limit'] || 0),
  };
}

async function readJsonSafe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function loadExisting() {
  const data = await readJsonSafe(DATA_PATH);
  if (!data) return { sites: [], map: new Map(), generatedAt: '' };
  const sites = Array.isArray(data) ? data : data.sites || [];
  const map = new Map();
  for (const site of sites) {
    const key = siteKey(site.url) || site.id;
    if (key) map.set(key, site);
  }
  return { sites, map, generatedAt: Array.isArray(data) ? '' : data.generatedAt || '' };
}

function existingKey(site) {
  return siteKey(site.url) || site.id || '';
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function computeScore(site) {
  let score = 40;
  score += clamp(Number(site.weight) || 0, 0, 40) * 0.7;
  score += Math.min(5, (site.sources?.length || 0) + 1) * 4;
  if (isRecent(site.firstSeenAt, 14)) score += 6;
  if (isRecent(site.lastSeenAt, 7)) score += 4;
  if (site.stars) score += Math.min(6, Math.log10(site.stars + 1) * 3);
  if (site.status === 'offline') score -= 35;
  return Math.round(clamp(score, 1, 99));
}

function sortSites(sites) {
  return [...sites].sort(
    (a, b) =>
      (b.score || 0) - (a.score || 0) ||
      String(a.title).localeCompare(String(b.title), 'zh-CN'),
  );
}

function pickPopular(sites, max = 12) {
  const sorted = sortSites(sites.filter((site) => site.status !== 'offline'));
  const picked = [];
  const perCategory = new Map();

  // 先保证分类多样性，避免热门区清一色编码工具。
  for (const site of sorted) {
    if (picked.length >= max) break;
    const count = perCategory.get(site.category) || 0;
    if (count >= 2) continue;
    picked.push(site);
    perCategory.set(site.category, count + 1);
  }
  for (const site of sorted) {
    if (picked.length >= max) break;
    if (!picked.includes(site)) picked.push(site);
  }
  return picked.map((site) => site.id);
}

async function classifyCandidates(candidates, existingMap, args) {
  const classifier = new Classifier({
    cachePath: CACHE_PATH,
    limit: CRAWL.llmLimit,
  });

  const counts = {};
  for (const candidate of candidates) {
    const existing = existingMap.get(candidate.key);
    let category =
      normalizeCategory(candidate.category) ||
      ruleClassify(candidate);

    if (!category && !args.noLlm) {
      category = await classifier.classify(candidate);
    }
    if (!category) {
      category = normalizeCategory(existing?.category) || normalizeCategory(candidate.hintCategory);
    }
    if (!category) category = 'ai-tool';

    candidate.category = category;
    counts[category] = (counts[category] || 0) + 1;
  }

  classifier.save();
  return { counts, llmCalls: classifier.calls };
}

function buildSites(candidates, existingMap, now, firstRun = false) {
  const sites = new Map();

  for (const candidate of candidates) {
    const existing = existingMap.get(candidate.key);
    const sources = new Set([...asArray(existing?.source), ...asArray(existing?.sources)]);
    for (const source of candidate.sources) sources.add(source);

    const title = candidate.title || existing?.title || hostOf(candidate.url) || candidate.key;
    const description =
      candidate.description || existing?.description || '一个值得关注的 AI 站点。';
    const firstSeenAt = existing?.firstSeenAt || candidate.publishedAt || now;
    const lastSeenAt = now;

    const site = {
      id: candidate.key,
      url: candidate.url,
      domain: hostOf(candidate.url),
      title,
      description,
      category: candidate.category || existing?.category || 'ai-tool',
      tags: [...new Set([...asArray(existing?.tags), ...(candidate.tags || [])])].slice(0, 6),
      icon: candidate.icon || existing?.icon || '',
      score: 0,
      weight: Math.max(Number(existing?.weight) || 0, Number(candidate.weight) || 0),
      source: [...sources].sort(),
      seeded: Boolean(existing?.seeded) || candidate.sources.has('seed'),
      isNew: !firstRun && !existing && !candidate.sources.has('seed'),
      firstSeenAt,
      lastSeenAt,
      status: existing?.status || 'online',
      failures: Number(existing?.failures) || 0,
    };
    site.score = computeScore(site);
    sites.set(site.id, site);
  }

  // 本次没有从任何源出现的站点也先保留，避免数据源临时故障导致整站消失。
  for (const existing of existingMap.values()) {
    const key = existingKey(existing);
    if (!key || sites.has(key)) continue;
    const site = {
      ...existing,
      id: existing.id || key,
      domain: existing.domain || hostOf(existing.url),
      tags: asArray(existing.tags),
      source: [...new Set([...asArray(existing.source), ...asArray(existing.sources)])],
      isNew: false,
      failures: Number(existing.failures) || 0,
    };
    site.score = computeScore(site);
    sites.set(key, site);
  }

  return sortSites([...sites.values()]);
}

async function checkHealth(sites) {
  const targets = sortSites(sites).slice(0, CRAWL.pingLimit);
  log('health', `开始检查 ${targets.length} 个站点（并发 ${CRAWL.concurrency}）`);
  let done = 0;
  await mapLimit(targets, CRAWL.concurrency, async (site) => {
    const result = await probeUrl(site.url);
    if (result.ok) {
      site.failures = 0;
      site.status = 'online';
      site.lastSeenAt = nowIso();
    } else {
      site.failures = (Number(site.failures) || 0) + 1;
      if (site.failures >= 7) site.status = 'offline';
      site.lastCheckedAt = nowIso();
    }
    done += 1;
    if (done % 25 === 0) log('health', `进度 ${done}/${targets.length}`);
  });

  const online = sites.filter((site) => site.status !== 'offline').length;
  log('health', `完成：在线 ${online}，离线 ${sites.length - online}`);
  return { checked: targets.length, online, offline: sites.length - online };
}

function validateData(data) {
  const errors = [];
  const ids = new Set();
  for (const site of data.sites) {
    if (!site.id) errors.push('存在缺少 id 的站点');
    if (ids.has(site.id)) errors.push(`重复站点 ${site.id}`);
    ids.add(site.id);
    if (!/^https?:\/\//i.test(site.url || '')) errors.push(`${site.id} URL 非法`);
    if (!CATEGORY_IDS.has(site.category)) errors.push(`${site.id} 分类非法: ${site.category}`);
    if (!site.title) errors.push(`${site.id} 缺少标题`);
  }
  if (errors.length) throw new Error(`数据校验失败:\n${errors.slice(0, 20).join('\n')}`);
}

async function writeData(data, dryRun) {
  validateData(data);
  await mkdir(DATA_DIR, { recursive: true });
  const output = dryRun ? PREVIEW_PATH : DATA_PATH;
  const temp = `${output}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rm(output, { force: true });
  await rename(temp, output);
  return output;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = nowIso();
  log('main', `开始抓取${args.dryRun ? '（dry-run）' : ''}`);

  const existing = await loadExisting();
  const firstRun = !existing.sites.length;
  log('main', `已有数据 ${existing.sites.length} 个站点${firstRun ? '（首次运行）' : ''}`);

  const candidates = await collectCandidates();
  log('main', `去重后候选 ${candidates.length} 个`);

  if (args.skipEnrich) {
    log('enrich', '按参数跳过元数据 / 图标补全');
  } else {
    await enrichCandidates(candidates, {
      existingMap: existing.map,
      force: args.force,
      noIcons: args.noIcons,
      limit: args.limit || CRAWL.enrichLimit,
    });
  }

  const { counts, llmCalls } = await classifyCandidates(candidates, existing.map, args);
  log(
    'main',
    `分类完成：${Object.entries(counts)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ')}${llmCalls ? `（LLM 调用 ${llmCalls} 次）` : ''}`,
  );

  let sites = buildSites(candidates, existing.map, now, firstRun);
  if (!args.skipPing) {
    const health = await checkHealth(sites);
    sites = sortSites(sites);
    sites.forEach((site) => {
      site.score = computeScore(site);
    });
    log('health', `在线率 ${Math.round((health.online / Math.max(1, sites.length)) * 100)}%`);
  }

  sites = sortSites(sites).slice(0, CRAWL.maxSites);
  for (const site of sites) site.score = computeScore(site);
  sites = sortSites(sites);

  const categoryCounts = Object.fromEntries(CATEGORIES.map((category) => [category.id, 0]));
  for (const site of sites) {
    if (categoryCounts[site.category] === undefined) categoryCounts[site.category] = 0;
    categoryCounts[site.category] += 1;
  }

  const stats = {
    total: sites.length,
    online: sites.filter((site) => site.status !== 'offline').length,
    // 首次生成时所有站点都是“刚发现”，显示几百个新增没有意义，直接归零。
    newThisWeek: sites.filter((site) => site.isNew).length,
    categories: categoryCounts,
    checkedAt: now,
  };

  const data = {
    generatedAt: now,
    updatedAt: now,
    site: SITE,
    categories: CATEGORIES.map((category) => ({
      ...category,
      count: categoryCounts[category.id] || 0,
    })),
    stats,
    popular: pickPopular(sites, 12),
    sites,
  };

  const output = await writeData(data, args.dryRun);
  const offline = sites.filter((site) => site.status === 'offline').length;
  log(
    'main',
    `写入 ${path.relative(ROOT, output)}：${sites.length} 个站点，${offline} 个离线，${stats.newThisWeek} 个本周新增`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
