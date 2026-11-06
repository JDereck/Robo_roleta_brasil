const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

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
contadorSequencialHtml: 0,
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

// =====================================================
// EXTRATOR DE HTML (GAME-STATISTICS E RECENT-RESULTS)
// =====================================================

function extrairNumerosDoHtml(htmlBruto) {
if (!htmlBruto || typeof htmlBruto !== "string") return { tipoDetectado: "desconhecido", itens: [] };

let tipoDetectado = "lista_html";
if (htmlBruto.includes('data-testid="game-statistics"')) {
tipoDetectado = "game-statistics";
} else if (htmlBruto.includes('data-testid="recent-results"')) {
tipoDetectado = "recent-results";
}

const regexBloco = /<div[^>]*data-testid="single-result"[^>]*>[\s\S]*?<\/div>/gi;
const blocos = htmlBruto.match(regexBloco) || [];
const itens = [];

for (const bloco of blocos) {
const matchBetCode = bloco.match(/data-bet-code="(\d+)"/i);
const matchSpan = bloco.match(/<span>\s*(\d{1,2})\s*<\/span>/i);

let numero = null;
if (matchSpan) {
numero = Number(matchSpan[1]);
} else if (matchBetCode) {
const betCode = Number(matchBetCode[1]);
numero = betCode === 2 ? 0 : betCode - 3;
}

if (Number.isInteger(numero) && numero >= 0 && numero <= 36) {
itens.push({
number: numero,
betCode: matchBetCode ? String(matchBetCode[1]) : null
});
}
}

return { tipoDetectado, itens };
}

function descobrirNovosPorAlinhamento(numerosRecentes, numerosHistorico) {
const minComparacao = Math.min(10, numerosHistorico.length);
if (minComparacao === 0) return numerosRecentes.slice();

for (let k = 0; k <= numerosRecentes.length - minComparacao; k++) {
const tamanhoJanela = numerosRecentes.length - k;
let igual = true;

for (let i = 0; i < tamanhoJanela; i++) {
if (numerosRecentes[k + i] !== numerosHistorico[i]) {
igual = false;
break;
}
}

if (igual) {
return numerosRecentes.slice(0, k);
}
}

return null;
}

function sincronizarMesaPorHtml(idMesa, htmlBruto) {
const mesa = estadoMesas[idMesa];
if (!mesa) throw new Error("Mesa não encontrada: " + idMesa);

const extraido = extrairNumerosDoHtml(htmlBruto);
const itens = extraido.itens;

if (!itens.length) {
throw new Error("Nenhum resultado single-result foi encontrado no HTML enviado.");
}

const agora = new Date().toISOString();

// CASO 1: CARGA INICIAL (OU ENVIO DO BLOCO DE 500 GIROS)
if (!mesa.carregado500 || itens.length >= 100 || extraido.tipoDetectado === "game-statistics") {
const totalBase = itens.slice(0, config.limiteHistorico);
mesa.historico = [];
mesa.contadorSequencialHtml = 0;

// Monta do mais antigo para o mais recente para numerar o ID sequencial corretamente
const doMaisAntigo = totalBase.slice().reverse();
for (const item of doMaisAntigo) {
mesa.contadorSequencialHtml += 1;
const gameIdGerado = idMesa + "_HTML_" + String(mesa.contadorSequencialHtml).padStart(6, "0");
mesa.historico.unshift({
tableId: idMesa,
gameId: gameIdGerado,
number: item.number,
rawResult: String(item.number) + (item.betCode ? " (betCode:" + item.betCode + ")" : ""),
timestamp: null,
coletadoEm: agora,
origem: "html_" + extraido.tipoDetectado
});
}

mesa.ultimoGameId = mesa.historico[0].gameId;
mesa.carregado500 = true;
mesa.tableIdUsado = "HTML_DOM";
mesa.statusConexao = "Conectada via HTML (" + mesa.historico.length + " giros na base)";
mesa.ultimaAtualizacao = agora;
mesa.coletor.ultimoErro = null;

return {
modo: "CARGA_COMPLETA",
tipoDetectado: extraido.tipoDetectado,
lidosNoHtml: itens.length,
novosAdicionados: mesa.historico.length,
totalArmazenado: mesa.historico.length,
ultimos5Giros: mesa.historico.slice(0, 5)
};
}

// CASO 2: ATUALIZAÇÃO AO VIVO (RECENT-RESULTS)
const numerosRecentes = itens.map(x => x.number);
const numerosHistorico = mesa.historico.map(x => x.number);

const novosMaisRecentePrimeiro = descobrirNovosPorAlinhamento(numerosRecentes, numerosHistorico);

if (novosMaisRecentePrimeiro === null) {
mesa.statusConexao = "Atenção - fila ao vivo sem sobreposição com o histórico atual";
throw new Error("Não foi possível alinhar a barra ao vivo com o histórico. Envie novamente o bloco de 500 giros para ressincronizar.");
}

const novosOrdemCronologica = novosMaisRecentePrimeiro.slice().reverse();
const girosInseridos = [];

for (const num of novosOrdemCronologica) {
mesa.contadorSequencialHtml += 1;
const gameIdGerado = idMesa + "_HTML_" + String(mesa.contadorSequencialHtml).padStart(6, "0");
const novoGiro = {
tableId: idMesa,
gameId: gameIdGerado,
number: num,
rawResult: String(num),
timestamp: agora,
coletadoEm: agora,
origem: "html_" + extraido.tipoDetectado
};
mesa.historico.unshift(novoGiro);
girosInseridos.push(novoGiro);
}

mesa.historico = mesa.historico.slice(0, config.limiteHistorico);

if (girosInseridos.length > 0) {
mesa.ultimoGameId = mesa.historico[0].gameId;
}

mesa.statusConexao = "Conectada via HTML (Ao Vivo)";
mesa.ultimaAtualizacao = agora;
mesa.coletor.ultimoErro = null;

return {
modo: "ATUALIZACAO_AO_VIVO",
tipoDetectado: extraido.tipoDetectado,
lidosNoHtml: itens.length,
novosAdicionados: girosInseridos.length,
girosNovosEmOrdem: girosInseridos,
totalArmazenado: mesa.historico.length,
ultimos5Giros: mesa.historico.slice(0, 5)
};
}

app.post("/api/html-ingest", (req, res) => {
try {
const idMesa = String(req.body.tableId || "237").trim();
const html = String(req.body.html || "");

const resultado = sincronizarMesaPorHtml(idMesa, html);
return res.json({ status: "success", idMesa, resultado });
} catch (err) {
return res.status(400).json({ status: "error", message: err.message });
}
});

// =====================================================
// ROTAS DE ESTADO E CONFIGURAÇÃO
// =====================================================

app.get("/health", (req, res) => {
res.json({ status: "online", servidor: "ROULETTE CONTROL", horario: new Date().toISOString() });
});

app.get("/api/state", (req, res) => {
res.json({
config,
statusSistema,
catalogo: CATALOGO_MESAS,
estadoMesas
});
});

app.get("/api/mesa/:id", (req, res) => {
const id = String(req.params.id);
const mesa = estadoMesas[id];
if (!mesa) return res.status(404).json({ status: "error", message: "Mesa não encontrada." });
res.json({ status: "success", cadastro: CATALOGO_MESAS[id], estado: mesa });
});

// =====================================================
// COLETOR API PRAGMATIC (PRESERVADO)
// =====================================================

function localizarArrayDeJogos(obj, profundidade = 0) {
if (!obj || profundidade > 4) return null;
if (Array.isArray(obj)) {
if (obj.length && obj.some(item => item && typeof item === "object")) return obj;
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
if (gameId === undefined || gameId === null || bruto === undefined || bruto === null) return null;

const texto = String(bruto).trim();
const correspondencia = texto.match(/(?:^|\D)(\d{1,2})(?:\D|$)/);
const numero = Number(correspondencia ? correspondencia[1] : texto);
if (!Number.isInteger(numero) || numero < 0 || numero > 36) return null;

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
params: { tableId: identificadorMesa, numberOfGames: quantidade, JSESSIONID: JSESSIONID },
timeout: 20000,
headers: { "Accept": "application/json", "Cookie": "JSESSIONID=" + JSESSIONID, "User-Agent": "Mozilla/5.0" }
});
return resposta.data;
}

async function consultarPragmatic(idMesa, quantidade) {
if (!JSESSIONID) throw new Error("JSESSIONID não configurado (usando modo HTML ou aguardando sessão).");
const cadastro = CATALOGO_MESAS[idMesa] || { id: idMesa, tableIdApi: idMesa };
const candidatos = [];
if (cadastro.tableIdApi) candidatos.push(cadastro.tableIdApi);
if (!candidatos.includes(idMesa)) candidatos.push(idMesa);

let ultimoErro = null;
for (const identificador of candidatos) {
try {
const dadosBrutos = await requisitarHistoricoPragmatic(identificador, quantidade);
const jogos = extrairJogos(dadosBrutos, idMesa);
if (jogos.length > 0) return { jogos, tableIdUsado: identificador };
ultimoErro = "Resposta sem jogos para tableId=" + identificador;
} catch (err) {
ultimoErro = err.message;
}
}
throw new Error(ultimoErro || "A resposta da Pragmatic não apresentou jogos reconhecidos.");
}

async function coletarMesa(id) {
if (!JSESSIONID) return;
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
mesa.historico = jogos.slice(0, config.limiteHistorico);
mesa.ultimoGameId = mesa.historico[0].gameId;
mesa.carregado500 = true;
mesa.statusConexao = "Conectada via API";
mesa.ultimaAtualizacao = new Date().toISOString();
return;
}

const indiceAnterior = jogos.findIndex(j => j.gameId === mesa.ultimoGameId);
if (indiceAnterior === -1) throw new Error("Último GameId não localizado.");

const novosJogos = jogos.slice(0, indiceAnterior).reverse();
for (const jogo of novosJogos) {
if (!mesa.historico.some(reg => reg.gameId === jogo.gameId)) {
mesa.historico.unshift(jogo);
}
}
mesa.historico = mesa.historico.slice(0, config.limiteHistorico);
if (novosJogos.length > 0) mesa.ultimoGameId = novosJogos[novosJogos.length - 1].gameId;
mesa.statusConexao = "Conectada via API";
mesa.ultimaAtualizacao = new Date().toISOString();
mesa.coletor.ultimoErro = null;
} catch (err) {
mesa.coletor.ultimoErro = err.message;
} finally {
mesa.coletor.emExecucao = false;
}
}

// =====================================================
// PÁGINA INICIAL COM TESTE DE HTML PARA TABLET
// =====================================================

app.get("/", (req, res) => {
const html = [
"<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>",
"<meta name='viewport' content='width=device-width, initial-scale=1'>",
"<title>ROULETTE CONTROL - Teste HTML</title></head>",
"<body style='background:#111;color:#eee;font-family:Arial;padding:18px;max-width:700px;margin:auto'>",
"<h2 style='color:#00ffcc;margin-bottom:5px'>ROULETTE CONTROL</h2>",
"<p style='color:#aaa;margin-top:0'>Etapa 1: Validação de Coleta (500 Giros + Ao Vivo)</p>",
"<div style='background:#1e1e1e;padding:15px;border-radius:8px;border:1px solid #333'>",
"<label><b>Mesa:</b></label><br>",
"<input id='tableId' value='237' style='width:100%;padding:8px;margin:6px 0 12px 0;background:#222;color:#fff;border:1px solid #555;border-radius:4px'>",
"<label><b>Cole aqui o HTML (game-statistics de 500 giros OU recent-results ao vivo):</b></label><br>",
"<textarea id='htmlBox' rows='6' style='width:100%;padding:8px;margin-top:6px;background:#222;color:#0f0;border:1px solid #555;border-radius:4px' placeholder='Cole a div aqui...'></textarea>",
"<button onclick='enviarHtml()' style='width:100%;padding:12px;margin-top:10px;background:#00ffcc;color:#000;font-weight:bold;border:none;border-radius:6px;font-size:16px'>PROCESSAR HTML</button>",
"<button onclick='limparCaixa()' style='width:100%;padding:8px;margin-top:8px;background:#333;color:#fff;border:none;border-radius:6px'>Limpar Caixa de Texto</button>",
"</div>",
"<pre id='saida' style='background:#000;color:#00ffcc;padding:12px;border-radius:8px;margin-top:15px;white-space:pre-wrap;word-break:break-word'>Aguardando envio...</pre>",
"<p><a style='color:#00ffcc' href='/api/mesa/237'>Ver JSON completo da Mesa 237 (/api/mesa/237)</a></p>",
"<script>",
"async function enviarHtml(){",
"const out=document.getElementById('saida');",
"out.textContent='Processando...';",
"try{",
"const r=await fetch('/api/html-ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tableId:document.getElementById('tableId').value,html:document.getElementById('htmlBox').value})});",
"const j=await r.json();",
"out.textContent=JSON.stringify(j,null,2);",
"}catch(e){out.textContent='Erro: '+e.message;}",
"}",
"function limparCaixa(){document.getElementById('htmlBox').value='';}",
"</script></body></html>"
].join("");
res.send(html);
});

app.listen(PORT, () => {
console.log("ROULETTE CONTROL rodando na porta " + PORT);
});
