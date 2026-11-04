const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TABLE_ID = process.env.TABLE_ID || 'rwbrzportrwa16rg';
const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || '';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 10000;

let currentSessionId = process.env.JSESSIONID || 'Em5PMbAnD_w7_mBES6KwcKoaLXbvtdSBge-DrfZCp803Wg3hVv_y!385859884-0eb828dd';

// Controle de estado e concorrencia
let isRunning = false;
let isSeeded = false;
let lastGameId = null;
const processedIds = new Set();

const http = axios.create({
  timeout: 8000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://client.pragmaticplaylive.net',
    'Referer': 'https://client.pragmaticplaylive.net/'
  }
});

function getFortalezaTimestamp() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', hour12: false });
}

function parseSpin(item) {
  if (!item || !item.gameId || typeof item.gameResult !== 'string') return null;
  const num = parseInt(item.gameResult.trim(), 10);
  if (Number.isNaN(num) || num < 0 || num > 36) return null;
  return {
    gameId: String(item.gameId).trim(),
    number: num,
    rawResult: item.gameResult.trim(),
    timestamp: getFortalezaTimestamp()
  };
}

function rememberId(gameId) {
  processedIds.add(gameId);
  if (processedIds.size > 1000) {
    const oldest = processedIds.values().next().value;
    processedIds.delete(oldest);
  }
}

async function sendToWebhook(payload) {
  if (!GAS_WEBHOOK_URL) {
    console.log(`[MODO TESTE - SEM WEBHOOK] Payload pronto:`, JSON.stringify(payload));
    return true;
  }
  try {
    const res = await axios.post(GAS_WEBHOOK_URL, payload, { timeout: 10000 });
    console.log(`[WEBHOOK OK] Resposta GAS:`, res.data);
    return true;
  } catch (err) {
    console.error(`[ERRO WEBHOOK] Falha ao enviar para GAS: ${err.message}`);
    return false;
  }
}

async function fetchAndProcess() {
  if (isRunning) return { status: 'skipped', reason: 'locked' };
  if (!currentSessionId) return { status: 'error', reason: 'missing_jsessionid' };

  isRunning = true;
  try {
    const encodedSession = encodeURIComponent(decodeURIComponent(currentSessionId));
    const historyUrl = `https://games.pragmaticplaylive.net/api/ui/statisticHistory?JSESSIONID=${encodedSession}&numberOfGames=500&tableId=${TABLE_ID}`;
    const balanceUrl = `https://games.pragmaticplaylive.net/api/wallet/balance?JSESSIONID=${encodedSession}`;

    // Keep-alive da sessao em paralelo com a busca de historico
    const [historyRes] = await Promise.all([
      http.get(historyUrl),
      http.get(balanceUrl).catch(() => null)
    ]);

    const data = historyRes.data;
    if (!data || String(data.errorCode) !== '0' || !Array.isArray(data.history)) {
      console.warn(`[AVISO API] Resposta inesperada ou sessao expirada:`, JSON.stringify(data).slice(0, 200));
      return { status: 'invalid_response', data };
    }

    // Ordenar do mais antigo para o mais recente (cronologico)
    const validSpins = data.history.map(parseSpin).filter(Boolean).reverse();
    if (validSpins.length === 0) return { status: 'empty_history' };

    // Carga inicial (500 rodadas) na primeira execucao
    if (!isSeeded) {
      validSpins.forEach(s => rememberId(s.gameId));
      lastGameId = validSpins[validSpins.length - 1].gameId;
      isSeeded = true;

      console.log(`[SEED INICIAL] ${validSpins.length} rodadas carregadas. Ultima rodada: ID ${lastGameId} -> Numero ${validSpins[validSpins.length - 1].number}`);

      if (GAS_WEBHOOK_URL) {
        await sendToWebhook({ type: 'SEED', spins: validSpins });
      }
      return { status: 'seeded', count: validSpins.length, latest: validSpins[validSpins.length - 1] };
    }

    // Filtrar apenas rodadas novas ainda nao processadas
    const newSpins = validSpins.filter(s => !processedIds.has(s.gameId));
    if (newSpins.length === 0) {
      return { status: 'no_new_spin', lastGameId };
    }

    for (const spin of newSpins) {
      console.log(`🎰 [NOVA RODADA] ID: ${spin.gameId} | Numero: ${spin.number} (${spin.rawResult}) | Hora: ${spin.timestamp}`);
      const ok = await sendToWebhook({ type: 'NEW_SPIN', spin });
      if (ok) {
        rememberId(spin.gameId);
        lastGameId = spin.gameId;
      }
    }

    return { status: 'processed', newCount: newSpins.length, lastGameId };
  } catch (err) {
    console.error(`[ERRO CAPTURA] ${err.message}`);
    return { status: 'error', message: err.message };
  } finally {
    isRunning = false;
  }
}

// Loop periodico interno
setInterval(fetchAndProcess, POLL_INTERVAL_MS);

// Rotas Express
app.get('/', (req, res) => {
  res.json({
    service: 'Monitor Roleta Europeia',
    status: 'online',
    tableId: TABLE_ID,
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

// Rota utilitaria para atualizar o JSESSIONID sem precisar de redeploy
app.get('/set-session', async (req, res) => {
  const raw = req.query.id || req.query.url || '';
  if (!raw) return res.status(400).json({ error: 'Informe ?id=SEU_JSESSIONID ou ?url=URL_COMPLETA' });

  const match = raw.match(/JSESSIONID=([^&]+)/);
  currentSessionId = match ? decodeURIComponent(match[1]) : raw.trim();
  isSeeded = false;
  processedIds.clear();

  console.log(`[SESSAO ATUALIZADA] Novo JSESSIONID configurado.`);
  const test = await fetchAndProcess();
  res.json({ message: 'JSESSIONID atualizado', result: test });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  fetchAndProcess();
});
