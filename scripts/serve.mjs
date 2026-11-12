import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function sendText(response, status, text, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  response.end(text);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = path.resolve(ROOT, `.${pathname}`);
    if (!filePath.startsWith(ROOT)) {
      sendText(response, 403, 'Forbidden');
      return;
    }

    let info;
    try {
      info = await stat(filePath);
    } catch {
      sendText(response, 404, 'Not found');
      return;
    }
    if (info.isDirectory()) {
      const index = path.join(filePath, 'index.html');
      try {
        info = await stat(index);
      } catch {
        sendText(response, 404, 'Not found');
        return;
      }
      response.writeHead(200, {
        'content-type': MIME['.html'],
        'cache-control': 'no-cache',
      });
      createReadStream(index).pipe(response);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const isData = pathname.startsWith('/data/');
    response.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': isData ? 'no-cache' : 'public, max-age=300',
      'content-length': info.size,
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    sendText(response, 500, `Server error: ${error.message}`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Container Hub 本地预览: http://127.0.0.1:${PORT}/`);
});
