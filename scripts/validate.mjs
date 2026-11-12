import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_IDS } from './config.mjs';
import { siteKey } from './lib/url.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DATA_PATH = path.join(ROOT, 'data', 'data.json');

async function main() {
  let data;
  try {
    data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  } catch (error) {
    console.error(`无法读取 data/data.json: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const errors = [];
  const warnings = [];
  const ids = new Set();
  const urls = new Set();

  for (const site of data.sites || []) {
    if (!site.id) errors.push('站点缺少 id');
    if (ids.has(site.id)) errors.push(`重复 id: ${site.id}`);
    ids.add(site.id);

    if (!/^https?:\/\//i.test(site.url || '')) {
      errors.push(`${site.id}: URL 非法`);
    } else if (urls.has(siteKey(site.url))) {
      errors.push(`${site.id}: URL 重复`);
    } else {
      urls.add(siteKey(site.url));
    }

    if (!CATEGORY_IDS.has(site.category)) {
      errors.push(`${site.id}: 未知分类 ${site.category}`);
    }
    if (!site.title) errors.push(`${site.id}: 缺少标题`);
    if (!site.description) warnings.push(`${site.id}: 缺少描述`);
    if (site.icon) {
      try {
        await access(path.join(ROOT, site.icon));
      } catch {
        warnings.push(`${site.id}: 图标文件不存在 ${site.icon}`);
      }
    }
  }

  for (const id of data.popular || []) {
    if (!ids.has(id)) errors.push(`热门列表引用了不存在的站点: ${id}`);
  }

  for (const id of ['index.html', 'assets/app.js', 'assets/styles.css']) {
    try {
      await access(path.join(ROOT, id));
    } catch {
      errors.push(`缺少文件: ${id}`);
    }
  }

  const categories = data.categories || [];
  if (!categories.length) errors.push('categories 为空');

  console.log(`站点: ${data.sites?.length || 0}`);
  console.log(`分类: ${categories.length}`);
  console.log(`热门: ${data.popular?.length || 0}`);
  console.log(`更新: ${data.updatedAt || '-'}`);
  if (warnings.length) {
    console.warn(`\n警告 (${warnings.length}):`);
    for (const warning of warnings.slice(0, 30)) console.warn(`  - ${warning}`);
  }
  if (errors.length) {
    console.error(`\n错误 (${errors.length}):`);
    for (const error of errors.slice(0, 30)) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('\n数据校验通过。');
}

main();
