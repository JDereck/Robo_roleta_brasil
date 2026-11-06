const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbyyWyc_z7InWOGkC4wIJ85fqPnlmsyuu9OeKHKFypcvgz_nw64I7JwcQqPrSwBA1eyh/exec";
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
radar: []
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

// =====================================================
// MOTOR ESTATÍSTICO E RADAR DE CONJUNTOS
// =====================================================

function calcularRadarMesa(idMesa) {
const mesa = estadoMesas[idMesa];
if (!mesa || !mesa.historico.length) return [];

const girosRecentes = mesa.historico.map(h => h.number);
const listaRadar = [];

for (let idx = 0; idx < 37; idx++) {
const idConj = "C" + (idx + 1);
const numerosConj = obterConjunto(idx, config.tamConjunto);
const strConjunto = numerosConj.join(", ");

let contSaidas = 0;
let jogadasJanela = 0;

for (let g = 0; g < girosRecentes.length; g++) {
if (numerosConj.includes(girosRecentes[g])) {
if (contSaidas === config.maxSaidas) break;
contSaidas++;
}
jogadasJanela++;
}

let statusAtual = "Normal";
if (jogadasJanela >= config.janelaAlvo && contSaidas <= config.maxSaidas) {
statusAtual = "🔥 GATILHO ATIVO";
} else if (jogadasJanela === (config.janelaAlvo - 1)) {
statusAtual = "⏳ FALTA 1 GIRO";
} else if (jogadasJanela === config.avisoAntecipado) {
statusAtual = "⚠️ PRÉ-ALERTA";
}

listaRadar.push({
id: idConj,
conjunto: strConjunto,
jogadasJanela: jogadasJanela,
saidasNaJanela: contSaidas,
status: statusAtual
});
}

// Ordena pelo maior atraso (jogadasJanela)
listaRadar.sort((a, b) => b.jogadasJanela - a.jogadasJanela);
mesa.radar = listaRadar;
return listaRadar;
}

// =====================================================
// WEBHOOK GOOGLE SHEETS
// =====================================================

async function sincronizarLoteComPlanilha(tableId, spins) {
if (!GAS_WEBHOOK_URL) return;
try {
await axios.post(GAS_WEBHOOK_URL, {
type: "SYNC_BATCH",
tableId: tableId,
alertar: false,
spins: spins
}, { timeout: 15000 });
} catch (err) {
console.error("Erro ao sincronizar lote com a planilha:", err.message);
}
}

async function enviarGiroParaPlanilha(tableId, spin) {
if (!GAS_WEBHOOK_URL) return;
try {
await axios.post(GAS_WEBHOOK_URL, {
type: "NEW_SPIN",
tableId: tableId,
spin: spin
}, { timeout: 10000 });
} catch (err) {
console.error("Erro ao enviar giro para a planilha:", err.message);
}
}

// =====================================================
// EXTRATOR DE HTML
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
itens.push({ number: numero, betCode: matchBetCode ? String(matchBetCode[1]) : null });
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
if (numerosRecentes[k + i] !== numerosHistorico[i]) { igual = false; break; }
}
if (igual) return numerosRecentes.slice(0, k);
}
return null;
}

function sincronizarMesaPorHtml(idMesa, htmlBruto) {
const mesa = estadoMesas[idMesa];
if (!mesa) throw new Error("Mesa não encontrada: " + idMesa);

const extraido = extrairNumerosDoHtml(htmlBruto);
const itens = extraido.itens;
if (!itens.length) throw new Error("Nenhum resultado encontrado no HTML enviado.");

const agora = new Date().toISOString();

if (!mesa.carregado500 || itens.length >= 100 || extraido.tipoDetectado === "game-statistics") {
const totalBase = itens.slice(0, config.limiteHistorico);
mesa.historico = [];
mesa.contadorSequencialHtml = 0;

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
mesa.statusConexao = "Conectada (" + mesa.historico.length + " giros)";
mesa.ultimaAtualizacao = agora;

sincronizarLoteComPlanilha(idMesa, mesa.historico);
calcularRadarMesa(idMesa);

return { modo: "CARGA_COMPLETA", totalArmazenado: mesa.historico.length };
}

const numerosRecentes = itens.map(x => x.number);
const numerosHistorico = mesa.historico.map(x => x.number);
const novosMaisRecentePrimeiro = descobrirNovosPorAlinhamento(numerosRecentes, numerosHistorico);

if (novosMaisRecentePrimeiro === null) {
throw new Error("Não foi possível alinhar. Envie o bloco de 500 giros novamente.");
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
enviarGiroParaPlanilha(idMesa, novoGiro);
}

mesa.historico = mesa.historico.slice(0, config.limiteHistorico);
if (girosInseridos.length > 0) mesa.ultimoGameId = mesa.historico[0].gameId;
mesa.statusConexao = "Conectada (Ao Vivo)";
mesa.ultimaAtualizacao = agora;

calcularRadarMesa(idMesa);

return { modo: "ATUALIZACAO_AO_VIVO", novosAdicionados: girosInseridos.length, totalArmazenado: mesa.historico.length };
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

app.get("/api/radar/:id", (req, res) => {
const id = String(req.params.id);
const mesa = estadoMesas[id];
if (!mesa) return res.status(404).json({ status: "error", message: "Mesa não encontrada." });
const radar = calcularRadarMesa(id);
res.json({ status: "success", tableId: id, totalGiros: mesa.historico.length, radar });
});

app.get("/health", (req, res) => {
res.json({ status: "online", horario: new Date().toISOString() });
});

app.get("/api/state", (req, res) => {
res.json({ config, estadoMesas });
});

// =====================================================
// PAINEL WEB ADMINISTRATIVO PARA O TABLET
// =====================================================

app.get("/", (req, res) => {
const html = [
"<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>",
"<meta name='viewport' content='width=device-width, initial-scale=1'>",
"<title>ROULETTE CONTROL - Painel</title>",
"<style>",
"body{background:#111;color:#eee;font-family:Arial;padding:15px;max-width:800px;margin:auto}",
"h2{color:#00ffcc;margin-bottom:5px}",
".card{background:#1e1e1e;padding:12px;border-radius:8px;border:1px solid #333;margin-bottom:15px}",
"textarea{width:100%;padding:8px;background:#222;color:#0f0;border:1px solid #555;border-radius:4px}",
"button{width:100%;padding:12px;background:#00ffcc;color:#000;font-weight:bold;border:none;border-radius:6px;font-size:16px;cursor:pointer;margin-top:8px}",
"table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}",
"th,td{border:1px solid #444;padding:8px;text-align:center}",
"th{background:#222;color:#00ffcc}",
"</style></head>",
"body>",
"<h2>ROULETTE CONTROL</h2>",
"<p style='color:#aaa'>Painel Administrativo & Radar de Conjuntos (Mesa 237)</p>",
"<div class='card'>",
"<b>Alimentar Dados (HTML):</b><br>",
"<textarea id='htmlBox' rows='4' placeholder='Cole o HTML aqui...'></textarea>",
"<button onclick='enviarHtml()'>PROCESSAR E SALVAR</button>",
"</div>",
"<div class='card'>",
"<h3 style='margin-top:0;color:#00ffcc'>📡 Radar dos 37 Conjuntos</h3>",
"<button onclick='carregarRadar()' style='background:#333;color:#fff;padding:8px'>Atualizar Radar</button>",
"<div style='overflow-x:auto'>",
"<table><thead><tr><th>ID</th><th>Conjunto (6 Vizinhos)</th><th>Jogadas</th><th>Saídas</th><th>Status</th></tr></thead>",
"<tbody id='radarBody'><tr><td colspan='5'>Carregando radar...</td></tr></tbody>",
"</table></div></div>",
"<script>",
"async function enviarHtml(){",
"try{",
"let r=await fetch('/api/html-ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tableId:'237',html:document.getElementById('htmlBox').value})});",
"let j=await r.json();",
"alert('Sucesso: ' + JSON.stringify(j.resultado));",
"carregarRadar();",
"}catch(e){alert('Erro: '+e.message);}",
"}",
"async function carregarRadar(){",
"try{",
"let r=await fetch('/api/radar/237');",
"let j=await r.json();",
"let tbody=document.getElementById('radarBody');",
"tbody.innerHTML='';",
"j.radar.forEach(c=>{",
"let tr=document.createElement('tr');",
"tr.innerHTML=`<td><b>${c.id}</b></td><td>${c.conjunto}</td><td>${c.jogadasJanela}</td><td>${c.saidasNaJanela}</td><td>${c.status}</td>`;",
"tbody.appendChild(tr);",
"});",
"}catch(e){console.error(e);}",
"}",
"carregarRadar();",
"setInterval(carregarRadar, 10000);",
"</script></body></html>"
].join("");
res.send(html);
});

app.listen(PORT, () => {
console.log("ROULETTE CONTROL rodando na porta " + PORT);
});
