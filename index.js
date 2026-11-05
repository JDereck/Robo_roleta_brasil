const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// URL do seu Google Apps Script
let GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbzsD45UPV6mQAKLCzVnLCtdAGoG7AVzqwVLjB9y188fzBZc2PXqLz1I6Tbgyoopghb0/exec";

let JSESSIONID = process.env.JSESSIONID || "";
let TABLE_ID = process.env.TABLE_ID || "237";
let CUSTOM_API_URL = process.env.CUSTOM_API_URL || "";
let ultimoGameId = null;
let statusColetor = "Aguardando configuração de sessão ou API";

// Motor de captura automática em nuvem (opcional)
setInterval(async () => {
  try {
    let urlBusca = "";
    if (CUSTOM_API_URL) {
      urlBusca = CUSTOM_API_URL;
    } else if (JSESSIONID) {
      urlBusca = `https://games.pragmaticplaylive.net/api/ui/statisticHistory?tableId=${TABLE_ID}&numberOfGames=10&JSESSIONID=${encodeURIComponent(JSESSIONID)}`;
    } else {
      return;
    }

    const res = await axios.get(urlBusca, { timeout: 6000 });
    const data = res.data;
    const listaHistorico = data.history || data.results || data.data || [];
    if (!Array.isArray(listaHistorico) || listaHistorico.length === 0) return;

    const ultimoGiro = listaHistorico[0];
    const gameId = String(ultimoGiro.gameId || ultimoGiro.id || ultimoGiro.time || "");
    const rawResult = String(ultimoGiro.gameResult || ultimoGiro.result || ultimoGiro.number || "");
    const matchNum = rawResult.match(/\b([0-9]|[12][0-9]|3[0-6])\b/);

    if (matchNum && gameId && gameId !== ultimoGameId) {
      ultimoGameId = gameId;
      const numero = parseInt(matchNum[1], 10);
      statusColetor = `✅ Ativo! Último nº: ${numero}`;
      await enviarParaPlanilha(numero, gameId);
    }
  } catch (err) {
    statusColetor = `❌ Erro na leitura da API`;
  }
}, 5000);

async function enviarParaPlanilha(num, gameId) {
  const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
  const payloadToGAS = {
    type: 'NEW_SPIN',
    spin: {
      gameId: gameId || ("cloud_" + Date.now()),
      number: parseInt(num, 10),
      rawResult: String(num),
      timestamp: timestamp
    }
  };

  try {
    await axios.post(GAS_WEBHOOK_URL, payloadToGAS, { timeout: 10000 });
    console.log(`✅ [NUVEM -> PLANILHA] Nº ${num} enviado com sucesso!`);
  } catch (err) {
    console.error(`❌ [ERRO GAS]:`, err.message);
  }
}

// Rota para disparar giros manuais diretamente via navegador ou link
app.get('/report', async (req, res) => {
  const num = req.query.num;
  if (num === undefined) return res.status(400).send('Falta o parâmetro ?num=');
  
  await enviarParaPlanilha(num, "manual_" + Date.now());
  res.send(`<h2>✅ Número ${num} enviado com sucesso para a planilha e Telegram!</h2><p><a href="/">Voltar ao painel</a></p>`);
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Controle Nuvem</title></head>
      <body style="background:#111; color:#fff; font-family:Arial; padding:20px; max-width:500px; margin:auto;">
        <h2 style="color:#00ffcc;">🚀 Robô Roleta em Nuvem</h2>
        <p><b>Status:</b> <span style="color:#ffcc00;">${statusColetor}</span></p>
        <hr style="border-color:#333;">
        <h3>🎯 Teste Rápido / Envio Manual:</h3>
        <p>Para enviar um número direto, acesse no navegador:</p>
        <code>https://robo-roleta-brasil.onrender.com/report?num=17</code> (troque o 17 pelo número desejado).
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
