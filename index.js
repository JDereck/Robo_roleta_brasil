const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbyyWyc_z7InWOGkC4wIJ85fqPnlmsyuu9OeKHKFypcvgz_nw64I7JwcQqPrSwBA1eyh/exec";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "9091680827:AAER8mF6-T5gJ8iL5VGK4EbCFCH4QY7lazc";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "824181525";

const CILINDRO = [
0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const CATALOGO_MESAS = {
"237": { id: "237", tableIdApi: "rwbrzportrwa16rg", nome: "🇧🇷 Roleta Brasileira", ativa: true }
};

const config = {
statusRobo: "ATIVO",
janelaAlvo: 100,
avisoAntecipado: 95,
maxSaidas: 10,
tamConjunto: 6,
maxEntradas: 3,
limiteHistorico: 500,
intervaloColeta: 5000
};

const estadoMesas = {
"237": {
id: "237",
nome: "🇧🇷 Roleta Brasileira",
historico: [],
ultimoGameId: null,
contador: 0,
carregado: false,
statusConexao: "Iniciando motor autônomo...",
radar: []
}
};

function obterConjunto(indiceInicial, tamanho = config.tamConjunto) {
const resultado = [];
for (let i = 0; i < tamanho; i++) {
resultado.push(CILINDRO[(indiceInicial + i) % CILINDRO.length]);
}
return resultado;
}

// =====================================================
// TELEGRAM COMUNICADOR
// =====================================================

async function enviarTelegram(texto) {
if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
try {
await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN.trim()}/sendMessage`, {
chat_id: String(TELEGRAM_CHAT_ID).trim(),
text: texto,
parse_mode: "Markdown"
}, { timeout: 10000 });
} catch (e) {
console.error("Erro Telegram:", e.message);
}
}

// =====================================================
// MOTOR ESTATÍSTICO & GATILHOS
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

function calcularRadarMesa(idMesa, ultimoNumeroSorteado) {
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
if (config.statusRobo === "ATIVO" && ultimoNumeroSorteado !== undefined) {
enviarTelegram(`🚨 *GATILHO ATIVO NO CONJUNTO (${idConj})!*\n👉 Vizinhos: *${strConjunto}*\n📊 Atraso atual: *${atraso_X} giros*`);
}
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
// SINCRONIZAÇÃO GOOGLE SHEETS
// =====================================================

async function sincronizarPlanilha(type, tableId, payload) {
if (!GAS_WEBHOOK_URL) return;
try {
await axios.post(GAS_WEBHOOK_URL, { type, tableId, ...payload }, { timeout: 10000 });
} catch (e) {}
}

// =====================================================
// COLETOR AUTOMÁTICO NATIVO (SEM NAVEGADOR)
// =====================================================

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

async function cicloColetaAutonoma() {
const mesa = estadoMesas["237"];
const cadastro = CATALOGO_MESAS["237"];
if (!cadastro || !cadastro.ativa) return;

try {
// Acesso direto à estatística pública da Pragmatic Play
const url = `https://games.pragmaticplaylive.net/api/ui/statisticHistory?tableId=${cadastro.tableIdApi}&numberOfGames=500`;
const res = await axios.get(url, {
timeout: 10000,
headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
});

const lista = localizarArrayDeJogos(res.data);
if (!lista || !lista.length) return;

const novosJogos = lista.map(item => {
const gId = item.gameId ?? item.id ?? item.roundId;
const bruto = item.gameResult ?? item.result ?? item.number;
if (gId === undefined || bruto === undefined) return null;
const num = Number(String(bruto).match(/\d+/)?.[0] ?? bruto);
if (!Number.isInteger(num) || num < 0 || num > 36) return null;
return {
tableId: "237",
gameId: String(gId),
number: num,
rawResult: String(bruto),
timestamp: item.timestamp || new Date().toISOString(),
origem: "render_autonomo"
};
}).filter(Boolean);

if (!novosJogos.length) return;

if (!mesa.carregado500 || !mesa.ultimoGameId) {
mesa.historico = novosJogos.slice(0, config.limiteHistorico);
mesa.ultimoGameId = mesa.historico[0].gameId;
mesa.carregado500 = true;
mesa.statusConexao = "🟢 100% Autônomo (" + mesa.historico.length + " giros)";
sincronizarPlanilha("SYNC_BATCH", "237", { spins: mesa.historico });
calcularRadarMesa("237");
return;
}

const idx = novosJogos.findIndex(j => j.gameId === mesa.ultimoGameId);
if (idx === -1) {
mesa.historico = novosJogos.slice(0, config.limiteHistorico);
mesa.ultimoGameId = mesa.historico[0].gameId;
sincronizarPlanilha("SYNC_BATCH", "237", { spins: mesa.historico });
calcularRadarMesa("237");
return;
}

const recentes = novosJogos.slice(0, idx).reverse();
for (const giro of recentes) {
if (!mesa.historico.some(r => r.gameId === giro.gameId)) {
mesa.historico.unshift(giro);
sincronizarPlanilha("NEW_SPIN", "237", { spin: giro });
calcularRadarMesa("237", giro.number);
}
}
mesa.historico = mesa.historico.slice(0, config.limiteHistorico);
if (recentes.length > 0) mesa.ultimoGameId = mesa.historico[0].gameId;
mesa.statusConexao = "🟢 100% Autônomo (Último: " + (mesa.historico[0]?.number ?? "-") + ")";
} catch (e) {
mesa.statusConexao = "🟡 Conectando à API... (" + e.message.slice(0, 30) + ")";
}
}

setInterval(cicloColetaAutonoma, config.intervaloColeta);

// =====================================================
// ROTAS API
// =====================================================

app.use((req, res, next) => {
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type");
if (req.method === "OPTIONS") return res.sendStatus(200);
next();
});

app.get("/api/radar-todas", (req, res) => {
const radar = calcularRadarMesa("237");
const m = estadoMesas["237"];
res.json({
status: "success",
conexoes: m.statusConexao,
config,
radar
});
});

app.post("/api/config", (req, res) => {
const b = req.body || {};
if (b.statusRobo) config.statusRobo = String(b.statusRobo);
if (b.janelaAlvo) config.janelaAlvo = Number(b.janelaAlvo);
if (b.avisoAntecipado) config.avisoAntecipado = Number(b.avisoAntecipado);
if (b.maxSaidas) config.maxSaidas = Number(b.maxSaidas);
if (b.tamConjunto) config.tamConjunto = Number(b.tamConjunto);

calcularRadarMesa("237");
res.json({ status: "success", config });
});

// =====================================================
// PAINEL VIP RESPONSIVO
// =====================================================

app.get("/", (req, res) => {
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
"input,select{width:100%;padding:9px;background:#0e1015;color:#fff;border:1px solid #383d4c;border-radius:6px;box-sizing:border-box;margin-top:4px;font-size:14px}",
"button{width:100%;padding:11px;background:var(--green);color:#000;font-weight:bold;border:none;border-radius:6px;font-size:14px;cursor:pointer;margin-top:8px}",
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
"<h2>🎯 ROULETTE CONTROL (24/7)</h2>",
"<div class='grid'>",
"<div class='card'>",
"<b style='color:var(--green)'>⚙️ Configurações & Telegram em Tempo Real</b>",
"<label style='font-size:11px;color:#aaa;display:block;margin-top:6px'>Status do Robô / Telegram:</label>",
"<select id='statusRobo' onchange='salvarConfig()'>",
"<option value='ATIVO'>ATIVO (Disparando Alertas)</option>",
"<option value='PAUSADO'>PAUSADO</option>",
"</select>",
"<div style='display:flex;gap:8px;margin-top:8px'>",
"<div style='flex:1'><label style='font-size:11px;color:#aaa'>Saídas Alvo (X)</label><input type='number' id='maxSaidas' value='" + config.maxSaidas + "' onchange='salvarConfig()'></div>",
"<div style='flex:1'><label style='font-size:11px;color:#aaa'>Janela Mínima</label><input type='number' id='janelaAlvo' value='" + config.janelaAlvo + "' onchange='salvarConfig()'></div>",
"</div>",
"<div style='display:flex;gap:8px;margin-top:8px'>",
"<div style='flex:1'><label style='font-size:11px;color:#aaa'>Pré-Alerta</label><input type='number' id='avisoAntecipado' value='" + config.avisoAntecipado + "' onchange='salvarConfig()'></div>",
"<div style='flex:1'><label style='font-size:11px;color:#aaa'>Vizinhos</label><input type='number' id='tamConjunto' value='" + config.tamConjunto + "' onchange='salvarConfig()'></div>",
"</div></div>",
"<div class='card'>",
"<b style='color:var(--gold)'>📡 Radar Automático 24/7</b>",
"<p style='font-size:12px;color:#aaa;margin:6px 0'>O servidor Render puxa a roleta da Pragmatic sozinho. Nenhum navegador precisa ficar aberto.</p>",
"<div style='font-size:13px;color:var(--green);margin-top:10px;font-weight:bold' id='lblConexoes'>Iniciando...</div>",
"<button onclick='carregarRadar()' style='background:#333;color:#fff'>Atualizar Agora</button>",
"</div></div>",
"<div class='card'>",
"<div style='display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px'>",
"<b style='font-size:15px'>📡 Tabela de Conjuntos (X-1 | X | X+1)</b>",
"<select id='filtroRadar' onchange='renderizarTabela()' style='width:auto;padding:5px'>",
"<option value='todos'>Todos (37)</option>",
"<option value='top10'>Top 10 Atraso</option>",
"<option value='gatilho'>Só Gatilhos 🔥</option>",
"</select></div>",
"<div class='table-wrapper'>",
"<table><thead><tr>",
"<th>Roleta</th><th>ID</th><th>Conjunto</th>",
"<th>Saída <span id='hdr-x-1'>9</span></th>",
"<th class='col-alvo'>Saída <span id='hdr-x'>10</span></th>",
"<th>Saída <span id='hdr-x-mais-1'>11</span></th>",
"<th>Status</th>",
"</tr></thead>",
"<tbody id='radarBody'><tr><td colspan='7'>Buscando dados no servidor...</td></tr></tbody>",
"</table></div></div>",
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
"if(j.config.statusRobo)document.getElementById('statusRobo').value=j.config.statusRobo;",
"renderizarTabela();",
"}catch(e){}",
"}",
"function renderizarTabela(){",
"if(!dadosGlobais)return;",
"let tbody=document.getElementById('radarBody');",
"tbody.innerHTML='';",
"let fStatus=document.getElementById('filtroRadar').value;",
"let lista=[...dadosGlobais.radar];",
"if(fStatus==='gatilho')lista=lista.filter(c=>c.status.includes('GATILHO')||c.status.includes('FALTA')||c.status.includes('PRÉ'));",
"if(fStatus==='top10')lista=lista.slice(0,10);",
"if(!lista.length){tbody.innerHTML='<tr><td colspan=\"7\">Nenhum conjunto para este filtro.</td></tr>';return;}",
"lista.forEach(c=>{",
"let tr=document.createElement('tr');",
"tr.innerHTML=`<td><b>${c.roleta}</b></td><td><b>${c.id}</b></td><td style='text-align:left'>${c.conjunto}</td><td>${c.x_menos_1}</td><td class='col-alvo'>${c.x}</td><td>${c.x_mais_1}</td><td><span class='badge ${c.badge}'>${c.status}</span></td>`;",
"tbody.appendChild(tr);",
"});",
"}",
"async function salvarConfig(){",
"let payload={",
"statusRobo:document.getElementById('statusRobo').value,",
"janelaAlvo:document.getElementById('janelaAlvo').value,",
"maxSaidas:document.getElementById('maxSaidas').value,",
"avisoAntecipado:document.getElementById('avisoAntecipado').value,",
"tamConjunto:document.getElementById('tamConjunto').value",
"};",
"await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});",
"carregarRadar();",
"}",
"carregarRadar();",
"setInterval(carregarRadar,5000);",
"</script></body></html>"
].join("");
res.send(html);
});

app.listen(PORT, () => {
console.log("ROULETTE CONTROL 24/7 rodando na porta " + PORT);
});
