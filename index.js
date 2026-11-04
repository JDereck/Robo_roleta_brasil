const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TABLE_ID = process.env.TABLE_ID || 'rwbrzportrwa16rg';
const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || '';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 10000;

let isRunning = false;
let isSeeded = false;
let lastGameId = null;
const processedIds = new Set();

const http = axios.create({
  timeout: 8000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
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
    // Usando o endpoint de estatísticas públicas diretas da mesa
    const historyUrl = `https://games.pragmaticplaylive.net/api/ui/stats?noOfGames=500&tableId=${TABLE_ID}`;
    
    const res = await http.get(historyUrl);
    const data = res.data;

    const historyList = data.history || data.stats || (Array.isArray(data) ? data : null);
    if (!historyList || !Array.isArray(historyList)) {
      console.warn(`[AVISO API] Resposta inválida:`, JSON.stringify(data).slice(0, 150));
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

      console.log(`[SEED INICIAL] Sucesso! ${validSpins.length} rodadas carregadas.`);
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
    console.error(`[ERRO CAPTURA]`, err.response ? err.response.status : err.message);
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
