const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TABLE_ID = process.env.TABLE_ID || 'rwbrzportrwa16rg';
const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || '';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 10000;

// Token padrão inicial
let currentSessionId = process.env.JSESSIONID || '55548_121027_BRL^237^20261104T194142';

let isRunning = false;
let isSeeded = false;
let lastGameId = null;
const processedIds = new Set();

const http = axios.create({
  timeout: 8000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://client.pragmaticplaylive.net',
    'Referer': 'https://client.pragmaticplaylive.net/'
  }
});

function getFortalezaTimestamp() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', hour12: false });
}

async function sendToWebhook(payload) {
  if (!GAS_WEBHOOK_URL) return true;
  try {
    await axios.post(GAS_WEBHOOK_URL, payload, { timeout: 10000 });
    return true;
  } catch (err) {
    console.error(`[ERRO WEBHOOK]`, err.message);
    return false;
  }
}

async function fetchAndProcess() {
  if (isRunning) return { status: 'skipped', reason: 'locked' };

  isRunning = true;
  try {
    const encodedSession = encodeURIComponent(currentSessionId);
    const historyUrl = `https://games.pragmaticplaylive.net/api/ui/statisticHistory?JSESSIONID=${encodedSession}&numberOfGames=500&tableId=${TABLE_ID}`;
    
    const res = await http.get(historyUrl);
    const data = res.data;

    const historyList = data.history || (Array.isArray(data) ? data : null);
    if (!historyList || !Array.isArray(historyList)) {
      return { status: 'invalid_response' };
    }

    const validSpins = historyList.map(item => {
      if (!item || !item.gameId || typeof item.gameResult !== 'string') return null;
      const num = parseInt(item.gameResult.trim(), 10);
      if (Number.isNaN(num) || num < 0 || num > 36) return null;
      return {
        gameId: String(item.gameId).trim(),
        number: num,
        rawResult: item.gameResult.trim(),
        timestamp: getFortalezaTimestamp()
      };
    }).filter(Boolean).reverse();

    if (validSpins.length === 0) return { status: 'empty_history' };

    if (!isSeeded) {
      validSpins.forEach(s => processedIds.add(s.gameId));
      lastGameId = validSpins[validSpins.length - 1].gameId;
      isSeeded = true;

      console.log(`[SEED INICIAL] SUCESSO! ${validSpins.length} rodadas carregadas e enviadas para a planilha.`);
      await sendToWebhook({ type: 'SEED', spins: validSpins });
      return { status: 'seeded', count: validSpins.length };
    }

    const newSpins = validSpins.filter(s => !processedIds.has(s.gameId));
    for (const spin of newSpins) {
      console.log(`🎰 [NOVA RODADA] ID: ${spin.gameId} | Número: ${spin.number}`);
      const ok = await sendToWebhook({ type: 'NEW_SPIN', spin });
      if (ok) {
        processedIds.add(spin.gameId);
        lastGameId = spin.gameId;
      }
    }

    return { status: 'processed', count: newSpins.length };
  } catch (err) {
    const status = err.response ? err.response.status : 'ERRO';
    console.error(`[ERRO CAPTURA] Status: ${status} | Mensagem: ${err.message}`);
    return { status: 'error', code: status };
  } finally {
    isRunning = false;
  }
}

setInterval(fetchAndProcess, POLL_INTERVAL_MS);

app.get('/', (req, res) => {
  res.json({
    service: 'Monitor Roleta Europeia',
    status: 'online',
    isSeeded,
    lastGameId,
    processedCount: processedIds.size,
    timestamp: getFortalezaTimestamp()
  });
});

app.get('/health', async (req, res) => {
  const result = await fetchAndProcess();
  res.status(200).json({ ok: true, timestamp: getFortalezaTimestamp(), poll: result });
});

// Rota para atualizar o token instantaneamente direto pelo navegador/tablet
app.get('/set-session', async (req, res) => {
  const raw = req.query.id || req.query.url || '';
  if (!raw) return res.status(400).json({ error: 'Informe ?id=SEU_TOKEN' });
  currentSessionId = raw.trim();
  isSeeded = false;
  processedIds.clear();
  const test = await fetchAndProcess();
  res.json({ message: 'Token atualizado com sucesso!', result: test });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  fetchAndProcess();
});
