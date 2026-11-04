const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TABLE_ID = process.env.TABLE_ID || 'rwbrzportrwa16rg';
const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || '';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 10000;

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
  if (!GAS_WEBHOOK_URL) {
    console.log(`[MODO TESTE - SEM WEBHOOK] Payload:`, JSON.stringify(payload));
    return true;
  }
  try {
    const res = await axios.post(GAS_WEBHOOK_URL, payload, { timeout: 10000 });
    console.log(`[WEBHOOK SUCESSO] Resposta do Google:`, res.data);
    return true;
  } catch (err) {
    console.error(`[ERRO WEBHOOK]`, err.response ? err.response.data : err.message);
    return false;
  }
}

async function fetchAndProcess() {
  if (isRunning) return { status: 'skipped', reason: 'locked' };

  isRunning = true;
  try {
    const encodedSession = encodeURIComponent(currentSessionId);
    const historyUrl = `https://games.pragmaticplaylive.net/api/ui/statisticHistory?JSESSIONID=${encodedSession}&numberOfGames=50&tableId=${TABLE_ID}`;
    
    const res = await http.get(historyUrl);
    const data = res.data;

    const historyList = data.history || (Array.isArray(data) ? data : null);
    if (!historyList || !Array.isArray(historyList)) {
      console.warn(`[AVISO API] Histórico vazio ou inválido`);
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

      console.log(`[SEED INICIAL] Enviando ${validSpins.length} rodadas para o Apps Script...`);
      await sendToWebhook({ type: 'SEED', spins: validSpins });
      return { status: 'seeded', count: validSpins.length };
    }

    return { status: 'monitoring' };
  } catch (err) {
    console.error(`[ERRO CAPTURA]`, err.response ? err.response.data : err.message);
    return { status: 'error' };
  } finally {
    isRunning = false;
  }
}

setInterval(fetchAndProcess, POLL_INTERVAL_MS);

app.get('/', (req, res) => {
  res.json({ service: 'Monitor Roleta', status: 'online', isSeeded, lastGameId });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  fetchAndProcess();
});
