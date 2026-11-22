'use strict';
// Простой сервер без зависимостей: раздаёт сайт (index.html, music/…) и /api/tts.
// Запуск:  ELEVENLABS_API_KEY=… node server.js   или положите ключ в файл .env рядом и запустите  node server.js
// Нужен Node.js 18.17+ (встроенный fetch).

const http = require('http');
const fs = require('fs');
const path = require('path');

// .env (если есть) — значения из настоящего окружения важнее
(function loadEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue;
    let v = m[2].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1); else v = v.replace(/\s+#.*$/, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();

const { handle, config } = require('./lib/tts-core');

const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.md': 'text/plain; charset=utf-8'
};
// серверные файлы и скрытые файлы не раздаём
const PRIVATE = /^(server\.js|package(-lock)?\.json|vercel\.json|lib|api|node_modules)(\/|$)/;

function serveStatic(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  rel = path.posix.normalize(rel).replace(/^\/+/, '');
  if (!rel) rel = 'index.html';
  if (rel.split('/').some(p => p.startsWith('.')) || PRIVATE.test(rel)) { res.writeHead(404); return res.end('Not found'); }
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(404); return res.end('Not found'); }
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) { res.writeHead(404); return res.end('Not found'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    const headers = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes', 'Cache-Control': rel === 'index.html' ? 'no-cache' : 'public, max-age=3600' };
    // Range нужен Safari/iOS для аудио и видео
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? +range[1] : st.size - +range[2], end = range[1] && range[2] ? +range[2] : st.size - 1;
      start = Math.max(0, start); end = Math.min(st.size - 1, end);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 }));
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const p = (req.url || '').split('?')[0];
  if (p === '/api/tts' || p === '/api/tts/') return handle(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  serveStatic(req, res);
});
server.requestTimeout = 120000;

const PORT = Number(process.env.PORT) || 8000, HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  const c = config();
  console.log(`Дневник: http://localhost:${PORT}  ·  озвучка: ${c.key ? 'ElevenLabs ' + c.model : 'ВЫКЛ (нет ELEVENLABS_API_KEY) — будет голос браузера'}`);
});
