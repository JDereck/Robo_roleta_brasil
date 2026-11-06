const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || "";
const JSESSIONID = process.env.JSESSIONID || "";

const CILINDRO = [
0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const CATALOGO_MESAS = {
"237": { id: "237", blitzUrl: "https://blitz4.casino/api/games/brazilian-roulette-237-237", nome: "🇧🇷 Brasil", ativa: true },
"204": { id: "204", blitzUrl: null, nome: "⚡ Mega", ativa: true },
"225": { id: "225", blitzUrl: null, nome: "🏎️ Auto", ativa: true }
};

const config = {
statusRobo: "ATIVO",
janelaAlvo: 100,
avisoAntecipado: 95,
maxSaidas: 10,
tamConjunto: 6,
maxEntradas: 3,
limiteHistorico: 500,
intervaloColeta: 5000 // 5 segundos
};

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
contadorSequencial: 0,
carregado500: false,
statusConexao: "Aguardando",
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
// MOTOR ESTATÍSTICO (X-1, X, X+1)
// =====================================================

function calcularRadarMesa(idMesa) {
const mesa = estadoMesas[idMesa];
if (!mesa || !mesa.historico.length) return [];

const girosRecentes = mesa.historico.map(h => h.number);
const listaRadar = [];
const X = config.maxSaidas;

for (let idx = 0; idx < 37; idx++) {
const idConj = "C" + (idx + 1);
const numerosConj = obterConjunto(idx, config.tamConjunto);
const strConjunto = numerosConj.join(", ");

let jogadas = 0;
let saidas = 0;
let atraso_X_menos_1 = "-";
let atraso_X = "-";
let atraso_X_mais_1 = "-";

for (let g = 0; g < girosRecentes.length; g++) {
jogadas++;
if (numerosConj.includes(girosRecentes[g])) {
saidas++;
if (saidas === X - 1) atraso_X_menos_1 = jogadas;
if (saidas === X) atraso_X = jogadas;
if (saidas === X + 1) atraso_X_mais_1 = jogadas;
}
if (saidas === X + 1) break;
}

let statusAtual = "Normal";
let badgeClass = "normal";
let valorOrdenacao = 0;

if (atraso_X !== "-") {
valorOrdenacao = atraso_X;
if (atraso_X >= config.janelaAlvo) {
statusAtual = "🔥 GATILHO";
badgeClass = "ativo";
} else if (atraso_X === config.janelaAlvo - 1) {
statusAtual = "⏳ FALTA 1";
badgeClass = "alerta";
} else if (atraso_X >= config.avisoAntecipado) {
statusAtual = "⚠️ PRÉ";
badgeClass = "alerta";
}
} else if (atraso_X_menos_1 !== "-") {
valorOrdenacao = atraso_X_menos_1 - 0.5;
}

listaRadar.push({
roleta: mesa.nome, id: idConj, conjunto: strConjunto,
x_menos_1: atraso_X_menos_1, x: atraso_X, x_mais_1: atraso_X_mais_1,
status: statusAtual, badge: badgeClass, valorOrdenacao: valorOrdenacao
});
}

listaRadar.sort((a, b) => b.valorOrdenacao - a.valorOrdenacao);
mesa.radar = listaRadar;
return listaRadar;
}

// =====================================================
// WEBHOOK GOOGLE SHEETS
// =====================================================

async function sincronizarLoteComPlanilha(tableId, spins) {
if (!GAS_WEBHOOK_URL) return;
try { await axios.post(GAS_WEBHOOK_URL, { type: "SYNC_BATCH", tableId, alertar: false, spins }, { timeout: 15000 }); } catch (e) {}
}

async function enviarGiroParaPlanilha(tableId, spin) {
if (!GAS_WEBHOOK_URL) return;
try { await axios.post(GAS_WEBHOOK_URL, { type: "NEW_SPIN", tableId, spin }, { timeout: 10000 }); } catch (e) {}
}

// =====================================================
// EXTRATORES UNIVERSAIS (JSON BLITZ OU HTML)
// =====================================================

function localizarArrayDeJogos(obj, profundidade = 0) {
if (!obj || profundidade > 4) return null;
if (Array.isArray(obj) && obj.length && obj.some(i => i && typeof i === "object")) return obj;
if (typeof obj === "object") {
for (const chave of ["history", "results", "data", "games", "statistics", "list"]) {
if (obj[chave] !== undefined) {
const enc = localizarArrayDeJogos(obj[chave], profundidade + 1);
if (enc) return enc;
}
}
for (const val of Object.values(obj)) {
if (val && typeof val === "object") {
const enc = localizarArrayDeJogos(val, profundidade + 1);
if (enc) return enc;
}
}
}
return null;
}

function normalizarJogoJSON(item) {
if (!item) return null;
const gameId = item.gameId ?? item.game_id ?? item.id ?? item.roundId;
const bruto = item.gameResult ?? item.rawResult ?? item.result ?? item.number ?? item.winningNumber;
if (bruto === undefined || bruto === null) return null;

const texto = String(bruto).trim();
const match = texto.match(/(?:^|\D)(\d{1,2})(?:\D|$)/);
const numero = Number(match ? match[1] : texto);

if (!Number.isInteger(numero) || numero < 0 || numero > 36) return null;

return {
gameId: gameId ? String(gameId) : null,
number: numero,
rawResult: texto,
timestamp: item.timestamp ?? item.date ?? item.createdAt ?? new Date().toISOString()
};
}

function extrairNumerosDoHtml(htmlBruto) {
if (!htmlBruto) return [];
const regexBloco = /<div[^>]*data-testid="single-result"[^>]*>[\s\S]*?<\/div>/gi;
const blocos = htmlBruto.match(regexBloco) || [];
const itens = [];
for (const bloco of blocos) {
const matchBetCode = bloco.match(/data-bet-code="(\d+)"/i);
const matchSpan = bloco.match(/<span>\s*(\d{1,2})\s*<\/span>/i);
let numero = null;
if (matchSpan) numero = Number(matchSpan[1]);
else if (matchBetCode) {
const betCode = Number(matchBetCode[1]);
numero = betCode === 2 ? 0 : betCode - 3;
}
if (Number.isInteger(numero) && numero >= 0 && numero <= 36) {
itens.push({ number: numero, gameId: null });
}
}
return itens;
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

// =====================================================
// NÚCLEO DE INGESTÃO (Aceita API ou HTML)
// =====================================================

function processarListaDeJogos(idMesa, itens, origem) {
const mesa = estadoMesas[idMesa];
if (!mesa) return;
if (!itens || !itens.length) return;

const agora = new Date().toISOString();

// Carga Inicial (Se vierem 100+ giros ou mesa vazia)
if (!mesa.carregado500 || itens.length >= 100) {
const totalBase = itens.slice(0, config.limiteHistorico);
mesa.historico = [];
mesa.contadorSequencial = 0;
const doMaisAntigo = totalBase.slice().reverse();
for (const item of doMaisAntigo) {
mesa.contadorSequencial += 1;
const gId = item.gameId || (idMesa + "_AUTO_" + String(mesa.contadorSequencial).padStart(6, "0"));
mesa.historico.unshift({
tableId: idMesa, gameId: gId, number: item.number, rawResult: String(item.number), timestamp: item.timestamp || agora, coletadoEm: agora, origem: origem
});
}
mesa.ultimoGameId = mesa.historico[0].gameId;
mesa.carregado500 = true;
mesa.statusConexao = "Online (" + origem + ")";
sincronizarLoteComPlanilha(idMesa, mesa.historico);
calcularRadarMesa(idMesa);
return;
}

// Atualização ao vivo por alinhamento
const numRecentes = itens.map(x => x.number);
const numHistorico = mesa.historico.map(x => x.number);
const novos = descobrirNovosPorAlinhamento(numRecentes, numHistorico);

if (novos === null || novos.length === 0) return;

const novosInvertidos = novos.slice().reverse();
// Pega os itens reais correspondentes aos números novos
const itensNovosReais = itens.slice(0, novos.length).reverse();

for (let i = 0; i < novosInvertidos.length; i++) {
mesa.contadorSequencial += 1;
const itemOriginal = itensNovosReais[i];
const gId = itemOriginal.gameId || (idMesa + "_AUTO_" + String(mesa.contadorSequencial).padStart(6, "0"));

const novoGiro = {
tableId: idMesa, gameId: gId, number: novosInvertidos[i], rawResult: String(novosInvertidos[i]), timestamp: itemOriginal.timestamp || agora, coletadoEm: agora, origem: origem
};
mesa.historico.unshift(novoGiro);
enviarGiroParaPlanilha(idMesa, novoGiro);
}

mesa.historico = mesa.historico.slice(0, config.limiteHistorico);
mesa.ultimoGameId = mesa.historico[0].gameId;
mesa.statusConexao = "Online (" + origem + " ao vivo)";
calcularRadarMesa(idMesa);
}

// =====================================================
// BACKGROUND WORKER (O ROBÔ 24/7)
// =====================================================

async function rotinaDeColetaAutomatica() {
for (const idMesa of Object.keys(CATALOGO_MESAS)) {
const mesaInfo = CATALOGO_MESAS[idMesa];
if (mesaInfo.ativa && mesaInfo.blitzUrl) {
try {
const resposta = await axios.get(mesaInfo.blitzUrl, { timeout: 10000 });
const arrayJogos = localizarArrayDeJogos(resposta.data);
if (arrayJogos) {
const itensNormalizados = arrayJogos.map(normalizarJogoJSON).filter(Boolean);
if (itensNormalizados.length > 0) {
processarListaDeJogos(idMesa, itensNormalizados, "API_Blitz");
}
}
} catch (e) {
// Se falhar silenciosamente, tenta na próxima
}
}
}
}

// Inicia o loop infinito do servidor
setInterval(rotinaDeColetaAutomatica, config.intervaloColeta);

// =====================================================
// ROTAS API
// =====================================================

app.post("/api/html-ingest", (req, res) => {
try {
res.setHeader("Access-Control-Allow-Origin", "*");
const idMesa = String(req.body.tableId || "237").trim();
const html = String(req.body.html || "");
const itens = extrairNumerosDoHtml(html);
if (itens.length > 0) {
processarListaDeJogos(idMesa, itens, "HTML_Manual");
return res.json({ status: "success", idMesa, inseridos: itens.length });
}
return res.status(400).json({ status: "error", message: "Nenhum giro detectado no HTML." });
} catch (err) {
return res.status(400).json({ status: "error", message: err.message });
}
});
app.options("/api/html-ingest", (req, res) => {
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type");
res.send();
});

app.get("/api/radar-todas", (req, res) => {
let radarGlobal = [];
let conexoes = [];
Object.keys(CATALOGO_MESAS).forEach(id => {
if(CATALOGO_MESAS[id].ativa) {
radarGlobal = radarGlobal.concat(calcularRadarMesa(id));
const m = estadoMesas[id];
conexoes.push(`${CATALOGO_MESAS[id].nome}: ${m.statusConexao} (${m.historico.length})`);
}
});
radarGlobal.sort((a, b) => b.valorOrdenacao - a.valorOrdenacao);
res.json({ status: "success", conexoes: conexoes.join(" | "), config, radar: radarGlobal });
});

app.post("/api/config", (req, res) => {
const b = req.body || {};
if (b.statusRobo) config.statusRobo = b.statusRobo;
if (b.janelaAlvo) config.janelaAlvo = Number(b.janelaAlvo);
if (b.avisoAntecipado) config.avisoAntecipado = Number(b.avisoAntecipado);
if (b.maxSaidas) config.maxSaidas = Number(b.maxSaidas);
if (b.tamConjunto) config.tamConjunto = Number(b.tamConjunto);
Object.keys(estadoMesas).forEach(id => calcularRadarMesa(id));
res.json({ status: "success", config });
});

// =====================================================
// PAINEL VIP 
// =====================================================

app.get("/", (req, res) => {
const host = req.get('host');
const html = [
"<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>",
"<meta name='viewport' content='width=device-width, initial-scale=1'>",
"<title>ROULETTE VIP CONTROL</title>",
"<style>",
":root { --bg: #121212; --card: #1a1a1a; --green: #00c753; --red: #e74c3c; --text: #f0f0f0; --border: #333; }",
"body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding:10px; margin:0; }",
"h2 { color: var(--green); margin: 5px 0 15px 0; text-align: center; letter-spacing: 1px; }",
".grid { display: grid; grid-template-columns: 1fr; gap: 10px; margin-bottom: 12px; }",
"@media(min-width:768px){ .grid { grid-template-columns: 1fr 1fr; } }",
".card { background: var(--card); padding: 15px; border-radius: 10px; border: 1px solid var(--border); box-shadow: 0 4px 6px rgba(0,0,0,0.3); }",
"input, select, textarea { width: 100%; padding: 10px; background: #222; color: #fff; border: 1px solid #444; border-radius: 6px; box-sizing: border-box; margin-top: 5px; font-size: 15px; }",
"input:focus, select:focus { outline: none; border-color: var(--green); }",
"button { width: 100%; padding: 12px; background: var(--green); color: #000; font-weight: bold; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; margin-top: 10px; text-transform: uppercase; }",
".table-wrapper { overflow-x: auto; margin-top: 10px; border-radius: 8px; border: 1px solid var(--border); }",
"table { width: 100%; border-collapse: collapse; font-size: 14px; white-space: nowrap; }",
"th, td { border-bottom: 1px solid #2a2a2a; padding: 12px 10px; text-align: center; }",
"th { background: #000; color: #fff; border-bottom: 3px solid var(--red); text-transform: uppercase; font-size: 12px; }",
"tr:nth-child(even) { background: #151515; }",
"tr:hover { background: #222; }",
".badge { padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; }",
".ativo { background: rgba(0, 199, 83, 0.2); color: var(--green); border: 1px solid var(--green); }",
".alerta { background: rgba(231, 76, 60, 0.2); color: var(--red); border: 1px solid var(--red); }",
".normal { color: #888; }",
".col-destaque { background: rgba(255, 255, 255, 0.03); font-weight: bold; }",
"</style></head>",
"<body>",
"<h2>🎯 ROULETTE VIP CONTROL</h2>",

"<div class='grid'>",
"<div class='card'>",
"<b style='color:var(--green)'>⚙️ Configurações Dinâmicas</b>",
"<div style='display:flex; gap:10px; margin-top:10px;'>",
"<div style='flex:1'><label style='font-size:12px;color:#aaa'>Alvo (Saídas)</label><input type='number' id='maxSaidas' value='"+config.maxSaidas+"' onchange='salvarConfig()'></div>",
"<div style='flex:1'><label style='font-size:12px;color:#aaa'>Janela Alvo</label><input type='number' id='janelaAlvo' value='"+config.janelaAlvo+"' onchange='salvarConfig()'></div>",
"</div>",
"<div style='display:flex; gap:10px; margin-top:10px;'>",
"<div style='flex:1'><label style='font-size:12px;color:#aaa'>Pré-Aviso</label><input type='number' id='avisoAntecipado' value='"+config.avisoAntecipado+"' onchange='salvarConfig()'></div>",
"<div style='flex:1'><label style='font-size:12px;color:#aaa'>Tamanho Conj.</label><input type='number' id='tamConjunto' value='"+config.tamConjunto+"' onchange='salvarConfig()'></div>",
"</div>",
"</div>",

"<div class='card'>",
"<b style='color:var(--red)'>📥 Alimentação Manual (Plano B)</b><br>",
"<select id='mesaSelect' style='margin-bottom:5px'>",
"<option value='237'>🇧🇷 Roleta Brasileira</option>",
"<option value='204'>⚡ Mega Roulette</option>",
"<option value='225'>🏎️ Auto-Roulette</option>",
"</select>",
"<textarea id='htmlBox' rows='2' placeholder='Cole HTML se a API falhar...'></textarea>",
"<button onclick='enviarHtml()'>SALVAR GIROS</button>",
"</div>",
"</div>",

"<div class='card'>",
"<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:10px'>",
"<b style='color:#fff;font-size:16px'>📡 Radar Multi-Mesas</b>",
"<select id='filtroRadar' onchange='renderizarTabela()' style='width:auto;padding:5px 10px;background:#333'>",
"<option value='todos'>Ver Todos</option>",
"<option value='gatilho'>Só Gatilhos 🔥</option>",
"</select>",
"</div>",
"<div style='font-size:12px;color:#00c753;margin-bottom:10px;font-weight:bold' id='lblConexoes'>Iniciando robô autônomo...</div>",

"<div class='table-wrapper'>",
"<table><thead><tr>",
"<th>Roleta</th><th>ID</th><th>Conjunto</th>",
"<th>Saída <span id='hdr-x-1'>9</span></th>",
"<th class='col-destaque' style='color:var(--green)'>Saída <span id='hdr-x'>10</span></th>",
"<th>Saída <span id='hdr-x-mais-1'>11</span></th>",
"<th>Status</th>",
"</tr></thead>",
"<tbody id='radarBody'><tr><td colspan='7'>Buscando dados na API...</td></tr></tbody>",
"</table></div></div>",

"<script>",
"let dadosGlobais=null;",
"async function carregarRadar(){",
"try{",
"let r=await fetch('/api/radar-todas');",
"let j=await r.json();",
"dadosGlobais=j;",
"document.getElementById('lblConexoes').textContent = j.conexoes;",
"let x = j.config.maxSaidas;",
"document.getElementById('hdr-x-1').textContent = x - 1;",
"document.getElementById('hdr-x').textContent = x;",
"document.getElementById('hdr-x-mais-1').textContent = x + 1;",
"renderizarTabela();",
"}catch(e){}",
"}",
"function renderizarTabela(){",
"if(!dadosGlobais)return;",
"let tbody=document.getElementById('radarBody');",
"tbody.innerHTML='';",
"let filtro=document.getElementById('filtroRadar').value;",
"dadosGlobais.radar.forEach(c=>{",
"if(filtro==='gatilho'&&!c.status.includes('GATILHO')&&!c.status.includes('FALTA'))return;",
"let tr=document.createElement('tr');",
"tr.innerHTML=`<td><b>${c.roleta}</b></td><td>${c.id}</td><td style='text-align:left;font-size:12px'>${c.conjunto}</td><td>${c.x_menos_1}</td><td class='col-destaque'>${c.x}</td><td>${c.x_mais_1}</td><td><span class='badge ${c.badge}'>${c.status}</span></td>`;",
"tbody.appendChild(tr);",
"});",
"}",
"async function enviarHtml(){",
"let mesa=document.getElementById('mesaSelect').value;",
"let html=document.getElementById('htmlBox').value;",
"if(!html)return alert('Cole o HTML primeiro!');",
"try{",
"let r=await fetch('/api/html-ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tableId:mesa,html})});",
"let j=await r.json();",
"document.getElementById('htmlBox').value='';",
"carregarRadar();",
"}catch(e){alert('Erro: '+e.message);}",
"}",
"async function salvarConfig(){",
"let payload={",
"janelaAlvo:document.getElementById('janelaAlvo').value,",
"maxSaidas:document.getElementById('maxSaidas').value,",
"avisoAntecipado:document.getElementById('avisoAntecipado').value,",
"tamConjunto:document.getElementById('tamConjunto').value",
"};",
"await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});",
"carregarRadar();",
"}",
"carregarRadar();",
"setInterval(carregarRadar, 5000);",
"</script></body></html>"
].join("");
res.send(html);
});

app.listen(PORT, () => {
console.log("ROULETTE VIP rodando na porta " + PORT);
});
