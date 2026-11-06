const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || "";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const JSESSIONID = process.env.JSESSIONID || "";

const CILINDRO = [
0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const CATALOGO_MESAS = {
"237": { id: "237", tableIdApi: "rwbrzportrwa16rg", nome: "Roleta Brasileira", ativa: true },
"204": { id: "204", tableIdApi: "204", nome: "Mega Roulette", ativa: false },
"225": { id: "225", tableIdApi: "225", nome: "Auto-Roulette 1", ativa: false },
"203": { id: "203", tableIdApi: "203", nome: "Speed Roulette 1", ativa: false },
"206": { id: "206", tableIdApi: "206", nome: "Roulette Macao", ativa: false },
"227": { id: "227", tableIdApi: "227", nome: "Roulette Azure", ativa: false },
"230": { id: "230", tableIdApi: "230", nome: "Roulette Ruby", ativa: false },
"201": { id: "201", tableIdApi: "201", nome: "Roulette 1 (Green)", ativa: false }
};

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

const estadoMesas = {};

function inicializarMesa(id) {
const cadastro = CATALOGO_MESAS[id];
if (!cadastro) return null;

if (!estadoMesas[id]) {
estadoMesas[id] = {
id: cadastro.id,
tableIdUsado: null,
nome: cadastro.nome,
historico: [],
ultimoGameId: null,
carregado500: false,
statusConexao: "Aguardando primeira consulta",
ultimaAtualizacao: null,
sinais: {},
radar: [],
placarDia: { g1: 0, g2: 0, g3: 0, reds: 0, msgIdRelatorio: null },
coletor: { emExecucao: false, ultimaTentativa: null, ultimoErro: null }
};
}
return estadoMesas[id];
}

Object.keys(CATALOGO_MESAS).forEach(inicializarMesa);

function obterConjunto(indiceInicial, tamanho = config.tamConjunto) {
const resultado = [];
for (let i = 0; i < tamanho; i++) {
resultado.push(CILINDRO[(indiceInicial + i) % CILINDRO.length]);
}
return resultado;
}

const statusSistema = {
iniciado: new Date().toISOString(),
coletorAtivo: false,
ultimaExecucao: null,
ultimoErro: null
};

app.get("/health", (req, res) => {
res.json({
status: "online",
servidor: "ROULETTE CONTROL",
horario: new Date().toISOString()
});
});

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

app.post("/api/config", (req, res) => {
try {
const b = req.body || {};

if (b.statusRobo !== undefined) {
if (!["ATIVO", "PAUSADO"].includes(b.statusRobo)) {
return res.status(400).json({ status: "error", message: "Status do robô inválido." });
}
config.statusRobo = b.statusRobo;
}

const limites = {
janelaAlvo: [10, 500],
avisoAntecipado: [1, 499],
maxSaidas: [1, 36],
maxEntradas: [1, 10],
limiteHistorico: [50, 500],
intervaloColeta: [5000, 60000]
};

for (const [campo, intervalo] of Object.entries(limites)) {
if (b[campo] !== undefined) {
const valor = Number(b[campo]);
if (!Number.isInteger(valor) || valor < intervalo[0] || valor > intervalo[1]) {
return res.status(400).json({ status: "error", message: "Valor inválido para " + campo });
}
config[campo] = valor;
}
}

if (config.avisoAntecipado >= config.janelaAlvo) {
return res.status(400).json({
status: "error",
message: "O pré-alerta precisa ser menor que a janela alvo."
});
}

if (b.bloquearSimultaneos !== undefined) {
config.bloquearSimultaneos = b.bloquearSimultaneos === true || b.bloquearSimultaneos === "SIM";
}

if (b.mesas !== undefined) {
const mesasMarcadas = Array.isArray(b.mesas) ? b.mesas.map(String) : [String(b.mesas)];
Object.keys(CATALOGO_MESAS).forEach(id => {
CATALOGO_MESAS[id].ativa = mesasMarcadas.includes(id);
});
}

if (b.novaMesaId !== undefined || b.novaMesaNome !== undefined) {
const novoId = String(b.novaMesaId || "").trim();
const novoNome = String(b.novaMesaNome || "").trim();

if (!/^[a-zA-Z0-9_-]{1,25}$/.test(novoId) || !novoNome || novoNome.length > 60) {
return res.status(400).json({
status: "error",
message: "Informe um ID válido e um nome de até 60 caracteres."
});
}

if (CATALOGO_MESAS[novoId]) {
return res.status(409).json({ status: "error", message: "Esta mesa já está cadastrada." });
}

CATALOGO_MESAS[novoId] = { id: novoId, tableIdApi: novoId, nome: novoNome, ativa: true };
inicializarMesa(novoId);
}

return res.json({
status: "success",
message: "Configurações atualizadas.",
config,
catalogo: CATALOGO_MESAS
});
} catch (err) {
return res.status(500).json({ status: "error", message: err.message });
}
});

app.get("/api/mesa/:id", (req, res) => {
const id = String(req.params.id);
const mesa = estadoMesas[id];
if (!mesa) {
return res.status(404).json({ status: "error", message: "Mesa não encontrada." });
}
res.json({ status: "success", cadastro: CATALOGO_MESAS[id], estado: mesa });
});

function localizarArrayDeJogos(obj, profundidade = 0) {
if (!obj || profundidade > 4) return null;

if (Array.isArray(obj)) {
if (obj.length && obj.some(item => item && typeof item === "object")) {
return obj;
}
return null;
}

if (typeof obj === "object") {
const chaves = ["history", "results", "data", "games", "statistics"];
for (const chave of chaves) {
if (obj[chave] !== undefined) {
const encontrado = localizarArrayDeJogos(obj[chave], profundidade + 1);
if (encontrado) return encontrado;
}
}
for (const valor of Object.values(obj)) {
if (valor && typeof valor === "object") {
const encontrado = localizarArrayDeJogos(valor, profundidade + 1);
if (encontrado) return encontrado;
}
}
}
return null;
}

function normalizarJogo(item, tableIdRef) {
if (!item || typeof item !== "object") return null;

const gameId = item.gameId ?? item.game_id ?? item.gameID ?? item.id ?? item.roundId;
const bruto = item.gameResult ?? item.rawResult ?? item.raw_result ?? item.result ?? item.number ?? item.winningNumber ?? item.rouletteNumber;

if (gameId === undefined || gameId === null || bruto === undefined || bruto === null) {
return null;
}

const texto = String(bruto).trim();
const correspondencia = texto.match(/(?:^|\D)(\d{1,2})(?:\D|$)/);
const numero = Number(correspondencia ? correspondencia[1] : texto);

if (!Number.isInteger(numero) || numero < 0 || numero > 36) {
return null;
}

return {
tableId: String(tableIdRef || ""),
gameId: String(gameId).trim(),
number: numero,
rawResult: texto,
timestamp: item.timestamp ?? item.date ?? item.createdAt ?? item.time ?? null,
coletadoEm: new Date().toISOString(),
origem: "pragmatic_statisticHistory"
};
}

function extrairJogos(resposta, tableIdRef) {
const lista = localizarArrayDeJogos(resposta);
if (!lista) return [];
return lista.map(item => normalizarJogo(item, tableIdRef)).filter(Boolean);
}

async function requisitarHistoricoPragmatic(identificadorMesa, quantidade) {
const url = "https://games.pragmaticplaylive.net/api/ui/statisticHistory";
const resposta = await axios.get(url, {
params: {
tableId: identificadorMesa,
numberOfGames: quantidade,
JSESSIONID: JSESSIONID
},
timeout: 20000,
headers: {
"Accept": "application/json",
"Cookie": "JSESSIONID=" + JSESSIONID,
"User-Agent": "Mozilla/5.0"
}
});
return resposta.data;
}

async function consultarPragmatic(idMesa, quantidade) {
if (!JSESSIONID) {
throw new Error("JSESSIONID não configurado nas variáveis de ambiente do Render.");
}

const cadastro = CATALOGO_MESAS[idMesa] || { id: idMesa, tableIdApi: idMesa };
const candidatos = [];
if (cadastro.tableIdApi) candidatos.push(cadastro.tableIdApi);
if (!candidatos.includes(idMesa)) candidatos.push(idMesa);

let ultimoErro = null;

for (const identificador of candidatos) {
try {
const dadosBrutos = await requisitarHistoricoPragmatic(identificador, quantidade);
const jogos = extrairJogos(dadosBrutos, idMesa);
if (jogos.length > 0) {
return { jogos, tableIdUsado: identificador };
}
ultimoErro = "Resposta sem jogos para tableId=" + identificador;
} catch (err) {
ultimoErro = err.message;
}
}

throw new Error(ultimoErro || "A resposta da Pragmatic não apresentou jogos reconhecidos.");
}

async function coletarMesa(id) {
const mesa = estadoMesas[id];
if (!mesa || !CATALOGO_MESAS[id] || !CATALOGO_MESAS[id].ativa) return;
if (mesa.coletor.emExecucao) return;

mesa.coletor.emExecucao = true;
mesa.coletor.ultimaTentativa = new Date().toISOString();

try {
const resultado = await consultarPragmatic(id, 500);
const jogos = resultado.jogos;
mesa.tableIdUsado = resultado.tableIdUsado;

if (!mesa.carregado500) {
const vistos = new Set();
const unicos = [];
for (const j of jogos) {
if (!vistos.has(j.gameId)) {
vistos.add(j.gameId);
unicos.push(j);
}
}

mesa.historico = unicos.slice(0, config.limiteHistorico);
mesa.ultimoGameId = mesa.historico.length > 0 ? mesa.historico[0].gameId : null;
mesa.carregado500 = true;
mesa.statusConexao = "Conectada - histórico inicial carregado (" + mesa.historico.length + " giros)";
mesa.ultimaAtualizacao = new Date().toISOString();
mesa.coletor.ultimoErro = null;

console.log("Mesa " + id + " (" + mesa.tableIdUsado + "): carga inicial com " + mesa.historico.length + " giros.");
return;
}

const indiceAnterior = jogos.findIndex(jogo => jogo.gameId === mesa.ultimoGameId);

if (indiceAnterior === -1) {
mesa.statusConexao = "Atenção - último GameId não localizado na janela";
throw new Error("Último GameId (" + mesa.ultimoGameId + ") não encontrado. Histórico preservado.");
}

const novosJogos = jogos.slice(0, indiceAnterior).reverse();

for (const jogo of novosJogos) {
if (!mesa.historico.some(reg => reg.gameId === jogo.gameId)) {
mesa.historico.unshift(jogo);
}
}

mesa.historico = mesa.historico.slice(0, config.limiteHistorico);

if (novosJogos.length > 0) {
mesa.ultimoGameId = novosJogos[novosJogos.length - 1].gameId;
console.log("Mesa " + id + ": " + novosJogos.length + " novo(s) giro(s). Último nº: " + novosJogos[novosJogos.length - 1].number);
}

mesa.statusConexao = "Conectada";
mesa.ultimaAtualizacao = new Date().toISOString();
mesa.coletor.ultimoErro = null;
} catch (err) {
mesa.coletor.ultimoErro = err.message;
if (!mesa.statusConexao.startsWith("Atenção")) {
mesa.statusConexao = "Erro na consulta";
}
console.error("Erro na mesa " + id + ":", err.message);
} finally {
mesa.coletor.emExecucao = false;
}
}

app.get("/api/teste-coleta/:id", async (req, res) => {
const id = String(req.params.id || "237");
await coletarMesa(id);
const mesa = estadoMesas[id];
if (!mesa) {
return res.status(404).json({ status: "error", message: "Mesa não cadastrada." });
}
res.json({
status: mesa.coletor.ultimoErro ? "error" : "success",
idMesa: mesa.id,
tableIdUsado: mesa.tableIdUsado,
statusConexao: mesa.statusConexao,
ultimoErro: mesa.coletor.ultimoErro,
totalGirosArmazenados: mesa.historico.length,
ultimoGiro: mesa.historico[0] || null,
amostra5Giros: mesa.historico.slice(0, 5)
});
});

let temporizadorColeta = null;
let cicloColetaEmExecucao = false;

async function executarCicloColeta() {
if (cicloColetaEmExecucao) return;

cicloColetaEmExecucao = true;
statusSistema.coletorAtivo = true;
statusSistema.ultimaExecucao = new Date().toISOString();

try {
const mesasAtivas = Object.keys(CATALOGO_MESAS).filter(id => CATALOGO_MESAS[id].ativa);
await Promise.allSettled(mesasAtivas.map(id => coletarMesa(id)));
} catch (err) {
statusSistema.ultimoErro = err.message;
console.error("Erro no ciclo de coleta:", err.message);
} finally {
cicloColetaEmExecucao = false;
statusSistema.coletorAtivo = false;
agendarProximaColeta();
}
}

function agendarProximaColeta() {
if (temporizadorColeta) clearTimeout(temporizadorColeta);
const intervalo = Math.max(5000, config.intervaloColeta);
temporizadorColeta = setTimeout(executarCicloColeta, intervalo);
}

function iniciarColetor() {
console.log("Iniciando coletor Pragmatic...");
executarCicloColeta();
}

app.get("/", (req, res) => {
const html = [
"<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>",
"<meta name='viewport' content='width=device-width, initial-scale=1'>",
"<title>ROULETTE CONTROL</title></head>",
"<body style='background:#111;color:#eee;font-family:Arial;padding:25px'>",
"<h2 style='color:#00ffcc'>ROULETTE CONTROL</h2>",
"<p>Servidor online e monitorando.</p>",
"<p><a style='color:#00ffcc' href='/api/teste-coleta/237'>Testar coleta da Roleta Brasileira (237)</a></p>",
"<p><a style='color:#00ffcc' href='/api/state'>Consultar estado completo (/api/state)</a></p>",
"<p><a style='color:#00ffcc' href='/health'>Verificar saúde (/health)</a></p>",
"</body></html>"
].join("");
res.send(html);
});

app.listen(PORT, () => {
console.log("Servidor rodando na porta " + PORT);
console.log("Sessão Pragmatic: " + (JSESSIONID ? "CONFIGURADA" : "AGUARDANDO CONFIGURAÇÃO"));
iniciarColetor();
});
