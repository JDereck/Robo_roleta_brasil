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
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
    'Accept': 'application/json, text/plain, *_/*',
    'Origin': 'https://client.pragmaticplaylive.net',
    'Referer': 'https://client.pragmaticplaylive.net/'
  }
});

function getFortalezaTimestamp() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', hour12: false });
}

async function fetchAndProcess() {
  if (isRunning) return { status: 'skipped', reason: 'locked' };

  isRunning = true;
  try {
    // Vamos testar o endpoint padrão da API pública de estatísticas
    const historyUrl = `https://games.pragmaticplaylive.net/api/ui/stats?noOfGames=500&tableId=${TABLE_ID}`;
    
    console.log(`[TESTE] Requisitando URL: ${historyUrl}`);
    const res = await http.get(historyUrl);
    console.log(`[SUCESSO API] Resposta recebida com status ${res.status}`);
    
    return { status: 'success', dataSample: typeof res.data };
  } catch (err) {
    // AQUI ESTÁ O DETALHE: Vamos imprimir o corpo do erro retornado pela Pragmatic
    const errorBody = err.response ? JSON.stringify(err.response.data) : err.message;
    const errorStatus = err.response ? err.response.status : 'SEM STATUS';
    console.error(`[ERRO DETALHADO API] Status: ${errorStatus} | Corpo: ${errorBody}`);
    
    return { status: 'error', message: err.message };
  } finally {
    isRunning = false;
  }
}

setInterval(fetchAndProcess, POLL_INTERVAL_MS);

app.get('/', (req, res) => {
  res.json({
    service: 'Monitor Roleta Europeia - Diagnostico',
    status: 'online',
    tableId: TABLE_ID,
    timestamp: getFortalezaTimestamp()
  });
});

app.get('/health', async (req, res) => {
  const result = await fetchAndProcess();
  res.status(200).json({ ok: true, timestamp: getFortalezaTimestamp(), poll: result });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor de Diagnóstico rodando na porta ${PORT}`);
  fetchAndProcess();
});
