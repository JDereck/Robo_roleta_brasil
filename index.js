const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || '';

// Rota GET acionada pelos botões do tablet
app.get('/report', async (req, res) => {
  const num = req.query.num;
  if (num === undefined) {
    return res.status(400).json({ error: 'Falta o parâmetro ?num=' });
  }

  const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
  
  // Estrutura exata que o Google Apps Script espera receber
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

  res.json({ success: true, number: num });
});

app.get('/', (req, res) => {
  res.json({ service: 'Monitor Roleta Bridge', status: 'online' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
