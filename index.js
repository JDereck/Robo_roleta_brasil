const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbyyWyc_z7InWOGkC4wIJ85fqPnlmsyuu9OeKHKFypcvgz_nw64I7JwcQqPrSwBA1eyh/exec";
const JSESSIONID = process.env.JSESSIONID || "";

const CILINDRO = [
0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const CATALOGO_MESAS = {
"237": { id: "237", tableIdApi: "rwbrzportrwa16rg", nome: "🇧🇷 Brasil", ativa: true },
"204": { id: "204", tableIdApi: "204", nome: "⚡ Mega", ativa: true },
"225": { id: "225", tableIdApi: "225", nome: "🏎️ Auto", ativa: true }
};

const config = {
statusRobo: "ATIVO",
janelaAlvo: 100,
avisoAntecipado: 98,
maxSaidas: 10,
tamConjunto: 6,
maxEntradas: 3,
limiteHistorico: 500
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
statusConexao: "Aguardando base (500)",
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
// MOTOR ESTATÍSTICO (X-1, X, X+1 EXATO)
// =====================================================

function contarJogadasAteSaidas(girosRecentes, numerosConj, limiteSaidas) {
if (limiteSaidas < 0) return 0;
let contSaidas = 0;
let jogadasJanela = 0;
for (let g = 0; g < girosRecentes.length; g++) {
if (numerosConj.includes(girosRecentes[g])) {
if (contSaidas === limiteSaidas) break;
contSaidas++;
}
jogadasJanela++;
}
return { jogadas: jogadasJanela, saidas: contSaidas };
}

function calcularRadarMesa(idMesa) {
const mesa = estadoMesas[idMesa];
if (!mesa || !mesa.historico.length) return [];

const girosRecentes = mesa.historico.map(h => h.number);
const listaRadar = [];
const X = Number(config.maxSaidas) || 10;

for (let idx = 0; idx < 37; idx++) {
const idConj = "C" + (idx + 1);
const numerosConj = obterConjunto(idx, config.tamConjunto);
const strConjunto = numerosConj.join(", ");

const calcMenos1 = contarJogadasAteSaidas(girosRecentes, numerosConj, Math.max(0, X - 1));
const calcAlvo = contarJogadasAteSaidas(girosRecentes, numerosConj, X);
const calcMais1 = contarJogadasAteSaidas(girosRecentes, numerosConj, X + 1);

const atraso_X_menos_1 = calcMenos1.jogadas;
const atraso_X = calcAlvo.jogadas;
const atraso_X_mais_1 = calcMais1.jogadas;

let statusAtual = "Normal";
let badgeClass = "normal";

if (atraso_X >= config.janelaAlvo && calcAlvo.saidas <= X) {
statusAtual = "🔥 GATILHO";
badgeClass = "ativo";
} else if (atraso_X === config.janelaAlvo - 1) {
statusAtual = "⏳ FALTA 1";
badgeClass = "alerta";
} else if (atraso_X >= config.avisoAntecipado) {
statusAtual = "⚠️ PRÉ";
badgeClass = "alerta";
}

listaRadar.push({
tableId: idMesa,
roleta: mesa.nome,
id: idConj,
conjunto: strConjunto,
x_menos_1: atraso_X_menos_1,
x: atraso_X,
x_mais_1: atraso_X_mais_1,
saidasReais: calcAlvo.saidas,
status: statusAtual,
badge: badgeClass,
valorOrdenacao: atraso_X
});
}

listaRadar.sort((a, b) => b.valorOrdenacao - a.valorOrdenacao);
mesa.radar = listaRadar;
return listaRadar;
}

// =====================================================
// SINCRONIZAÇÃO COM GOOGLE SHEETS
// =====================================================

async function sincronizarLoteComPlanilha(tableId, spins) {
if (!GAS_WEBHOOK_URL) return;
try {
await axios.post(GAS_WEBHOOK_URL, { type: "SYNC_BATCH", tableId, alertar: false, spins }, { timeout: 15000 });
} catch (e) {
console.error("Erro SYNC_BATCH:", e.message);
}
}

async function enviarGiroParaPlanilha(tableId, spin) {
if (!GAS_WEBHOOK_URL) return;
try {
await axios.post(GAS_WEBHOOK_URL, { type: "NEW_SPIN", tableId, spin }, { timeout: 10000 });
} catch (e) {
console.error("Erro NEW_SPIN:", e.message);
}
}

// =====================================================
// EXTRATORES (HTML, TEXTO #drawerRoot OU ARRAY)
// =====================================================

function extrairNumerosDeQualquerEntrada(entrada) {
if (Array.isArray(entrada)) {
return entrada.map(x => Number(String(x).trim())).filter(n => Number.isInteger(n) && n >= 0 && n <= 36);
}
if (!entrada || typeof entrada !== "string") return [];

if (entrada.includes("single-result")) {
const regexBloco = /<div[^>]*data-testid="single-result"[^>]*>[\s\S]*?<\/div>/gi;
const blocos = entrada.match(regexBloco) || [];
const nums = [];
for (const bloco of blocos) {
const matchSpan = bloco.match(/<span>\s*(\d{1,2})\s*<\/span>/i);
const matchBetCode = bloco.match(/data-bet-code="(\d+)"/i);
let n = null;
if (matchSpan) n = Number(matchSpan[1]);
else if (matchBetCode) {
const bc = Number(matchBetCode[1]);
n = bc === 2 ? 0 : bc - 3;
}
if (Number.isInteger(n) && n >= 0 && n <= 36) nums.push(n);
}
if (nums.length > 0) return nums;
}

return entrada
.split(/[\s,;]+/)
.map(x => x.trim())
.filter(x => /^(0|[1-9]|[12][0-9]|3[0-6])$/.test(x))
.map(Number);
}

function descobrirNovosPorAlinhamento(atuaisMaisRecentePrimeiro, historicoMaisRecentePrimeiro) {
let k = Math.min(historicoMaisRecentePrimeiro.length, atuaisMaisRecentePrimeiro.length);
while (k > 0 && historicoMaisRecentePrimeiro.slice(0, k).join(",") !== atuaisMaisRecentePrimeiro.slice(-k).join(",")) {
k--;
}
if (k > 0) {
return atuaisMaisRecentePrimeiro.slice(0, atuaisMaisRecentePrimeiro.length - k);
}
return null;
}

function registrarCargaCompleta(idMesa, numerosMaisRecentePrimeiro, origem) {
const mesa = estadoMesas[idMesa];
if (!mesa) throw new Error("Mesa não cadastrada: " + idMesa);

const totalBase = numerosMaisRecentePrimeiro.slice(0, config.limiteHistorico);
const agora = new Date().toISOString();

mesa.historico = [];
mesa.contadorSequencial = 0;

const doMaisAntigo = totalBase.slice().reverse();
for (const num of doMaisAntigo) {
mesa.contadorSequencial += 1;
const gId = idMesa + "_G_" + String(mesa.contadorSequencial).padStart(6, "0");
mesa.historico.unshift({
tableId: idMesa,
gameId: gId,
number: num,
rawResult: String(num),
timestamp: agora,
coletadoEm: agora,
origem: origem
});
}

mesa.ultimoGameId = mesa.historico[0] ? mesa.historico[0].gameId : null;
mesa.carregado500 = true;
mesa.statusConexao = "Ativa (" + mesa.historico.length + " giros | Últ: " + (mesa.historico[0]?.number ?? "-") + ")";
mesa.ultimaAtualizacao = agora;

sincronizarLoteComPlanilha(idMesa, mesa.historico);
calcularRadarMesa(idMesa);

return {
modo: "CARGA_COMPLETA",
inseridos: mesa.historico.length,
totalArmazenado: mesa.historico.length,
ultimoNumero: mesa.historico[0]?.number ?? null
};
}

function registrarGirosAoVivo(idMesa, novosAntigoParaRecente, origem) {
const mesa = estadoMesas[idMesa];
if (!mesa) throw new Error("Mesa não cadastrada: " + idMesa);
if (!mesa.carregado500) {
throw new Error("Carregue primeiro a base de 500 giros da mesa " + idMesa);
}

const agora = new Date().toISOString();
const inseridos = [];

for (const num of novosAntigoParaRecente) {
if (!Number.isInteger(num) || num < 0 || num > 36) continue;
mesa.contadorSequencial += 1;
const gId = idMesa + "_G_" + String(mesa.contadorSequencial).padStart(6, "0");
const giro = {
tableId: idMesa,
gameId: gId,
number: num,
rawResult: String(num),
timestamp: agora,
coletadoEm: agora,
origem: origem
};
mesa.historico.unshift(giro);
inseridos.push(giro);
enviarGiroParaPlanilha(idMesa, giro);
}

mesa.historico = mesa.historico.slice(0, config.limiteHistorico);
if (inseridos.length > 0) {
mesa.ultimoGameId = mesa.historico[0].gameId;
}
mesa.statusConexao = "Ao Vivo (" + mesa.historico.length + " giros | Últ: " + (mesa.historico[0]?.number ?? "-") + ")";
mesa.ultimaAtualizacao = agora;

calcularRadarMesa(idMesa);

return {
modo: "GIRO_AO_VIVO",
inseridos: inseridos.length,
novosNumeros: inseridos.map(x => x.number),
totalArmazenado: mesa.historico.length,
ultimoNumero: mesa.historico[0]?.number ?? null
};
}

// =====================================================
// ROTAS DE INGESTÃO E CONFIGURAÇÃO (CORS LIBERADO)
// =====================================================

app.use((req, res, next) => {
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type");
if (req.method === "OPTIONS") return res.sendStatus(200);
next();
});

app.post("/api/spins", (req, res) => {
try {
const idMesa = String(req.body.tableId || "237").trim();
const mode = String(req.body.mode || "AUTO").toUpperCase();
const numeros = extrairNumerosDeQualquerEntrada(req.body.numbers || req.body.text || req.body.html);

if (!numeros.length) {
return res.status(400).json({ status: "error", message: "Nenhum número válido (0-36) encontrado." });
}

if (mode === "FULL" || numeros.length >= 100) {
const resFull = registrarCargaCompleta(idMesa, numeros, "coletor_500");
return res.json({ status: "success", idMesa, resultado: resFull });
}

if (mode === "NEW_ORDERED") {
const resLive = registrarGirosAoVivo(idMesa, numeros, "observer_live");
return res.json({ status: "success", idMesa, resultado: resLive });
}

const mesa = estadoMesas[idMesa];
if (!mesa || !mesa.carregado500) {
return res.status(400).json({ status: "error", message: "Envie os 500 giros primeiro antes da barra de 32 giros." });
}

const histNums = mesa.historico.map(x => x.number);
const novosMaisRecente = descobrirNovosPorAlinhamento(numeros, histNums);
if (novosMaisRecente === null) {
return res.status(400).json({ status: "error", message: "Quebra de sequência detectada. Reenvie os 500 giros." });
}

const resAuto = registrarGirosAoVivo(idMesa, novosMaisRecente.slice().reverse(), "barra_32");
return res.json({ status: "success", idMesa, resultado: resAuto });
} catch (err) {
return res.status(400).json({ status: "error", message: err.message });
}
});

app.post("/api/html-ingest", (req, res) => {
try {
const idMesa = String(req.body.tableId || "237").trim();
const entrada = req.body.html || req.body.text || req.body.numbers || "";
const numeros = extrairNumerosDeQualquerEntrada(entrada);

if (!numeros.length) {
return res.status(400).json({ status: "error", message: "Nenhum número válido encontrado." });
}

if (numeros.length >= 100) {
const resultado = registrarCargaCompleta(idMesa, numeros, "manual_500");
return res.json({ status: "success", idMesa, resultado });
}

const mesa = estadoMesas[idMesa];
if (!mesa || !mesa.carregado500) {
return res.status(400).json({ status: "error", message: "Carregue os 500 giros primeiro." });
}

if (numeros.length === 1) {
const resultado = registrarGirosAoVivo(idMesa, numeros, "manual_1_giro");
return res.json({ status: "success", idMesa, resultado });
}

const histNums = mesa.historico.map(x => x.number);
const novosMaisRecente = descobrirNovosPorAlinhamento(numeros, histNums);
if (novosMaisRecente === null) {
return res.status(400).json({ status: "error", message: "Sem sobreposição com o histórico. Envie os 500 giros." });
}

const resultado = registrarGirosAoVivo(idMesa, novosMaisRecente.slice().reverse(), "manual_barra");
return res.json({ status: "success", idMesa, resultado });
} catch (err) {
return res.status(400).json({ status: "error", message: err.message });
}
});

app.get("/api/radar-todas", (req, res) => {
let radarGlobal = [];
let conexoes = [];
Object.keys(CATALOGO_MESAS).forEach(id => {
if (CATALOGO_MESAS[id].ativa) {
radarGlobal = radarGlobal.concat(calcularRadarMesa(id));
const m = estadoMesas[id];
conexoes.push(CATALOGO_MESAS[id].nome + ": " + m.statusConexao);
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
// PAINEL ADMINISTRATIVO VIP
// =====================================================

app.get("/", (req, res) => {
const host = req.get("host");
const scriptObserver = `(()=>{const API="https://${host}/api/spins",MESA="237";const gaveta=document.querySelector('[data-testid="game-statistics"]')||document.querySelector("#drawerRoot");if(gaveta){const n500=[...gaveta.querySelectorAll('[data-testid="single-result"]')].map(e=>e.innerText.trim()).filter(x=>/^(0|[1-9]|[12][0-9]|3[0-6])$/.test(x));if(n500.length>=100)fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tableId:MESA,mode:"FULL",numbers:n500})}).then(r=>r.json()).then(j=>console.log("500 GIROS ENVIADOS:",j));}const el=document.querySelector('[data-testid="recent-results"]');if(!el)return console.log("Barra recent-results não encontrada neste frame.");window.__rouletteObserver?.disconnect();let anterior=[...el.querySelectorAll('[data-testid="single-result"]')].map(e=>e.innerText.trim()),timer;window.__rouletteObserver=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(()=>{const atual=[...el.querySelectorAll('[data-testid="single-result"]')].map(e=>e.innerText.trim());let k=Math.min(anterior.length,atual.length);while(k>0&&anterior.slice(0,k).join(",")!==atual.slice(-k).join(","))k--;if(k>0){const novos=atual.slice(0,atual.length-k).reverse();if(novos.length){console.log("NOVOS GIROS ENVIADOS:",novos);fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tableId:MESA,mode:"NEW_ORDERED",numbers:novos})});}anterior=atual;}else console.log("ATENÇÃO: continuidade não confirmada.");},300);});window.__rouletteObserver.observe(el,{childList:true,subtree:true,characterData:true});return "Monitoramento ativo! Base barra: "+anterior.length+" giros";})()`;

const html = [
"<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>",
"<meta name='viewport' content='width=device-width, initial-scale=1'>",
"<title>ROULETTE CONTROL</title>",
"<style>",
":root{--bg:#0f0f12;--card:#18181d;--green:#00e676;--red:#ff3d00;--gold:#ffd600;--text:#f5f5f5;--border:#2c2c35}",
"body{background:var(--bg);color:var(--text);font-family:Arial,sans-serif;padding:10px;margin:0}",
"h2{color:var(--green);margin:6px 0 12px 0;text-align:center;font-size:20px}",
".grid{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:10px}",
"@media(min-width:768px){.grid{grid-template-columns:1fr 1fr}}",
".card{background:var(--card);padding:12px;border-radius:10px;border:1px solid var(--border);margin-bottom:10px}",
"input,select,textarea{width:100%;padding:9px;background:#101014;color:#fff;border:1px solid #3a3a45;border-radius:6px;box-sizing:border-box;margin-top:4px;font-size:14px}",
"button{width:100%;padding:11px;background:var(--green);color:#000;font-weight:bold;border:none;border-radius:6px;font-size:14px;cursor:pointer;margin-top:8px}",
".table-wrapper{overflow-x:auto;margin-top:8px;border-radius:8px;border:1px solid var(--border)}",
"table{width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap}",
"th,td{border-bottom:1px solid #262630;padding:10px 8px;text-align:center}",
"th{background:#09090b;color:#fff;border-bottom:2px solid var(--red);font-size:12px}",
"tr:nth-child(even){background:#141419}",
".badge{padding:4px 8px;border-radius:4px;font-weight:bold;font-size:11px}",
".ativo{background:rgba(0,230,118,0.18);color:var(--green);border:1px solid var(--green)}",
".alerta{background:rgba(255,214,0,0.18);color:var(--gold);border:1px solid var(--gold)}",
".normal{color:#888}",
".col-alvo{background:rgba(0,230,118,0.08);font-weight:bold;color:var(--green);font-size:14px}",
"</style></head><body>",
"<h2>🎯 ROULETTE CONTROL</h2>",
"<div class='grid'>",
"<div class='card'>",
"<b style='color:var(--green)'>⚙️ Parâmetros Dinâmicos</b>",
"<div style='display:flex;gap:8px;margin-top:8px'>",
"<div style='flex:1'><label style='font-size:11px;color:#aaa'>Saídas Alvo (X)</label><input type='number' id='maxSaidas' value='" + config.maxSaidas + "' onchange='salvarConfig()'></div>",
"<div style='flex:1'><label style='font-size:11px;color:#aaa'>Janela Alvo</label><input type='number' id='janelaAlvo' value='" + config.janelaAlvo + "' onchange='salvarConfig()'></div>",
"</div>",
"<div style='display:flex;gap:8px;margin-top:8px'>",
"<div style='flex:1'><label style='font-size:11px;color:#aaa'>Pré-Alerta</label><input type='number' id='avisoAntecipado' value='" + config.avisoAntecipado + "' onchange='salvarConfig()'></div>",
"<div style='flex:1'><label style='font-size:11px;color:#aaa'>Vizinhos</label><input type='number' id='tamConjunto' value='" + config.tamConjunto + "' onchange='salvarConfig()'></div>",
"</div></div>",
"<div class='card'>",
"<b style='color:var(--gold)'>📥 Alimentar (500 Giros, Barra ou 1 Número)</b>",
"<select id='mesaSelect'>",
"<option value='237'>🇧🇷 Roleta Brasileira (237)</option>",
"<option value='204'>⚡ Mega Roulette (204)</option>",
"<option value='225'>🏎️ Auto-Roulette (225)</option>",
"</select>",
"<textarea id='htmlBox' rows='2' placeholder='Cole HTML, texto do #drawerRoot ou digite 1 número (ex: 28)...'></textarea>",
"<button onclick='enviarEntrada()'>ENVIAR PARA O MOTOR</button>",
"</div></div>",
"<div class='card'>",
"<div style='display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px'>",
"<b style='font-size:15px'>📡 Radar Multi-Mesas (X-1 | X | X+1)</b>",
"<div style='display:flex;gap:6px'>",
"<select id='filtroMesa' onchange='renderizarTabela()' style='width:auto;padding:5px'>",
"<option value='todas'>Todas as Mesas</option>",
"<option value='237'>Só Brasil</option>",
"<option value='204'>Só Mega</option>",
"<option value='225'>Só Auto</option>",
"</select>",
"<select id='filtroRadar' onchange='renderizarTabela()' style='width:auto;padding:5px'>",
"<option value='todos'>Todos (37)</option>",
"<option value='top10'>Top 10 Atraso</option>",
"<option value='gatilho'>Só Gatilhos 🔥</option>",
"</select></div></div>",
"<div style='font-size:12px;color:var(--green);margin:8px 0' id='lblConexoes'>Carregando status...</div>",
"<div class='table-wrapper'>",
"<table><thead><tr>",
"<th>Roleta</th><th>ID</th><th>Conjunto (6 Vizinhos)</th>",
"<th>Saída <span id='hdr-x-1'>9</span></th>",
"<th class='col-alvo'>Saída <span id='hdr-x'>10</span></th>",
"<th>Saída <span id='hdr-x-mais-1'>11</span></th>",
"<th>Status</th>",
"</tr></thead>",
"<tbody id='radarBody'><tr><td colspan='7'>Aguardando giros...</td></tr></tbody>",
"</table></div></div>",
"<div class='card'>",
"<b style='color:var(--green)'>⚡ Seu Script MutationObserver Integrado ao Render</b>",
"<p style='font-size:12px;color:#ccc;margin:6px 0'>Se estiver com as estatísticas abertas, ele envia os 500 giros automaticamente e já ativa o monitoramento giro a giro:</p>",
"<textarea id='boxScript' rows='3' readonly style='font-family:monospace;font-size:11px;color:var(--gold)' onclick='this.select()'>" + scriptObserver + "</textarea>",
"</div>",
"<script>",
"let dadosGlobais=null;",
"async function carregarRadar(){",
"try{",
"let r=await fetch('/api/radar-todas');",
"let j=await r.json();",
"dadosGlobais=j;",
"document.getElementById('lblConexoes').textContent=j.conexoes;",
"let x=Number(j.config.maxSaidas)||10;",
"document.getElementById('hdr-x-1').textContent=x-1;",
"document.getElementById('hdr-x').textContent=x;",
"document.getElementById('hdr-x-mais-1').textContent=x+1;",
"renderizarTabela();",
"}catch(e){}",
"}",
"function renderizarTabela(){",
"if(!dadosGlobais)return;",
"let tbody=document.getElementById('radarBody');",
"tbody.innerHTML='';",
"let fStatus=document.getElementById('filtroRadar').value;",
"let fMesa=document.getElementById('filtroMesa').value;",
"let lista=dadosGlobais.radar.filter(c=>fMesa==='todas'||c.tableId===fMesa);",
"if(fStatus==='gatilho')lista=lista.filter(c=>c.status.includes('GATILHO')||c.status.includes('FALTA')||c.status.includes('PRÉ'));",
"if(fStatus==='top10')lista=lista.slice(0,10);",
"if(!lista.length){tbody.innerHTML='<tr><td colspan=\"7\">Nenhum conjunto para o filtro selecionado.</td></tr>';return;}",
"lista.forEach(c=>{",
"let tr=document.createElement('tr');",
"tr.innerHTML=`<td><b>${c.roleta}</b></td><td><b>${c.id}</b></td><td style='text-align:left'>${c.conjunto}</td><td>${c.x_menos_1}</td><td class='col-alvo'>${c.x}</td><td>${c.x_mais_1}</td><td><span class='badge ${c.badge}'>${c.status}</span></td>`;",
"tbody.appendChild(tr);",
"});",
"}",
"async function enviarEntrada(){",
"let mesa=document.getElementById('mesaSelect').value;",
"let txt=document.getElementById('htmlBox').value.trim();",
"if(!txt)return alert('Cole os 500 giros, a barra ou digite o número sorteado!');",
"try{",
"let r=await fetch('/api/html-ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tableId:mesa,html:txt})});",
"let j=await r.json();",
"if(j.status==='error')return alert(j.message);",
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
"setInterval(carregarRadar,4000);",
"</script></body></html>"
].join("");
res.send(html);
});

app.listen(PORT, () => {
console.log("ROULETTE CONTROL rodando na porta " + PORT);
});
