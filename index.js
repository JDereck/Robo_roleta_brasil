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
    console.log(`[MODO TESTE - SEM WEBHOOK] Payload:`, JSON.stringify(payload));
    return true;
  }
  try {
    await axios.post(GAS_WEBHOOK_URL, payload, { timeout: 10000 });
    return true;
  } catch (err) {
    console.error(`[ERRO WEBHOOK] ${err.message}`);
    return false;
  }
}

async function fetchAndProcess() {
  if (isRunning) return { status: 'skipped', reason: 'locked' };

  isRunning = true;
  try {
    // Endpoint publico de estatisticas da mesa (sem exigencia de sessao autenticada)
    const historyUrl = `https://games.pragmaticplaylive.net/api/ui/stats?noOfGames=500&tableId=${TABLE_ID}`;
    
    const res = await http.get(historyUrl);
    const data = res.data;
    
    // A Pragmatic as vezes retorna o historico em 'history' ou direto no array de estatisticas
    const historyList = data.history || data.stats || (Array.isArray(data) ? data : null);

    if (!historyList || !Array.isArray(historyList)) {
      console.warn(`[AVISO API] Formato inesperado:`, JSON.stringify(data).slice(0, 200));
      return { status: 'invalid_response', data };
    }

    const validSpins = historyList.map(parseSpin).filter(Boolean).reverse
