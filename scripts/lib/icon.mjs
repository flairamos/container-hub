import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBuffer } from './http.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const ICON_DIR = path.join(ROOT, 'assets', 'icons');
const ICON_PREFIX = 'assets/icons/';

export function safeIconBase(value) {
  return String(value || 'site')
    .toLowerCase()
    .replace(/^host:/, '')
    .replace(/^github:/, 'github-')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'site';
}

function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  const ascii = buffer.subarray(0, 12).toString('latin1');
  if (ascii.startsWith('GIF8')) return 'gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'webp';
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) {
    return 'ico';
  }
  if (ascii.includes('ftyp') && /avif|avis/.test(ascii)) return 'avif';

  const head = buffer.subarray(0, 4096).toString('utf8').trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) {
    const text = buffer.subarray(0, 300 * 1024).toString('utf8');
    if (/<svg[\s>]/i.test(text) && !/<script|onload\s*=|<foreignObject|javascript:/i.test(text)) {
      return 'svg';
    }
  }
  return null;
}

function iconPathFromExisting(existingPath) {
  if (!existingPath || !existingPath.startsWith(ICON_PREFIX)) return null;
  const normalized = existingPath.replace(/\\/g, '/');
  if (normalized.includes('..')) return null;
  return normalized;
}

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/**
 * 下载一个站点的图标并保存到 assets/icons/。
 * 任何失败都返回 null，由前端用首字母占位图兜底。
 */
export async function downloadIcon({
  hostKey,
  icons = [],
  siteUrl,
  existingPath = '',
  force = false,
  fileBase,
  timeout = 12000,
}) {
  await mkdir(ICON_DIR, { recursive: true });
  const base = fileBase || safeIconBase(hostKey);

  if (!force) {
    const existing = iconPathFromExisting(existingPath);
    if (existing && (await fileExists(path.join(ROOT, existing)))) return existing;
  }

  const candidates = [...icons];
  if (siteUrl) {
    try {
      const fallback = new URL('/favicon.ico', siteUrl).toString();
      if (!candidates.some((icon) => icon.url === fallback)) {
        candidates.push({ url: fallback, rel: 'icon', type: 'image/x-icon', sizes: '' });
      }
    } catch {
      // ignore
    }
  }

  for (const icon of candidates.slice(0, 5)) {
    try {
      const response = await fetchBuffer(icon.url, {
        timeout,
        maxBytes: 500 * 1024,
        headers: {
          referer: siteUrl || '',
          accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      });
      const ext = sniffImage(response.buffer);
      if (!ext) continue;
      const filename = `${base}.${ext}`;
      const absolute = path.join(ICON_DIR, filename);
      await writeFile(absolute, response.buffer);
      return `${ICON_PREFIX}${filename}`;
    } catch {
      // try next icon
    }
  }

  // 部分站点（尤其是被墙/有反爬的站点）首页与 favicon 都拿不到，
  // 用 favicon.im 作为最后的公共图标兜底；仍然失败就交给前端首字母占位。
  const host = String(hostKey || '').replace(/^host:/, '');
  if (host && !String(hostKey || '').startsWith('github:')) {
    try {
      const response = await fetchBuffer(`https://favicon.im/${encodeURIComponent(host)}?larger=true`, {
        timeout,
        maxBytes: 600 * 1024,
        headers: { accept: 'image/*,*/*;q=0.8' },
      });
      const ext = sniffImage(response.buffer);
      if (ext) {
        const filename = `${base}.${ext}`;
        await writeFile(path.join(ICON_DIR, filename), response.buffer);
        return `${ICON_PREFIX}${filename}`;
      }
    } catch {
      // fall through to existing icon / null
    }
  }

  // 强制刷新失败时，继续使用旧图标。
  const existing = iconPathFromExisting(existingPath);
  if (existing && (await fileExists(path.join(ROOT, existing)))) return existing;

  return null;
}

export async function downloadGithubAvatar(owner, hostKey, { existingPath = '', force = false } = {}) {
  const base = safeIconBase(hostKey || `github-${owner}`);
  const url = `https://github.com/${encodeURIComponent(owner)}.png?size=160`;
  return downloadIcon({
    hostKey,
    icons: [{ url, rel: 'icon', type: 'image/png', sizes: '160x160' }],
    siteUrl: `https://github.com/${encodeURIComponent(owner)}`,
    existingPath,
    force,
    fileBase: base,
  });
}


