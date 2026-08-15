const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '4mb' }));

const PORT = process.env.PORT || 3000;
const UTMIFY_URL = 'https://api.utmify.com.br/api-credentials/orders';
const TOKEN = process.env.UTMIFY_TOKEN || '';
const PLATFORM = process.env.DEFAULT_PLATFORM || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_BATCH = 500;
const DELAY_MS = 150;

fs.mkdirSync(DATA_DIR, { recursive: true });
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
const LOG_FILE = path.join(DATA_DIR, 'log.json');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (tag, date, type) => `${tag}|${date}|${type}`;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({ hasToken: Boolean(TOKEN), platform: PLATFORM });
});

// --- presets ----------------------------------------------------------------

app.get('/api/presets', (req, res) => res.json(read(PRESETS_FILE, [])));

app.post('/api/presets', (req, res) => {
  const presets = read(PRESETS_FILE, []);
  const label = String(req.body.label || '').trim();
  if (!label) return res.status(400).json({ error: 'Dê um nome ao preset antes de salvar.' });
  const preset = {
    id: Date.now().toString(36),
    label,
    tag: req.body.tag || null,
    utm_source: req.body.utm_source || null,
    utm_campaign: req.body.utm_campaign || null,
    utm_medium: req.body.utm_medium || null,
    utm_content: req.body.utm_content || null,
    utm_term: req.body.utm_term || null,
  };
  presets.unshift(preset);
  write(PRESETS_FILE, presets);
  res.json(preset);
});

app.delete('/api/presets/:id', (req, res) => {
  write(PRESETS_FILE, read(PRESETS_FILE, []).filter((p) => p.id !== req.params.id));
  res.json({ ok: true });
});

// --- estado do dia (o que já foi lançado) -----------------------------------

app.get('/api/state', (req, res) => {
  const { tag, date, type } = req.query;
  const ledger = read(LEDGER_FILE, {});
  const entry = ledger[key(tag, date, type)] || { count: 0, totalCents: 0, updatedAt: null };
  res.json(entry);
});

app.post('/api/state/reset', (req, res) => {
  const { tag, date, type, count, totalCents } = req.body;
  const ledger = read(LEDGER_FILE, {});
  const k = key(tag, date, type);
  if (Number(count) === 0 && Number(totalCents) === 0) delete ledger[k];
  else ledger[k] = {
    count: Number(count) || 0,
    totalCents: Number(totalCents) || 0,
    updatedAt: new Date().toISOString(),
  };
  write(LEDGER_FILE, ledger);
  res.json(ledger[k] || { count: 0, totalCents: 0, updatedAt: null });
});

// --- envio do incremento ----------------------------------------------------

app.post('/api/batch', async (req, res) => {
  if (!TOKEN) {
    return res.status(500).json({ error: 'UTMIFY_TOKEN não está definido nas variáveis de ambiente.' });
  }

  const orders = Array.isArray(req.body.orders) ? req.body.orders : [];
  if (!orders.length) return res.status(400).json({ error: 'Nenhum registro para enviar.' });
  if (orders.length > MAX_BATCH) return res.status(400).json({ error: `Limite de ${MAX_BATCH} por envio.` });

  let sent = 0;
  let sentCents = 0;
  const failures = [];
  const samples = [];

  for (const order of orders) {
    try {
      const upstream = await fetch(UTMIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-token': TOKEN },
        body: JSON.stringify(order),
      });
      const raw = await upstream.text();
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }

      if (samples.length < 3) {
        samples.push({ orderId: order.orderId, statusCode: upstream.status, response: parsed });
      }
      if (upstream.ok) {
        sent += 1;
        sentCents += order?.commission?.totalPriceInCents || 0;
      } else {
        failures.push({ orderId: order.orderId, statusCode: upstream.status, response: parsed });
      }
    } catch (err) {
      failures.push({ orderId: order.orderId, statusCode: 0, response: err.message });
    }
    await sleep(DELAY_MS);
  }

  // o contador só avança com o que a API aceitou, e nunca em modo teste
  const isTest = Boolean(orders[0]?.isTest);
  let state = null;
  if (!isTest && sent > 0) {
    const ledger = read(LEDGER_FILE, {});
    const k = key(req.body.tag, req.body.date, req.body.type);
    const prev = ledger[k] || { count: 0, totalCents: 0 };
    ledger[k] = {
      count: prev.count + sent,
      totalCents: prev.totalCents + sentCents,
      updatedAt: new Date().toISOString(),
    };
    write(LEDGER_FILE, ledger);
    state = ledger[k];
  }

  const log = read(LOG_FILE, []);
  log.unshift({
    at: new Date().toISOString(),
    tag: req.body.tag || null,
    date: req.body.date || null,
    isTest,
    count: orders.length,
    sent,
    failed: failures.length,
    totalCents: sentCents,
    utm_campaign: orders[0]?.trackingParameters?.utm_campaign ?? null,
    sampleErrors: failures.slice(0, 3),
  });
  write(LOG_FILE, log.slice(0, 300));

  res.json({
    count: orders.length,
    sent,
    failed: failures.length,
    failures: failures.slice(0, 20),
    samples,
    state,
    firstId: orders[0]?.orderId || null,
    lastId: orders[orders.length - 1]?.orderId || null,
  });
});

app.get('/api/log', (req, res) => res.json(read(LOG_FILE, []).slice(0, 60)));

app.listen(PORT, () => {
  console.log(`utmify-bridge ouvindo na porta ${PORT}`);
  if (!TOKEN) console.warn('AVISO: UTMIFY_TOKEN não definido. Os envios vão falhar.');
});
