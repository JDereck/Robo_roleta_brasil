const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || '';

// Rota GET acionada pelo painel flutuante via imagem invisível
app.get('/report', async (req, res) => {
  const num = req.query.num;
  if (num === undefined) {
    return res.status(400).json({ error: 'Falta o parâmetro ?num=' });
  }

  processarEEnviar(num, res);
});

// Rota POST de segurança caso queira usar fetch no futuro
app.post('/report', async (req, res) => {
  const num = req.body.num;
  if (num === undefined) {
    return res.status(400).json({ error: 'Falta o parâmetro num' });
  }

  processarEEnviar(num, res);
});

async function processarEEnviar(num, res) {
  const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
  
  const payloadToGAS = {
    type: 'NEW_SPIN',
    spin: {
      gameId: "tablet_" + Date.now(),
      number: parseInt(num, 10),
      rawResult: String(num),
      timestamp: timestamp
    }
  };

  console.log(`🎯 [TABLET] Número recebido: ${num}. Repassando para o Google Sheets...`);

  if (GAS_WEBHOOK_URL) {
    try {
      const response = await axios.post(GAS_WEBHOOK_URL, payloadToGAS, { timeout: 10000 });
      console.log(`✅ [SUCESSO] Resposta do Apps Script:`, response.data);
    } catch (err) {
      console.error(`❌ [ERRO AO REPASSAR PARA O GAS]:`, err.message);
    }
  } else {
    console.warn(`⚠️ [AVISO] GAS_WEBHOOK_URL não configurada no Render!`);
  }

  // Retorna um pixel transparente de 1x1 em formato GIF para o painel via imagem invisível
  const transparentGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': transparentGif.length
  });
  res.end(transparentGif);
}

app.get('/', (req, res) => {
  res.json({ service: 'Monitor Roleta Bridge', status: 'online' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
