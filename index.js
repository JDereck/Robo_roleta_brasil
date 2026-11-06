const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbyyWyc_z7InWOGkC4wIJ85fqPnlmsyuu9OeKHKFypcvgz_nw64I7JwcQqPrSwBA1eyh/exec";

const CILINDRO = [
0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const CATALOGO_MESAS = {
"237": { id: "237", tableIdApi: "rwbrzportrwa16rg", nome: "🇧🇷 Brasil", ativa: true },
"204": { id: "204", tableIdApi: "204", nome: "⚡ Mega", ativa: false },
"225": { id: "225", tableIdApi: "225", nome: "🏎️ Auto", ativa: false }
};

const config = {
statusRobo: "ATIVO",
jsessionid: process.env.JSESSIONID || "",
mesaSelecionada: "237",
janelaAlvo: 100,
avisoAntecipado: 98,
maxSaidas: 10,
tamConjunto: 6,
maxEntradas: 3,
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
tableIdApi: cadastro.tableIdApi,
nome: cadastro.nome,
historico: [],
ultimoGameId: null,
contadorSequencial: 0,
carregado500: false,
emExecucao: false,
statusConexao: "Aguardando sessão/dados",
ultimoErro: null,
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
// MOTOR ESTATÍSTICO (X-1 | X | X+1)
// =====================================================

function contarJogadasAteSaidas(girosRecentes, numerosConj, limiteSaidas) {
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

const atraso_X = calcAlvo.jogadas;
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
x_menos_1: calcMenos1.jogadas,
x: atraso_X,
x_mais_1: calcMais1.jogadas,
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
// WEBHOOK GOOGLE SHEETS
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
// COLETOR AUTOMÁTICO PRAGMATIC (/api/ui/statisticHistory)
// =====================================================

function extrairJSessionIdLimpo(texto) {
if (!texto) return "";
const str = String(texto).trim();
const match = str.match(/JSESSIONID=([^;&\s"']+)/i);
if (match) return match[1].trim();
return str;
}

function localizarArrayDeJogos(obj, profundidade = 0) {
if (!obj || profundidade > 4) return null;
if (Array.isArray(obj)) {
if (obj.length && obj.some(item => item && typeof item === "object")) return obj;
return null;
}
if (typeof obj === "object") {
for (const chave of ["history", "results", "data", "games", "statistics"]) {
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

function normalizarJogoPragmatic(item, idMesa) {
if (!item || typeof item !== "object") return null;
const gameId = item.gameId ?? item.game_id ?? item.gameID ?? item.id ?? item.roundId;
const bruto = item.gameResult ?? item.rawResult ?? item.result ?? item.number ?? item.winningNumber;
if (gameId === undefined || gameId === null || bruto === undefined || bruto === null) return null;

const texto = String(bruto).trim();
const match = texto.match(/(?:^|\D)(\d{1,2})(?:\D|$)/);
const numero = Number(match ? match[1] : texto);
if (!Number.isInteger(numero) || numero < 0 || numero > 36) return null;

return {
tableId: String(idMesa),
gameId: String(gameId).trim(),
number: numero,
rawResult: texto,
timestamp: item.timestamp ?? item.date ?? item.time ?? new Date().toISOString(),
coletadoEm: new Date().toISOString(),
origem: "auto_pragmatic_api"
};
}

async function consultarApiPragmatic(idMesa) {
if (!config.jsessionid) {
throw new Error("Sessão JSESSIONID aguardando conexão.");
}

const cadastro = CATALOGO_MESAS[idMesa];
if (!cadastro) throw new Error("Mesa não cadastrada.");

const candidatos = [cadastro.tableIdApi, idMesa].filter(Boolean);
let ultimoErro = null;

for (const tId of candidatos) {
try {
const url = "https://games.pragmaticplaylive.net/api/ui/statisticHistory";
const res = await axios.get(url, {
params: {
tableId: tId,
numberOfGames: 500,
JSESSIONID: config.jsessionid
},
timeout: 15000,
headers: {
"Accept": "application/json",
"Cookie": "JSESSIONID=" + config.jsessionid,
"User-Agent": "Mozilla/5.0"
}
});

const listaBruta = localizarArrayDeJogos(res.data);
if (listaBruta && listaBruta.length > 0) {
const jogos = listaBruta.map(item => normalizarJogoPragmatic(item, idMesa)).filter(Boolean);
if (jogos.length > 0) return jogos;
}
ultimoErro = "API respondeu sem lista de giros (verifique se o JSESSIONID expirou).";
} catch (err) {
ultimoErro = err.message;
}
}
throw new Error(ultimoErro || "Falha ao consultar statisticHistory.");
}

async function coletarMesaAutomaticamente(idMesa) {
const mesa = estadoMesas[idMesa];
const cadastro = CATALOGO_MESAS[idMesa];
if (!mesa || !cadastro || !cadastro.ativa) return;
if (!config.jsessionid) return;
if (mesa.emExecucao) return;

mesa.emExecucao = true;
try {
const jogos = await consultarApiPragmatic(idMesa);

if (!mesa.carregado500 || !mesa.ultimoGameId) {
const vistos = new Set();
const unicos = [];
for (const j of jogos) {
if (!vistos.has(j.gameId)) {
vistos.add(j.gameId);
unicos.push(j);
}
}
mesa.historico = unicos.slice(0, config.limiteHistorico);
mesa.ultimoGameId = mesa.historico[0]?.gameId || null;
mesa.carregado500 = true;
mesa.ultimoErro = null;
mesa.ultimaAtualizacao = new Date().toISOString();
mesa.statusConexao = "🟢 Auto API (" + mesa.historico.length + " giros | Últ: " + (mesa.historico[0]?.number ?? "-") + ")";

sincronizarLoteComPlanilha(idMesa, mesa.historico);
calcularRadarMesa(idMesa);
return;
}

const idxAnterior = jogos.findIndex(j => j.gameId === mesa.ultimoGameId);
if (idxAnterior === -1) {
mesa.historico = jogos.slice(0, config.limiteHistorico);
mesa.ultimoGameId = mesa.historico[0]?.gameId || null;
sincronizarLoteComPlanilha(idMesa, mesa.historico);
calcularRadarMesa(idMesa);
return;
}

const novos = jogos.slice(0, idxAnterior).reverse();
for (const giro of novos) {
if (!mesa.historico.some(r => r.gameId === giro.gameId)) {
mesa.historico.unshift(giro);
enviarGiroParaPlanilha(idMesa, giro);
}
}

mesa.historico = mesa.historico.slice(0, config.limiteHistorico);
if (novos.length > 0) {
mesa.ultimoGameId = mesa.historico[0].gameId;
calcularRadarMesa(idMesa);
}

mesa.ultimoErro = null;
mesa.ultimaAtualizacao = new Date().toISOString();
mesa.statusConexao = "🟢 Auto API (" + mesa.historico.length + " giros | Últ: " + (mesa.historico[0]?.number ?? "-") + ")";
} catch (err) {
mesa.ultimoErro = err.message;
if (!mesa.carregado500) {
mesa.statusConexao = "🔴 Aguardando sessão (" + err.message.slice(0, 35) + ")";
}
} finally {
mesa.emExecucao = false;
}
}

setInterval(() => {
Object.keys(CATALOGO_MESAS).forEach(id => {
if (CATALOGO_MESAS[id].ativa) {
coletarMesaAutomaticamente(id);
}
});
}, config.intervaloColeta);

// =====================================================
// EXTRATOR PARA PONTE DO NAVEGADOR / MANUAL
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

function descobrirNovosPorAlinhamento(atuais, historico) {
let k = Math.min(historico.length, atuais.length);
while (k > 0 && historico.slice(0, k).join(",") !== atuais.slice(-k).join(",")) {
k--;
}
if (k > 0) return atuais.slice(0, atuais.length - k);
return null;
}

function registrarCargaCompletaNumeros(idMesa, numeros, origem) {
const mesa = estadoMesas[idMesa];
if (!mesa) throw new Error("Mesa não encontrada: " + idMesa);
const agora = new Date().toISOString();
const totalBase = numeros.slice(0, config.limiteHistorico);

mesa.historico = [];
mesa.contadorSequencial = 0;

for (const num of totalBase.slice().reverse()) {
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

mesa.ultimoGameId = mesa.historico[0]?.gameId || null;
mesa.carregado500 = true;
mesa.statusConexao = "🟢 Ativa (" + mesa.historico.length + " giros | Últ: " + (mesa.historico[0]?.number ?? "-") + ")";
mesa.ultimaAtualizacao = agora;

sincronizarLoteComPlanilha(idMesa, mesa.historico);
calcularRadarMesa(idMesa);
return { modo: "CARGA_COMPLETA", total: mesa.historico.length, ultimo: mesa.historico[0]?.number };
}

function registrarGirosAoVivoNumeros(idMesa, novosAntigoParaRecente, origem) {
const mesa = estadoMesas[idMesa];
if (!mesa || !mesa.carregado500) throw new Error("Carregue os 500 giros da mesa primeiro.");
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
if (inseridos.length > 0) mesa.ultimoGameId = mesa.historico[0].gameId;
mesa.statusConexao = "🟢 Ao Vivo (" + mesa.historico.length + " giros | Últ: " + (mesa.historico[0]?.number ?? "-") + ")";
mesa.ultimaAtualizacao = agora;
calcularRadarMesa(idMesa);

return { modo: "AO_VIVO", inseridos: inseridos.length, ultimo: mesa.historico[0]?.number };
}

// =====================================================
// ROTAS DE API E CONTROLE DE MESAS
// =====================================================

app.use((req, res, next) => {
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type");
if (req.method === "OPTIONS") return res.sendStatus(200);
next();
});

app.post("/api/session", async (req, res) => {
try {
const bruto = req.body.jsessionid || req.body.url || "";
const limpo = extrairJSessionIdLimpo(bruto);
if (!limpo) return res.status(400).json({ status: "error", message: "JSESSIONID vazio." });

config.jsessionid = limpo;

const matchTable = String(bruto).match(/tableId=([a-zA-Z0-9_-]+)/i);
const idMesa = String(req.body.tableId || config.mesaSelecionada || "237");
if (matchTable && CATALOGO_MESAS[idMesa]) {
CATALOGO_MESAS[idMesa].tableIdApi = matchTable[1];
}

CATALOGO_MESAS[idMesa].ativa = true;
await coletarMesaAutomaticamente(idMesa);

const m = estadoMesas[idMesa];
return res.json({
status: "success",
jsessionidConfigurado: true,
idMesa,
statusConexao: m.statusConexao,
totalGiros: m.historico.length,
ultimoErro: m.ultimoErro
});
} catch (err) {
return res.status(400).json({ status: "error", message: err.message });
}
});

app.post("/api/selecionar-mesa", async (req, res) => {
try {
const idMesa = String(req.body.tableId || "237").trim();
if (!CATALOGO_MESAS[idMesa]) {
return res.status(404).json({ status: "error", message: "Mesa não encontrada." });
}
config.mesaSelecionada = idMesa;
CATALOGO_MESAS[idMesa].ativa = true;

if (config.jsessionid) {
await coletarMesaAutomaticamente(idMesa);
}

return res.json({
status: "success",
mesaSelecionada: idMesa,
estado: estadoMesas[idMesa]
});
} catch (err) {
return res.status(400).json({ status: "error", message: err.message });
}
});

app.post("/api/spins", (req, res) => {
try {
const idMesa = String(req.body.tableId || config.mesaSelecionada || "237").trim();
const mode = String(req.body.mode || "AUTO").toUpperCase();

if (req.body.apiItems && Array.isArray(req.body.apiItems)) {
const jogos = req.body.apiItems.map(item => normalizarJogoPragmatic(item, idMesa)).filter(Boolean);
if (jogos.length > 0) {
const mesa = estadoMesas[idMesa];
if (!mesa.carregado500 || jogos.length >= 100) {
mesa.historico = jogos.slice(0, config.limiteHistorico);
mesa.ultimoGameId = mesa.historico[0].gameId;
mesa.carregado500 = true;
mesa.statusConexao = "🟢 Ponte API (" + mesa.historico.length + " giros | Últ: " + mesa.historico[0].number + ")";
sincronizarLoteComPlanilha(idMesa, mesa.historico);
calcularRadarMesa(idMesa);
return res.json({ status: "success", modo: "API_500", total: mesa.historico.length });
}
}
}

const numeros = extrairNumerosDeQualquerEntrada(req.body.numbers || req.body.text || req.body.html);
if (!numeros.length) return res.status(400).json({ status: "error", message: "Nenhum número válido." });

if (mode === "FULL" || numeros.length >= 100) {
return res.json({ status: "success", resultado: registrarCargaCompletaNumeros(idMesa, numeros, "auto_500") });
}
if (mode === "NEW_ORDERED") {
return res.json({ status: "success", resultado: registrarGirosAoVivoNumeros(idMesa, numeros, "auto_live") });
}

const mesa = estadoMesas[idMesa];
if (!mesa || !mesa.carregado500) {
return res.status(400).json({ status: "error", message: "Aguardando base de 500 giros." });
}
const novos = descobrirNovosPorAlinhamento(numeros, mesa.historico.map(x => x.number));
if (novos === null) return res.status(400).json({ status: "error", message: "Alinhamento fora de sincronia." });

return res.json({ status: "success", resultado: registrarGirosAoVivoNumeros(idMesa, novos.slice().reverse(), "barra_live") });
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
res.json({
status: "success",
jsessionidAtivo: Boolean(config.jsessionid),
conexoes: conexoes.join(" | "),
config,
catalogo: CATALOGO_MESAS,
radar: radarGlobal
});
});

app.post("/api/config", (req, res) => {
const b = req.body || {};
if (b.janelaAlvo) config.janelaAlvo = Number(b.janelaAlvo);
if (b.avisoAntecipado) config.avisoAntecipado = Number(b.avisoAntecipado);
if (b.maxSaidas) config.maxSaidas = Number(b.maxSaidas);
if (b.tamConjunto) config.tamConjunto = Number(b.tamConjunto);
if (b.novaMesaId && b.novaMesaNome) {
const nid = String(b.novaMesaId).trim();
CATALOGO_MESAS[nid] = {
id: nid,
tableIdApi: String(b.novaMesaTableIdApi || nid).trim(),
nome: String(b.novaMesaNome).trim(),
ativa: true
};
inicializarMesa(nid);
}
Object.keys(estadoMesas).forEach(id => calcularRadarMesa(id));
res.json({ status: "success", config, catalogo: CATALOGO_MESAS });
});

// =====================================================
// PAINEL ADMINISTRATIVO VIP
// =====================================================

app.get("/", (req, res) => {
const host = req.get("host");
const comandoAuto = `(()=>{const SRV="https://${host}",MESA="237";try{const urls=performance.getEntriesByType("resource").map(r=>r.name);const uApi=urls.find(u=>u.includes("JSESSIONID")||u.includes("statisticHistory"));if(uApi){fetch(SRV+"/api/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tableId:MESA,url:uApi})}).then(r=>r.json()).then(j=>console.log("SESSÃO ENVIADA AO RENDER:",j));}fetch("/api/ui/statisticHistory?tableId=rwbrzportrwa16rg&numberOfGames=500").then(r=>r.json()).then(d=>{const arr=d.history||d.data||d.results;if(arr&&arr.length)fetch(SRV+"/api/spins",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tableId:MESA,apiItems:arr})});}).catch(()=>{});}catch(e){}const gaveta=document.querySelector('[data-testid="game-statistics"]')||document.querySelector("#drawerRoot");if(gaveta){const n500=[...gaveta.querySelectorAll('[data-testid="single-result"]')].map(e=>e.innerText.trim()).filter(x=>/^(0|[1-9]|[12][0-9]|3[0-6])$/.test(x));if(n500.length>=100)fetch(SRV+"/api/spins",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tableId:MESA,mode:"FULL",numbers:n500})});}const el=document.querySelector('[data-testid="recent-results"]');if(el){window.__rouletteObserver?.disconnect();let ant=[...el.querySelectorAll('[data-testid="single-result"]')].map(e=>e.innerText.trim()),tm;window.__rouletteObserver=new MutationObserver(()=>{clearTimeout(tm);tm=setTimeout(()=>{const at=[...el.querySelectorAll('[data-testid="single-result"]')].map(e=>e.innerText.trim());let k=Math.min(ant.length,at.length);while(k>0&&ant.slice(0,k).join(",")!==at.slice(-k).join(","))k--;if(k>0){const nv=at.slice(0,at.length-k).reverse();if(nv.length)fetch(SRV+"/api/spins",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tableId:MESA,mode:"NEW_ORDERED",numbers:nv})});ant=at;}},300);});window.__rouletteObserver.observe(el,{childList:true,subtree:true,characterData:true});return "Auto-Feed conectado! Barra monitorada ("+ant.length+" giros)";}return "Tentativa de captura enviada ao Render.";})()`;

const html = [
"<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>",
"<meta name='viewport' content='width=device-width, initial-scale=1'>",
"<title>ROULETTE CONTROL</title>",
"<style>",
":root{--bg:#0b0c10;--card:#15171e;--green:#00e676;--red:#ff3d00;--gold:#ffd600;--text:#f5f5f5;--border:#282c37}",
"body{background:var(--bg);color:var(--text);font-family:Arial,sans-serif;padding:10px;margin:0}",
"h2{color:var(--green);margin:5px 0 10px 0;text-align:center;font-size:20px}",
".grid{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:10px}",
"@media(min-width:768px){.grid{grid-template-columns:1fr 1fr}}",
".card{background:var(--card);padding:12px;border-radius:10px;border:1px solid var(--border);margin-bottom:10px}",
"input,select,textarea{width:100%;padding:9px;background:#0e1015;color:#fff;border:1px solid #383d4c;border-radius:6px;box-sizing:border-box;margin-top:4px;font-size:14px}",
"button{width:100%;padding:10px;background:var(--green);color:#000;font-weight:bold;border:none;border-radius:6px;font-size:14px;cursor:pointer;margin-top:8px}",
".table-wrapper{overflow-x:auto;margin-top:8px;border-radius:8px;border:1px solid var(--border)}",
"table{width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap}",
"th,td{border-bottom:1px solid #222530;padding:10px 8px;text-align:center}",
"th{background:#07080a;color:#fff;border-bottom:2px solid var(--red);font-size:12px}",
"tr:nth-child(even){background:#12141a}",
".badge{padding:4px 8px;border-radius:4px;font-weight:bold;font-size:11px}",
".ativo{background:rgba(0,230,118,0.18);color:var(--green);border:1px solid var(--green)}",
".alerta{background:rgba(255,214,0,0.18);color:var(--gold);border:1px solid var(--gold)}",
".normal{color:#888}",
".col-alvo{background:rgba(0,230,118,0.08);font-weight:bold;color:var(--green);font-size:14px}",
"</style></head><body>",
"<h2>🎯 ROULETTE CONTROL</h2>",
"<div class='grid'>",
"<div class='card'>",
"<b style='color:var(--green)'>1️⃣ Selecionar Mesa & Sessão Automática</b>",
"<label style='font-size:11px;color:#aaa;display:block;margin-top:6px'>Mesa Ativa (Ao selecionar, busca os 500 giros):</label>",
"<select id='mesaSelect' onchange='selecionarMesa()'>",
"<option value='237'>🇧🇷 Roleta Brasileira (rwbrzportrwa16rg)</option>",
"<option value='204'>⚡ Mega Roulette (204)</option>",
"<option value='225'>🏎️ Auto-Roulette (225)</option>",
"</select>",
"<label style='font-size:11px;color:#aaa;display:block;margin-top:8px'>JSESSIONID ou Link statisticHistory (Para o Render coletar sozinho):</label>",
"<input id='inputSessao' placeholder='Cole o JSESSIONID ou link da sessão aqui...'>",
"<button onclick='conectarSessao()'>ATIVAR COLETA 100% AUTOMÁTICA</button>",
"</div>",
"<div class='card'>",
"<b style='color:var(--gold)'>2️⃣ Parâmetros do Radar (X-1 | X | X+1)</b>",
"<div style='display:flex;gap:8px;margin-top:8px'>",
"<div style='flex:1'><label style='font-size:11px;color:#aaa'>Saídas Alvo (X)</label><input type='number' id='maxSaidas' value='" + config.maxSaidas + "' onchange='salvarConfig()'></div>",
"<div style='flex:1'><label style='font-size:11px;color:#aaa'>Janela Mínima</label><input type='number' id='janelaAlvo' value='" + config.janelaAlvo + "' onchange='salvarConfig()'></div>",
"</div>",
"<div style='display:flex;gap:8px;margin-top:8px'>",
"<div style='flex:1'><label style='font-size:11px;color:#aaa'>Pré-Alerta</label><input type='number' id='avisoAntecipado' value='" + config.avisoAntecipado + "' onchange='salvarConfig()'></div>",
"<div style='flex:1'><label style='font-size:11px;color:#aaa'>Vizinhos</label><input type='number' id='tamConjunto' value='" + config.tamConjunto + "' onchange='salvarConfig()'></div>",
"</div>",
"<details style='margin-top:10px;font-size:12px;color:#ccc'><summary style='cursor:pointer;color:var(--green)'>➕ Alimentar Manual / Cadastrar Nova Mesa</summary>",
"<textarea id='htmlBox' rows='2' placeholder='Cole HTML de 500 giros, barra ou 1 número...'></textarea>",
"<button onclick='enviarManual()' style='padding:7px;margin-top:4px'>Enviar Dados Manuais</button>",
"</details>",
"</div></div>",
"<div class='card'>",
"<div style='display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px'>",
"<b style='font-size:15px'>📡 Radar em Tempo Real</b>",
"<div style='display:flex;gap:6px'>",
"<select id='filtroMesa' onchange='renderizarTabela()' style='width:auto;padding:5px'>",
"<option value='todas'>Todas as Mesas</option>",
"<option value='237'>🇧🇷 Brasil</option>",
"<option value='204'>⚡ Mega</option>",
"<option value='225'>🏎️ Auto</option>",
"</select>",
"<select id='filtroRadar' onchange='renderizarTabela()' style='width:auto;padding:5px'>",
"<option value='todos'>Todos (37)</option>",
"<option value='top10'>Top 10 Atraso</option>",
"<option value='gatilho'>Só Gatilhos 🔥</option>",
"</select></div></div>",
"<div style='font-size:12px;color:var(--green);margin:8px 0' id='lblConexoes'>Verificando conexões...</div>",
"<div class='table-wrapper'>",
"<table><thead><tr>",
"<th>Roleta</th><th>ID</th><th>Conjunto</th>",
"<th>Saída <span id='hdr-x-1'>9</span></th>",
"<th class='col-alvo'>Saída <span id='hdr-x'>10</span></th>",
"<th>Saída <span id='hdr-x-mais-1'>11</span></th>",
"<th>Status</th>",
"</tr></thead>",
"<tbody id='radarBody'><tr><td colspan='7'>Aguardando giros...</td></tr></tbody>",
"</table></div></div>",
"<div class='card'>",
"<b style='color:var(--green)'>⚡ Comando Único Caçador Automático (Console / Favorito)</b>",
"<p style='font-size:12px;color:#aaa;margin:4px 0'>Se colar no Console da roleta aberta, ele captura o JSESSIONID sozinho para o Render, puxa os 500 giros e monitora giro a giro:</p>",
"<textarea rows='2' readonly style='font-family:monospace;font-size:11px;color:var(--gold)' onclick='this.select()'>" + comandoAuto + "</textarea>",
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
"if(!lista.length){tbody.innerHTML='<tr><td colspan=\"7\">Sem dados carregados para esta mesa.</td></tr>';return;}",
"lista.forEach(c=>{",
"let tr=document.createElement('tr');",
"tr.innerHTML=`<td><b>${c.roleta}</b></td><td><b>${c.id}</b></td><td style='text-align:left'>${c.conjunto}</td><td>${c.x_menos_1}</td><td class='col-alvo'>${c.x}</td><td>${c.x_mais_1}</td><td><span class='badge ${c.badge}'>${c.status}</span></td>`;",
"tbody.appendChild(tr);",
"});",
"}",
"async function selecionarMesa(){",
"let mesa=document.getElementById('mesaSelect').value;",
"await fetch('/api/selecionar-mesa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tableId:mesa})});",
"carregarRadar();",
"}",
"async function conectarSessao(){",
"let mesa=document.getElementById('mesaSelect').value;",
"let val=document.getElementById('inputSessao').value.trim();",
"if(!val)return alert('Cole o JSESSIONID ou link da sessão!');",
"let r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tableId:mesa,url:val})});",
"let j=await r.json();",
"alert('Status: '+(j.statusConexao||j.message));",
"carregarRadar();",
"}",
"async function enviarManual(){",
"let mesa=document.getElementById('mesaSelect').value;",
"let txt=document.getElementById('htmlBox').value.trim();",
"if(!txt)return;",
"let r=await fetch('/api/spins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tableId:mesa,html:txt})});",
"let j=await r.json();",
"if(j.status==='error')alert(j.message);",
"document.getElementById('htmlBox').value='';",
"carregarRadar();",
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
