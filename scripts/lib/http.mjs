import { USER_AGENT, CRAWL } from '../config.mjs';
import { sleep, warn } from './util.mjs';

const DEFAULT_HEADERS = {
  'user-agent': USER_AGENT,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'cache-control': 'no-cache',
};

function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function decodeBuffer(buffer, contentType = '') {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] || 'utf-8';
  if (/^gb(2312|k|18030)$/i.test(charset)) charset = 'gbk';
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

/**
 * 发起请求并返回原始响应。失败会抛出，由调用方决定是否跳过。
 */
export async function request(url, options = {}) {
  const {
    timeout = CRAWL.requestTimeout,
    headers = {},
    method = 'GET',
    retries = 0,
    redirect = 'follow',
    maxBytes = 5 * 1024 * 1024,
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        redirect,
        headers: { ...DEFAULT_HEADERS, ...headers },
        signal: timeoutSignal(timeout),
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} ${response.statusText}`);
        error.status = response.status;
        throw error;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > maxBytes) {
        throw new Error(`响应体过大（${buffer.byteLength} bytes）`);
      }
      return {
        buffer,
        contentType: response.headers.get('content-type') || '',
        status: response.status,
        finalUrl: response.url || url,
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(700 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

export async function fetchPage(url, options = {}) {
  const response = await request(url, options);
  return {
    text: decodeBuffer(response.buffer, response.contentType),
    finalUrl: response.finalUrl,
    contentType: response.contentType,
    status: response.status,
  };
}

export async function fetchText(url, options = {}) {
  const response = await request(url, options);
  return decodeBuffer(response.buffer, response.contentType);
}

export async function fetchJson(url, options = {}) {
  const text = await fetchText(url, {
    ...options,
    headers: {
      accept: 'application/json,text/plain,*/*',
      ...(options.headers || {}),
    },
  });
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON 解析失败: ${error.message}`);
  }
}

export async function fetchBuffer(url, options = {}) {
  return request(url, {
    maxBytes: options.maxBytes ?? 700 * 1024,
    ...options,
  });
}

/**
 * 只读探测 URL 是否在线，不下载完整页面。
 * 403/429 也视为在线（反爬/需要登录不代表站点下线）。
 */
export async function probeUrl(url, timeout = CRAWL.healthTimeout) {
  const headers = {
    accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    range: 'bytes=0-2048',
  };

  const attempt = async (method) => {
    const response = await fetch(url, {
      method,
      redirect: 'follow',
      headers: { ...DEFAULT_HEADERS, ...headers },
      signal: timeoutSignal(timeout),
    });
    try {
      if (response.body) await response.body.cancel();
    } catch {
      // ignore
    }
    return response;
  };

  const isOnlineStatus = (status) =>
    (status >= 200 && status < 400) || [401, 403, 416, 429].includes(status);

  try {
    let response = await attempt('HEAD');
    // 有些站点不支持 HEAD，会返回 400/404/405，用 GET 复核一次。
    if ([400, 403, 404, 405, 416, 501].includes(response.status)) {
      response = await attempt('GET');
    }
    const status = response.status;
    return isOnlineStatus(status)
      ? { ok: true, status }
      : { ok: false, status };
  } catch (error) {
    try {
      const response = await attempt('GET');
      const status = response.status;
      return isOnlineStatus(status)
        ? { ok: true, status }
        : { ok: false, status };
    } catch (secondError) {
      return { ok: false, status: 0, error: secondError.message || error.message };
    }
  }
}

/**
 * 有限的并发映射。worker 抛错时该项结果为 null，不影响其它任务。
 */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length).fill(null);
  let nextIndex = 0;
  const width = Math.max(1, Math.min(limit, items.length));

  async function run() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        warn('mapLimit', `任务 ${index} 失败: ${error.message}`);
        results[index] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: width }, run));
  return results;
}
