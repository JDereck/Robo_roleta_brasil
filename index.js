const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// URL do seu Google Apps Script já conectada diretamente
let GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbzsD45UPV6mQAKLCzVnLCtdAGoG7AVzqwVLjB9y188fzBZc2PXqLz1I6Tbgyoopghb0/exec";

// Configurações da API da Roleta em Nuvem
let JSESSIONID = process.env.JSESSIONID || "";
let TABLE_ID = process.env.TABLE_ID || "237"; // 237 = Roleta Pragmatic padrão
let CUSTOM_API_URL = process.env.CUSTOM_API_URL || ""; // Caso use API pública externa
let ultimoGameId = null;
let statusColetor = "Aguardando configuração de sessão ou API";

// =========================================================================
// 1. MOTOR DE CAPTURA AUTOMÁTICA EM NUVEM (RODA A CADA 5 SEGUNDOS)
// =========================================================================
setInterval(async () => {
  try {
    let urlBusca = "";
    if (CUSTOM_API_URL) {
      urlBusca = CUSTOM_API_URL;
    } else if (JSESSIONID) {
      urlBusca = `https://games.pragmaticplaylive.net/api/ui/statisticHistory?tableId=${TABLE_ID}&numberOfGames=10&JSESSIONID=${encodeURIComponent(JSESSIONID)}`;
    } else {
      return; // Aguarda configurar sessão ou API
    }

    const res = await axios.get(urlBusca, { timeout: 6000 });
    const data = res.data;

    // Extrai o último giro (compatível com formato Pragmatic Play e JSON padrão)
    const listaHistorico = data.history || data.results || data.data || [];
    if (! Array.isArray(listaHistorico) || listaHistorico.length === 0) {
      statusColetor = "⚠️ Sessão expirada ou lista vazia (Atualize o JSESSIONID)";
      return;
    }

    const ultimoGiro = listaHistorico[0];
    const gameId = String(ultimoGiro.gameId || ultimoGiro.id || ultimoGiro.time || "");
    const rawResult = String(ultimoGiro.gameResult || ultimoGiro.result || ultimoGiro.number || "");
    const matchNum = rawResult.match(/\b([0-9]|[12][0-9]|3[0-6])\b/);

    if (matchNum && gameId && gameId !== ultimoGameId) {
      ultimoGameId = gameId;
      const numero = parseInt(matchNum[1], 10);
      statusColetor = `✅ Ativo! Último nº capturado: ${numero} (ID: ${gameId})`;

      await enviarParaPlanilha(numero, gameId);
    }
  } catch (err) {
    statusColetor = `❌ Erro na leitura da API (${err.response ? err.response.status : err.message})`;
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

// =========================================================================
// 2. PAINEL WEB NO PRÓPRIO RENDER PARA ATUALIZAR SESSÃO OU TESTAR GIROS
// =========================================================================
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Controle Nuvem - Roleta</title>
      </head>
      <body style="background:#111; color:#fff; font-family:Arial; padding:20px; max-width:500px; margin:auto;">
        <h2 style="color:#00ffcc;">🚀 Robô Roleta em Nuvem</h2>
        <p><b>Status da Captura:</b> <span style="color:#ffcc00;">${statusColetor}</span></p>
        <hr style="border-color:#333;">
        <form action="/config" method="POST">
          <label><b>JSESSIONID (Pragmatic Play):</b></label><br>
          <input type="text" name="jsessionid" value="${JSESSIONID}" style="width:100%; padding:8px; margin:6px 0;"><br>
          <label><b>Table ID (Ex: 237):</b></label><br>
          <input type="text" name="tableId" value="${TABLE_ID}" style="width:100%; padding:8px; margin:6px 0;"><br>
          <label><b>Ou URL de API Externa (Opcional):</b></label><br>
          <input type="text" name="customApi" value="${CUSTOM_API_URL}" style="width:100%; padding:8px; margin:6px 0;"><br>
          <button type="submit" style="width:100%; padding:10px; background:#00aa00; color:#fff; border:none; font-weight:bold; border-radius:6px; margin-top:8px;">
            💾 Salvar e Iniciar Captura em Nuvem
          </button>
        </form>
        <hr style="border-color:#333; margin-top:20px;">
        <h4>🎯 Simular Giro Manual p/ Testar Planilha e Telegram:</h4>
        <form action="/report" method="GET" style="display:flex; gap:8px;">
          <input type="number" name="num" min="0" max="36" placeholder="Nº (0 a 36)" required style="flex:1; padding:8px;">
          <button type="submit" style="padding:8px 16px; background:#0066cc; color:#fff; border:none; border-radius:6px; font-weight:bold;">Enviar Nº</button>
        </form>
      </body>
    </html>
  `);
});

app.post('/config', (req, res) => {
  if (req.body.jsessionid !== undefined) JSESSIONID = req.body.jsessionid.trim();
  if (req.body.tableId !== undefined) TABLE_ID = req.body.tableId.trim();
  if (req.body.customApi !== undefined) CUSTOM_API_URL = req.body.customApi.trim();
  statusColetor = "🔄 Configuração atualizada! Buscando giros...";
  res.redirect('/');
});

// Mantém a rota /report funcionando para testes e integrações
app.get('/report', async (req, res) => {
  const num = req.query.num;
  if (num === undefined) return res.status(400).send('Falta ?num=');
  await enviarParaPlanilha(num, "manual_" + Date.now());
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
