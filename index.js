const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors()); // Libera o CORS para o tablet enviar os dados direto do jogo

const PORT = process.env.PORT || 3000;
const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || '';

// Endpoint para o script do tablet injetar o número capturado na tela
app.post('/report-spin', async (req, res) => {
  const { spin } = req.body;
  if (!spin || spin.number === undefined) {
    return res.status(400).json({ error: 'Dados inválidos' });
  }

  console.log(`🎯 [CAPTURADO NO TABLET] Número: ${spin.number} | ID: ${spin.gameId}`);

  if (GAS_WEBHOOK_URL) {
    try {
      await axios.post(GAS_WEBHOOK_URL, { type: 'NEW_SPIN', spin }, { timeout: 8000 });
      console.log(`✅ [ENVIADO PARA PLANILHA] Número ${spin.number} gravado com sucesso!`);
    } catch (err) {
      console.error(`[ERRO REPASSE PLANILHA]`, err.message);
    }
  }

  res.json({ success: true, received: spin });
});

app.get('/', (req, res) => {
  res.json({ service: 'Monitor Roleta Bridge', status: 'online' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor Bridge rodando na porta ${PORT}`);
});
