const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const UTMIFY_URL = 'https://api.utmify.com.br/api-credentials/orders';
const TOKEN = process.env.UTMIFY_TOKEN || '';
const PLATFORM = process.env.DEFAULT_PLATFORM || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
const LOG_FILE = path.join(DATA_DIR, 'log.json');

function read(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function write(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

app.use(express.static(path.join(__dirname, 'public')));

// --- config -----------------------------------------------------------------

app.get('/api/config', (req, res) => {
  res.json({ hasToken: Boolean(TOKEN), platform: PLATFORM });
});

// --- presets (campanha / conjunto / anuncio salvos) --------------------------

app.get('/api/presets', (req, res) => {
  res.json(read(PRESETS_FILE, []));
});

app.post('/api/presets', (req, res) => {
  const presets = read(PRESETS_FILE, []);
  const preset = {
    id: Date.now().toString(36),
    label: String(req.body.label || '').trim(),
    utm_source: req.body.utm_source || null,
    utm_campaign: req.body.utm_campaign || null,
    utm_medium: req.body.utm_medium || null,
    utm_content: req.body.utm_content || null,
    utm_term: req.body.utm_term || null,
  };
  if (!preset.label) {
    return res.status(400).json({ error: 'Dê um nome ao preset antes de salvar.' });
  }
  presets.unshift(preset);
  write(PRESETS_FILE, presets);
  res.json(preset);
});

app.delete('/api/presets/:id', (req, res) => {
  const presets = read(PRESETS_FILE, []).filter((p) => p.id !== req.params.id);
  write(PRESETS_FILE, presets);
  res.json({ ok: true });
});

// --- envio -------------------------------------------------------------------

app.post('/api/orders', async (req, res) => {
  if (!TOKEN) {
    return res.status(500).json({
      ok: false,
      response: { error: 'UTMIFY_TOKEN não está definido nas variáveis de ambiente do serviço.' },
    });
  }

  let upstream;
  try {
    upstream = await fetch(UTMIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-token': TOKEN },
      body: JSON.stringify(req.body),
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      response: { error: 'Não foi possível alcançar a API da Utmify: ' + err.message },
    });
  }

  const raw = await upstream.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }

  const log = read(LOG_FILE, []);
  log.unshift({
    at: new Date().toISOString(),
    ok: upstream.ok,
    statusCode: upstream.status,
    orderId: req.body.orderId,
    isTest: Boolean(req.body.isTest),
    status: req.body.status,
    totalPriceInCents: req.body?.commission?.totalPriceInCents ?? null,
    utm_campaign: req.body?.trackingParameters?.utm_campaign ?? null,
    response: parsed,
  });
  write(LOG_FILE, log.slice(0, 500));

  res.status(upstream.ok ? 200 : 400).json({
    ok: upstream.ok,
    statusCode: upstream.status,
    response: parsed,
  });
});

app.get('/api/log', (req, res) => {
  res.json(read(LOG_FILE, []).slice(0, 60));
});

app.listen(PORT, () => {
  console.log(`utmify-bridge ouvindo na porta ${PORT}`);
  if (!TOKEN) console.warn('AVISO: UTMIFY_TOKEN não definido. Os envios vão falhar.');
});
