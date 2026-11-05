
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// CREDENCIAIS: configurar somente nas variáveis de ambiente do Render
const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || "";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

// SESSÃO COMPARTILHADA DA PRAGMATIC
const JSESSIONID = process.env.JSESSIONID || "";

// CILINDRO OFICIAL DA ROLETA EUROPEIA
const CILINDRO = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

// CATÁLOGO DE MESAS
const CATALOGO_MESAS = {
  "237": { id: "237", nome: "Roleta Brasileira", ativa: true },
  "204": { id: "204", nome: "Mega Roulette", ativa: true },
  "225": { id: "225", nome: "Auto-Roulette 1", ativa: true },
  "203": { id: "203", nome: "Speed Roulette 1", ativa: true },
  "206": { id: "206", nome: "Roulette Macao", ativa: true },
  "227": { id: "227", nome: "Roulette Azure", ativa: false },
  "230": { id: "230", nome: "Roulette Ruby", ativa: false },
  "201": { id: "201", nome: "Roulette 1 (Green)", ativa: false }
};

// CONFIGURAÇÕES GERAIS
const config = {
  statusRobo: "ATIVO",
  jsessionid: JSESSIONID,
  janelaAlvo: 100,
  avisoAntecipado: 98,
  maxSaidas: 10,
  tamConjunto: 6,
  maxEntradas: 3,
  bloquearSimultaneos: false,
  limiteHistorico: 500,
  intervaloColeta: 5000
};

// ESTADOS INDEPENDENTES DAS MESAS
const estadoMesas = {};

function inicializarMesa(id) {
  const cadastro = CATALOGO_MESAS[id];
  if (!cadastro) return null;

  if (!estadoMesas[id]) {
    estadoMesas[id] = {
      id: cadastro.id,
      nome: cadastro.nome,
      historico: [],
      ultimoGameId: null,
      carregado500: false,
      statusConexao: "Aguardando primeira consulta",
      ultimaAtualizacao: null,
      sinais: {},
      radar: [],
      placarDia: {
        g1: 0,
        g2: 0,
        g3: 0,
        reds: 0,
        msgIdRelatorio: null
      },
      coletor: {
        emExecucao: false,
        ultimaTentativa: null,
        ultimoErro: null
      }
    };
  }

  return estadoMesas[id];
}

// INICIALIZA TODAS AS MESAS CADASTRADAS
Object.keys(CATALOGO_MESAS).forEach(inicializarMesa);

// FUNÇÃO PARA MONTAR CONJUNTOS DE VIZINHOS
function obterConjunto(indiceInicial, tamanho = config.tamConjunto) {
  const resultado = [];

  for (let i = 0; i < tamanho; i++) {
    resultado.push(CILINDRO[(indiceInicial + i) % CILINDRO.length]);
  }

  return resultado;
}

// ESTADO GERAL DO COLETOR
const statusSistema = {
  iniciado: new Date().toISOString(),
  coletorAtivo: false,
  ultimaExecucao: null,
  ultimoErro: null
};

// ROTA DE SAÚDE DO SERVIDOR
app.get("/health", (req, res) => {
  res.json({
    status: "online",
    servidor: "Monitor Roleta Europeia",
    horario: new Date().toISOString()
  });
});

// ROTA PARA CONSULTAR O ESTADO DO SISTEMA
app.get("/api/state", (req, res) => {
  res.json({
    config: {
      statusRobo: config.statusRobo,
      janelaAlvo: config.janelaAlvo,
      avisoAntecipado: config.avisoAntecipado,
      maxSaidas: config.maxSaidas,
      tamConjunto: config.tamConjunto,
      maxEntradas: config.maxEntradas,
      bloquearSimultaneos: config.bloquearSimultaneos,
      limiteHistorico: config.limiteHistorico
    },
    statusSistema,
    catalogo: CATALOGO_MESAS,
    estadoMesas
  });
});

// ROTA INICIAL
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Monitor Roleta Europeia</title>
    </head>
    <body style="background:#111;color:#eee;font-family:Arial;padding:25px">
      <h2 style="color:#00ffcc">Monitor Roleta Europeia</h2>
      <p>Servidor iniciado corretamente.</p>
      <p>Mesas cadastradas: ${Object.keys(CATALOGO_MESAS).length}</p>
      <p><a style="color:#00ffcc" href="/api/state">Consultar estado do sistema</a></p>
      <p><a style="color:#00ffcc" href="/health">Verificar servidor</a></p>
    </body>
    </html>
  `);
});

// INICIALIZAÇÃO
app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
  console.log("Mesas cadastradas: " + Object.keys(CATALOGO_MESAS).length);
  console.log("Sessão Pragmatic: " + (JSESSIONID ? "CONFIGURADA" : "AGUARDANDO CONFIGURAÇÃO"));
  console.log("Webhook Google Sheets: " + (GAS_WEBHOOK_URL ? "CONFIGURADO" : "AGUARDANDO CONFIGURAÇÃO"));
  console.log("Telegram: " + (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID ? "CONFIGURADO" : "AGUARDANDO CONFIGURAÇÃO"));
});
