'use strict';
// Серверная озвучка «Дневника моей жизни» через ElevenLabs.
// Ключ берётся ТОЛЬКО из переменной окружения ELEVENLABS_API_KEY и никогда не уходит в браузер.
// Браузер присылает имя голоса (happy, woman…), режим-эмоцию и текст. Модель, Voice ID и аудиотеги
// знает только сервер, поэтому чужой сайт или скрипт не может озвучить что угодно произвольным голосом.
//
// Ограничение расходов (все значения можно поменять переменными окружения, см. .env.example):
//   • длина одного запроса (TTS_MAX_CHARS);
//   • запросы в минуту с одного IP (TTS_IP_PER_MINUTE);
//   • кредиты в сутки с одного IP (TTS_IP_DAILY_CREDITS);
//   • кредиты в сутки на весь сайт (TTS_DAILY_CREDITS);
//   • одновременные запросы к ElevenLabs (TTS_CONCURRENCY; на тарифе сейчас максимум 3);
//   • кэш готового аудио в памяти: повтор того же текста не тратит кредиты.
// Счётчики хранятся в памяти процесса и обнуляются в полночь UTC и при перезапуске.
// На Vercel у каждого экземпляра функции свои счётчики, поэтому жёсткий потолок расходов
// задавайте ещё и в самом ElevenLabs: лимит кредитов у API-ключа (Developers → API Keys → Credit limit).

const crypto = require('crypto');

const API = 'https://api.elevenlabs.io';

// 7 клонированных голосов. Проверены через API: все доступны и работают с eleven_v4.
const VOICES = Object.freeze({
  happy: '5aKTR1GbcprADzIkRkq7',
  woman: 'OnzfALW4NcsUGv6gIySX',
  angry: 'r8kGVfmkVS9h1qo5x8Du',
  mysterious: 'cXOGJ2XlAMuVwLvlCkT8',
  man: 'ACot1a07w91eQTuyoCx9',
  zesty: 'cCbQmhtdwLF899chOvMS',
  sad: 'IvFE0YVuzVo5X2d9n1Qa'
});

// Эмоции → аудиотеги. Eleven v4 понимает теги (проверено: [whispers] звучит шёпотом, а не читается вслух).
// Неизвестный режим просто озвучивается без тега.
const MODE_TAGS = Object.freeze({
  happy: '[happily]', soft: '[softly]', nostalgic: '[nostalgic]', dreamy: '[dreamy]', cheerful: '[cheerfully]',
  relaxed: '[relaxed]', amused: '[amused]', thoughtful: '[thoughtfully]', warm: '[warmly]', gentle: '[gently]',
  playful: '[playfully]', mysterious: '[mysteriously]', calmN: '[calmly]', wonder: '[in awe]', epic: '[dramatically]',
  excited: '[excited]', sincere: '[sincerely]', hopeful: '[hopefully]', melancholic: '[wistfully]',
  annoyed: '[annoyed]', sarcastic: '[sarcastic]'
});

const LANGS = new Set(['ru', 'kk', 'en']);

function num(name, def) { const v = Number(process.env[name]); return Number.isFinite(v) && v >= 0 ? v : def; }
function flag(name, def) { const v = (process.env[name] || '').trim().toLowerCase(); return v ? ['1', 'on', 'true', 'yes'].includes(v) : def; }

function config() {
  return {
    key: (process.env.ELEVENLABS_API_KEY || '').trim(),
    // Модель, на которой голос Happy проверен в приложении и через API. Меняется только переменной окружения.
    model: (process.env.ELEVENLABS_MODEL_ID || 'eleven_v4').trim(),
    stability: Math.min(1, num('ELEVENLABS_STABILITY', 0.5)), // 0.5 = «Natural»
    similarity: Math.min(1, num('ELEVENLABS_SIMILARITY', 0.75)),
    format: (process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128').trim(),
    audioTags: flag('TTS_AUDIO_TAGS', true),
    // false = Language Override «Auto», как при проверке в приложении. true = передавать язык сайта (ru/kk/en).
    sendLanguage: flag('TTS_SEND_LANGUAGE', false),
    maxChars: num('TTS_MAX_CHARS', 2500),
    maxTotal: num('TTS_MAX_TEXT_CHARS', 6000),
    ipPerMinute: num('TTS_IP_PER_MINUTE', 10),
    ipDaily: num('TTS_IP_DAILY_CREDITS', 8000),
    daily: num('TTS_DAILY_CREDITS', 40000),
    concurrency: Math.max(1, num('TTS_CONCURRENCY', 2)),
    queueWaitMs: num('TTS_QUEUE_WAIT_MS', 20000),
    timeoutMs: num('TTS_TIMEOUT_MS', 60000),
    cacheBytes: num('TTS_CACHE_MB', 32) * 1024 * 1024,
    origins: (process.env.TTS_ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean),
    trustProxy: flag('TRUST_PROXY', !!process.env.VERCEL)
  };
}

// ---------------- счётчики расходов ----------------
const state = { day: '', used: 0, ip: new Map(), active: 0, queue: [] };
function today() { return new Date().toISOString().slice(0, 10); }
function rollDay() { const d = today(); if (state.day !== d) { state.day = d; state.used = 0; state.ip.clear(); } }
function ipRec(ip) {
  let r = state.ip.get(ip); if (!r) { r = { used: 0, hits: [] }; state.ip.set(ip, r); }
  if (state.ip.size > 20000) { for (const k of state.ip.keys()) { state.ip.delete(k); if (state.ip.size <= 15000) break; } }
  return r;
}

// ---------------- кэш аудио (LRU по объёму) ----------------
const cache = new Map(); let cacheSize = 0;
function cacheGet(k) { const v = cache.get(k); if (v) { cache.delete(k); cache.set(k, v); } return v; }
function cachePut(k, buf, limit) {
  if (!limit || buf.length > limit / 4) return;
  if (cache.has(k)) return; cache.set(k, buf); cacheSize += buf.length;
  for (const [key, b] of cache) { if (cacheSize <= limit) break; cache.delete(key); cacheSize -= b.length; }
}

// ---------------- очередь одновременных запросов ----------------
function acquire(cfg) {
  if (state.active < cfg.concurrency) { state.active++; return Promise.resolve(true); }
  return new Promise(res => {
    const item = { res, tm: setTimeout(() => { const i = state.queue.indexOf(item); if (i >= 0) state.queue.splice(i, 1); res(false); }, cfg.queueWaitMs) };
    state.queue.push(item);
  });
}
function release() {
  const next = state.queue.shift();
  if (next) { clearTimeout(next.tm); next.res(true); } else state.active = Math.max(0, state.active - 1);
}

// ---------------- HTTP-помощники ----------------
class TTSError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; Object.assign(this, extra || {}); }
}
function sendJson(res, status, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers || {}));
  res.end(body);
}
function sendError(res, e) {
  const h = {}; if (e.retryAfter) h['Retry-After'] = String(e.retryAfter);
  sendJson(res, e.status || 500, { ok: false, error: { code: e.code || 'internal', message: e.message, retryAfter: e.retryAfter || undefined } }, h);
}
function clientIp(req, cfg) {
  if (cfg.trustProxy) {
    const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || String(req.headers['x-real-ip'] || '').trim();
    if (xf) return xf;
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
function originOk(req, cfg) {
  const origin = req.headers.origin;
  if (!origin) return true; // не браузер или запрос с того же адреса без Origin — защищают лимиты
  const o = String(origin).replace(/\/+$/, '');
  if (cfg.origins.length) return cfg.origins.includes(o) || cfg.origins.includes('*');
  try { return new URL(o).host === String(req.headers['x-forwarded-host'] || req.headers.host || ''); } catch (e) { return false; }
}
async function readJson(req, limit) {
  if (req.body !== undefined && req.body !== null && !Buffer.isBuffer(req.body)) { // Vercel уже разобрал тело
    if (typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') { if (req.body.length > limit) throw new TTSError(413, 'too_long', 'Request too large'); return JSON.parse(req.body); }
  }
  const chunks = []; let size = 0;
  if (Buffer.isBuffer(req.body)) chunks.push(req.body), size = req.body.length;
  else for await (const c of req) { size += c.length; if (size > limit) throw new TTSError(413, 'too_long', 'Request too large'); chunks.push(c); }
  if (size > limit) throw new TTSError(413, 'too_long', 'Request too large');
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// ---------------- запрос к ElevenLabs ----------------
function upstreamError(status, detail, headers) {
  const st = detail && (detail.status || detail.code) || '';
  const ra = Number(headers.get('retry-after')) || undefined;
  console.error('[tts] ElevenLabs HTTP', status, st, detail && detail.request_id || '');
  if (st === 'quota_exceeded' || status === 402) return new TTSError(402, 'quota_exceeded', 'ElevenLabs credits are exhausted');
  if (st === 'voice_not_found') return new TTSError(502, 'voice_unavailable', 'Voice is not available');
  if (st === 'unsupported_language') return new TTSError(400, 'unsupported_language', 'Language is not supported by the model');
  if (status === 401 || st === 'invalid_api_key' || st === 'missing_permissions') return new TTSError(503, 'server_config', 'TTS server key is invalid or lacks permissions');
  if (status === 429 || st === 'too_many_concurrent_requests' || st === 'system_busy') return new TTSError(503, 'busy', 'TTS service is busy', { retryAfter: ra || 5, retryable: true });
  if (status >= 500) return new TTSError(502, 'upstream_error', 'TTS service error', { retryable: true });
  return new TTSError(502, 'upstream_error', 'TTS request failed');
}

async function callEleven(cfg, voiceId, payload) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, Math.min(4000, (last && last.retryAfter || 1) * 1000)));
    let r;
    try {
      r = await fetch(`${API}/v1/text-to-speech/${voiceId}?output_format=${encodeURIComponent(cfg.format)}`, {
        method: 'POST',
        headers: { 'xi-api-key': cfg.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(cfg.timeoutMs)
      });
    } catch (e) {
      last = e && e.name === 'TimeoutError' ? new TTSError(504, 'timeout', 'TTS service timed out', { retryable: false })
        : new TTSError(502, 'upstream_unreachable', 'TTS service is unreachable', { retryable: true });
      console.error('[tts] fetch failed:', e && e.name, e && e.message);
      if (!last.retryable) throw last; continue;
    }
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) { last = new TTSError(502, 'upstream_error', 'Empty audio', { retryable: true }); continue; }
      return { buf, cost: Number(r.headers.get('character-cost')) };
    }
    let detail = null; try { const j = await r.json(); detail = j && j.detail; } catch (e) { }
    last = upstreamError(r.status, typeof detail === 'object' ? detail : { message: detail }, r.headers);
    if (!last.retryable) throw last;
  }
  throw last;
}

// ---------------- обработчики ----------------
function status(res) {
  const cfg = config(); rollDay();
  sendJson(res, 200, {
    ok: !!cfg.key, model: cfg.model, voices: Object.keys(VOICES), maxChars: cfg.maxChars, maxTotal: cfg.maxTotal,
    tags: cfg.audioTags, langs: [...LANGS]
  });
}

async function synth(req, res) {
  const cfg = config(); rollDay();
  if (!cfg.key) throw new TTSError(503, 'server_config', 'ELEVENLABS_API_KEY is not set on the server');
  if (!originOk(req, cfg)) throw new TTSError(403, 'forbidden_origin', 'Origin is not allowed');
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) throw new TTSError(415, 'bad_request', 'Content-Type must be application/json');

  let body; try { body = await readJson(req, 64 * 1024); } catch (e) { if (e instanceof TTSError) throw e; throw new TTSError(400, 'bad_request', 'Invalid JSON'); }
  const voice = String(body.voice || ''), mode = String(body.mode || ''), lang = String(body.lang || '');
  const voiceId = Object.prototype.hasOwnProperty.call(VOICES, voice) ? VOICES[voice] : null;
  if (!voiceId) throw new TTSError(400, 'bad_voice', 'Unknown voice');
  // убираем управляющие символы, нормализуем пробелы
  const text = String(body.text || '').normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!text) throw new TTSError(400, 'empty_text', 'Text is empty');
  if (text.length > cfg.maxChars) throw new TTSError(413, 'too_long', `Text is longer than ${cfg.maxChars} characters`, { maxChars: cfg.maxChars });

  const tag = cfg.audioTags && Object.prototype.hasOwnProperty.call(MODE_TAGS, mode) ? MODE_TAGS[mode] : '';
  const tagged = tag ? text.split(/\n\s*\n/).map(p => tag + ' ' + p.trim()).join('\n\n') : text;
  const payload = { text: tagged, model_id: cfg.model, voice_settings: { stability: cfg.stability, similarity_boost: cfg.similarity } };
  if (cfg.sendLanguage && LANGS.has(lang)) payload.language_code = lang;

  const ck = crypto.createHash('sha256').update(JSON.stringify([voiceId, payload, cfg.format])).digest('hex');
  const hit = cacheGet(ck);
  const ip = clientIp(req, cfg), rec = ipRec(ip), now = Date.now();

  // запросы в минуту — считаются всегда, даже для кэша (защита от перебора)
  rec.hits = rec.hits.filter(t => now - t < 60000);
  if (cfg.ipPerMinute && rec.hits.length >= cfg.ipPerMinute) throw new TTSError(429, 'rate_limited', 'Too many requests, try again in a minute', { retryAfter: Math.ceil((60000 - (now - rec.hits[0])) / 1000) || 1 });
  rec.hits.push(now);

  if (hit) return sendAudio(res, hit, 'hit');

  // резервируем верхнюю оценку (1 символ = 1 кредит), после ответа уточняем по заголовку Character-Cost
  const reserve = tagged.length;
  if (cfg.daily && state.used + reserve > cfg.daily) throw new TTSError(429, 'daily_limit', 'Daily narration limit of the site is reached', { retryAfter: secondsToMidnight() });
  if (cfg.ipDaily && rec.used + reserve > cfg.ipDaily) throw new TTSError(429, 'daily_limit', 'Your daily narration limit is reached', { retryAfter: secondsToMidnight() });
  state.used += reserve; rec.used += reserve;

  const got = await acquire(cfg);
  if (!got) { state.used -= reserve; rec.used -= reserve; throw new TTSError(503, 'busy', 'TTS service is busy', { retryAfter: 5 }); }
  let out;
  try { out = await callEleven(cfg, voiceId, payload); }
  catch (e) { state.used = Math.max(0, state.used - reserve); rec.used = Math.max(0, rec.used - reserve); throw e; }
  finally { release(); }

  const cost = Number.isFinite(out.cost) && out.cost >= 0 ? out.cost : reserve;
  state.used = Math.max(0, state.used - reserve + cost); rec.used = Math.max(0, rec.used - reserve + cost);
  cachePut(ck, out.buf, cfg.cacheBytes);
  return sendAudio(res, out.buf, 'miss', cost);
}

function secondsToMidnight() { const d = new Date(); return Math.max(60, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d) / 1000)); }

function sendAudio(res, buf, cacheState, cost) {
  const h = { 'Content-Type': 'audio/mpeg', 'Content-Length': String(buf.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-TTS-Cache': cacheState };
  if (cost !== undefined) h['X-TTS-Cost'] = String(cost);
  res.writeHead(200, h); res.end(buf);
}

// Общая точка входа: GET — состояние сервиса, POST — озвучка
async function handle(req, res) {
  try {
    if (req.method === 'GET' || req.method === 'HEAD') return status(res);
    if (req.method === 'POST') return await synth(req, res);
    res.setHeader('Allow', 'GET, POST');
    throw new TTSError(405, 'bad_request', 'Method not allowed');
  } catch (e) {
    if (!(e instanceof TTSError)) { console.error('[tts] internal error:', e); e = new TTSError(500, 'internal', 'Internal error'); }
    if (!res.headersSent) sendError(res, e); else res.end();
  }
}

module.exports = { handle, VOICES, MODE_TAGS, config, _state: state };
