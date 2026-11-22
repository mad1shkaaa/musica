'use strict';
// Vercel Serverless Function: GET /api/tts — состояние, POST /api/tts — озвучка.
// Ключ задаётся в Vercel → Project → Settings → Environment Variables → ELEVENLABS_API_KEY.
const { handle } = require('../lib/tts-core');

module.exports = (req, res) => handle(req, res);
