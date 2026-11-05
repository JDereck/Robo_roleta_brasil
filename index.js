const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || '';

// Rota GET acionada pelo painel do tablet
app.get('/report', async (req, res) => {
  const num = req.query.num;
  if (num === undefined) return res.status(400).json({ error: 'Falta o número ?num=' });

  const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
  const spin = {
    gameId: "tablet_" + Date.now(),
    number: parseInt(num, 10),
    rawResult: String(num),
    timestamp: timestamp
  };

  console.log(`🎯 [TABLET RECEBEU] Número: ${num}`);

  if (GAS_WEBHOOK_URL) {
    try {
      // 1. Envia para a planilha e pede para o Apps Script disparar o Telegram
      const response = await axios.post(GAS_WEBHOOK_URL, { 
        type: 'NEW_SPIN', 
        spin 
      }, { timeout: 10000 });
      
      console.log(`✅ [PLANILHA E TELEGRAM ATUALIZADOS] Resposta do GAS:`, response.data);
    } catch (err) {
      console.error(`❌ [ERRO AO REPASSAR]:`, err.message);
    }
  } else {
    console.warn(`⚠️ [AVISO] GAS_WEBHOOK_URL não está configurada no Render!`);
  }

  res.json({ success: true, spin });
});

app.get('/', (req, res) => {
  res.json({ service: 'Monitor Roleta Bridge', status: 'online' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
