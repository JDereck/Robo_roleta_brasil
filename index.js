const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbyyWyc_z7InWOGkC4wIJ85fqPnlmsyuu9OeKHKFypcvgz_nw64I7JwcQqPrSwBA1eyh/exec";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "9091680827:AAER8mF6-T5gJ8iL5VGK4EbCFCH4QY7lazc";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "824181525";

// O SETOR ALVO DEFINITIVO DO PROJETO EQUILIBRIUM (6 números)
const SETOR_EQUILIBRIUM = [0, 32, 15, 19, 4, 21];

const CATALOGO_MESAS = {
    "237": { id: "237", nome: "🇧🇷 Roleta Brasileira", ativa: true }
};

// CONFIGURAÇÃO DOS 5 GATILHOS OFICIAIS DA FASE 2A
const config = {
    statusRobo: "ATIVO",
    limiteHistorico: 500, // Armazena até 500 giros na memória
    gatilhos: [
        { nome: "G7",  janela: 40, alvoSaidas: 7 },
        { nome: "G8",  janela: 44, alvoSaidas: 8 },
        { nome: "G9",  janela: 54, alvoSaidas: 9 },
        { nome: "G10", janela: 57, alvoSaidas: 10 },
        { nome: "G11", janela: 67, alvoSaidas: 11 }
    ]
};

const estadoMesas = {
    "237": {
        id: "237",
        nome: "🇧🇷 Roleta Brasileira",
        historico: [],
        contador: 0,
        carregado: false,
        statusConexao: "🟢 Aguardando coleta automática...",
        radar: []
    }
};

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
// MOTOR ESTATÍSTICO & GATILHOS (G7 a G11)
// =====================================================

function avaliarGatilhosSetor(girosRecentes) {
    let resultadosGatilhos = [];
    let gatilhoAtivoGeral = false;

    config.gatilhos.forEach(g => {
        if (girosRecentes.length < g.janela) {
            resultadosGatilhos.push({ nome: g.nome, janela: g.janela, atingido: false, girosGastos: 0, saidasContadas: 0, alvoSaidas: g.alvoSaidas });
            return;
        }

        let contSaidas = 0;
        let jogadasJanela = 0;

        for (let i = 0; i < girosRecentes.length; i++) {
            if (SETOR_EQUILIBRIUM.includes(girosRecentes[i])) {
                contSaidas++;
            }
            jogadasJanela++;
            if (contSaidas === g.alvoSaidas) {
                break;
            }
        }

        let atingido = (contSaidas >= g.alvoSaidas && jogadasJanela <= g.janela);
        if (atingido) gatilhoAtivoGeral = true;

        resultadosGatilhos.push({
            nome: g.nome,
            janela: g.janela,
            alvoSaidas: g.alvoSaidas,
            girosGastos: jogadasJanela,
            saidasContadas: contSaidas,
            atingido: atingido
        });
    });

    return { resultadosGatilhos, gatilhoAtivoGeral };
}

function calcularRadarMesa(idMesa, ultimoNumeroSorteado) {
    const mesa = estadoMesas[idMesa];
    if (!mesa || !mesa.historico.length) return { radar: [], alertaDisparado: false };

    const girosRecentes = mesa.historico.map(h => h.number);
    const { resultadosGatilhos, gatilhoAtivoGeral } = avaliarGatilhosSetor(girosRecentes);

    if (gatilhoAtivoGeral && config.statusRobo === "ATIVO" && ultimoNumeroSorteado !== undefined) {
        let ativadosStr = resultadosGatilhos.filter(g => g.atingido).map(g => g.nome).join(", ");
        enviarTelegram(`🚨 *EQUILIBRIUM - SINAL DETECTADO!*\n🎯 Mesa: *${mesa.nome}*\n🔥 Gatilhos Ativos: *${ativadosStr}*\n📍 Setor Alvo: \`[0, 32, 15, 19, 4, 21]\`\n🎲 Último número: *${ultimoNumeroSorteado}*`);
    }

    mesa.radar = {
        setorAlvo: SETOR_EQUILIBRIUM.join(", "),
        totalGirosAnalisados: girosRecentes.length,
        gatilhos: resultadosGatilhos,
        statusAlerta: gatilhoAtivoGeral ? "🔥 GATILHO ATIVO" : "MONITORANDO"
    };

    return mesa.radar;
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
// PROCESSAMENTO DE ENTRADAS (SPINS)
// =====================================================

function extrairNumeros(entrada) {
    if (Array.isArray(entrada)) {
        return entrada.map(x => Number(String(x).trim())).filter(n => Number.isInteger(n) && n >= 0 && n <= 36);
    }
    if (!entrada || typeof entrada !== "string") return [];
    return entrada
        .split(/[\s,;]+/)
        .map(x => x.trim())
        .filter(x => /^(0|[1-9]|[12][0-9]|3[0-6])$/.test(x))
        .map(Number);
}

function processarNovosGiros(idMesa, numerosArray) {
    const mesa = estadoMesas[idMesa];
    if (!mesa) return;

    const agora = new Date().toISOString();

    if (!mesa.carregado || numerosArray.length >= 100) {
        const base = numerosArray.slice(0, config.limiteHistorico);
        mesa.historico = [];
        mesa.contador = 0;

        for (const num of base.slice().reverse()) {
            mesa.contador++;
            const gId = idMesa + "_G_" + String(mesa.contador).padStart(6, "0");
            mesa.historico.unshift({
                tableId: idMesa,
                gameId: gId,
                number: num,
                rawResult: String(num),
                timestamp: agora,
                origem: "web_sync"
            });
        }

        mesa.carregado = true;
        mesa.statusConexao = "🟢 Conectado (Automático " + mesa.historico.length + " giros | Últ: " + mesa.historico[0].number + ")";
        sincronizarPlanilha("SYNC_BATCH", idMesa, { spins: mesa.historico });
        calcularRadarMesa(idMesa);
        return { modo: "CARGA_COMPLETA", total: mesa.historico.length };
    }

    const inseridos = [];
    for (const num of numerosArray) {
        if (!Number.isInteger(num) || num < 0 || num > 36) continue;
        mesa.contador++;
        const gId = idMesa + "_G_" + String(mesa.contador).padStart(6, "0");
        const giro = {
            tableId: idMesa,
            gameId: gId,
            number: num,
            rawResult: String(num),
            timestamp: agora,
            origem: "ao_vivo"
        };
        mesa.historico.unshift(giro);
        inseridos.push(giro);
        sincronizarPlanilha("NEW_SPIN", idMesa, { spin: giro });
        calcularRadarMesa(idMesa, num);
    }

    mesa.historico = mesa.historico.slice(0, config.limiteHistorico);
    if (inseridos.length > 0) {
        mesa.statusConexao = "🟢 Ao Vivo (Automático " + mesa.historico.length + " giros | Últ: " + mesa.historico[0].number + ")";
    }
    return { modo: "AO_VIVO", inseridos: inseridos.length };
}

// =====================================================
// COLETOR AUTOMÁTICO EM SEGUNDO PLANO (BACKGROUND SCRAPER)
// =====================================================
let ultimaAssinaturaColetor = "";

async function coletarResultadosAutomaticamente() {
    try {
        // Alvo de extração
        const urlAlvo = "https://gamblingcounting.com/pt-BR/lightning-roulette";
        const response = await axios.get(urlAlvo, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const numerosEncontrados = [];

        // Varre elementos que possam conter os números na página
        $('*').each((i, el) => {
            const texto = $(el).text().trim();
            if (/^(0|[1-9]|[12][0-9]|3[0-6])$/.test(texto)) {
                numerosEncontrados.push(Number(texto));
            }
        });

        const unicos = [...new Set(numerosEncontrados)].slice(0, 30);
        if (unicos.length === 0) return;

        const assinaturaAtual = unicos.join(",");
        if (assinaturaAtual !== ultimaAssinaturaColetor) {
            processarNovosGiros("237", unicos);
            ultimaAssinaturaColetor = assinaturaAtual;
            console.log("🔄 [COLETOR AUTOMÁTICO] Novos giros obtidos da nuvem:", unicos.slice(0, 5));
        }
    } catch (e) {
        console.error("⚠️ [COLETOR AUTOMÁTICO] Erro ao buscar dados da página:", e.message);
    }
}

// Roda o coletor automático a cada 10 segundos na nuvem do Render
setInterval(coletarResultadosAutomaticamente, 10000);

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

app.post("/api/spins", (req, res) => {
    try {
        const idMesa = String(req.body.tableId || "237").trim();
        const numeros = extrairNumeros(req.body.numbers || req.body.text || req.body.html);
        if (!numeros.length) return res.status(400).json({ status: "error", message: "Nenhum número válido." });

        const resultado = processarNovosGiros(idMesa, numeros);
        return res.json({ status: "success", resultado });
    } catch (err) {
        return res.status(400).json({ status: "error", message: err.message });
    }
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
    calcularRadarMesa("237");
    res.json({ status: "success", config });
});

// NOVA ROTA: Retorna o histórico de giros (últimos 100)
app.get("/api/historico", (req, res) => {
    const mesa = estadoMesas["237"];
    res.json({
        status: "success",
        historico: mesa ? mesa.historico.slice(0, 100) : []
    });
});

// =====================================================
// PAINEL VIP EQUILIBRIUM COM HISTÓRICO (ROTA PRINCIPAL /)
// =====================================================

app.get("/", (req, res) => {
    const html = [
        "<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>",
        "<meta name='viewport' content='width=device-width, initial-scale=1'>",
        "<title>EQUILIBRIUM CONTROL</title>",
        "<style>",
        ":root{--bg:#0b0c10;--card:#15171e;--green:#00e676;--red:#ff3d00;--gold:#ffd600;--text:#f5f5f5;--border:#282c37}",
        "body{background:var(--bg);color:var(--text);font-family:Arial,sans-serif;padding:15px;margin:0}",
        "h2{color:var(--green);margin:5px 0 15px 0;text-align:center}",
        ".card{background:var(--card);padding:15px;border-radius:10px;border:1px solid var(--border);margin-bottom:15px}",
        "input,select,textarea{width:100%;padding:10px;background:#0e1015;color:#fff;border:1px solid #383d4c;border-radius:6px;box-sizing:border-box;margin-top:5px}",
        "button{width:100%;padding:12px;background:var(--green);color:#000;font-weight:bold;border:none;border-radius:6px;cursor:pointer;margin-top:10px}",
        ".badge{padding:6px 12px;border-radius:6px;font-weight:bold;display:inline-block;margin-top:10px}",
        ".ativo{background:rgba(0,230,118,0.2);color:var(--green);border:1px solid var(--green)}",
        ".normal{background:rgba(255,255,255,0.05);color:#aaa;border:1px solid #444}",
        "table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}",
        "th,td{border-bottom:1px solid #282c37;padding:10px;text-align:center}",
        "th{background:#07080a;color:#fff}",
        ".bola-num{display:inline-block;width:28px;height:28px;line-height:28px;border-radius:50%;background:#222;color:#fff;font-weight:bold;text-align:center;border:1px solid #444}",
        "</style></head><body>",
        "<h2>🎯 PROJETO EQUILIBRIUM - PAINEL DE CONTROLE</h2>",
        
        "<div class='card'>",
        "<b style='color:var(--green)'>⚙️ Status do Robô</b>",
        "<select id='statusRobo' onchange='salvarConfig()'>",
        "<option value='ATIVO'>ATIVO (Disparando Alertas)</option>",
        "<option value='PAUSADO'>PAUSADO</option>",
        "</select>",
        "<div style='font-size:13px;color:var(--green);margin-top:10px;font-weight:bold' id='lblConexoes'>Aguardando dados...</div>",
        "</div>",
        
        "<div class='card'>",
        "<b style='color:var(--gold)'>📥 Inserir Giros Manuais (Teste)</b>",
        "<textarea id='txtManual' rows='2' placeholder='Ex: 0, 32, 15, 19, 4, 21'></textarea>",
        "<button onclick='enviarManual()'>ENVIAR GIROS</button>",
        "</div>",
        
        "<div class='card'>",
        "<b style='font-size:16px'>📊 Monitoramento dos Gatilhos (Setor: 0, 32, 15, 19, 4, 21)</b>",
        "<div id='statusAlertaGeral' class='badge normal' style='width:100%;text-align:center'>Aguardando histórico...</div>",
        "<table><thead><tr><th>Gatilho</th><th>Janela</th><th>Alvo</th><th>Contadas</th><th>Status</th></tr></thead>",
        "<tbody id='gatilhosBody'><tr><td colspan='5'>Sem dados...</td></tr></tbody>",
        "</table></div>",
        
        "<div class='card'>",
        "<b style='font-size:16px'>📜 Últimos Resultados Coletados (Até 100 giros)</b>",
        "<div style='max-height: 250px; overflow-y: auto;'>",
        "<table><thead><tr><th>#</th><th>Número</th><th>Origem</th><th>Horário</th></tr></thead>",
        "<tbody id='historicoBody'><tr><td colspan='4'>Aguardando histórico...</td></tr></tbody>",
        "</table></div></div>",
        
        "<script>",
        "async function carregarRadar(){",
        "try{",
        "let r=await fetch('/api/radar-todas');",
        "let j=await r.json();",
        "document.getElementById('lblConexoes').textContent=j.conexoes;",
        "if(j.config.statusRobo)document.getElementById('statusRobo').value=j.config.statusRobo;",
        "let radar=j.radar;",
        "let badgeEl=document.getElementById('statusAlertaGeral');",
        "badgeEl.textContent=radar.statusAlerta;",
        "badgeEl.className='badge '+(radar.statusAlerta.includes('ATIVO')?'ativo':'normal');",
        
        "let tbody=document.getElementById('gatilhosBody');",
        "tbody.innerHTML='';",
        "radar.gatilhos.forEach(g=>{",
        "let tr=document.createElement('tr');",
        "let alvo = g.alvoSaidas || (g.nome==='G7'?7:g.nome==='G8'?8:g.nome==='G9'?9:g.nome==='G10'?10:11);",
        "tr.innerHTML=`<td><b>${g.nome}</b></td><td>${g.janela}</td><td>${alvo}</td><td><b>${g.saidasContadas}</b></td><td><span class='badge ${g.atingido?'ativo':'normal'}'>${g.atingido?'🔥 ATIVO':'Aguardando'}</span></td>`;",
        "tbody.appendChild(tr);",
        "});",
        
        "let hr=await fetch('/api/historico');",
        "let hj=await hr.json();",
        "let hbody=document.getElementById('historicoBody');",
        "hbody.innerHTML='';",
        "hj.historico.forEach((item, index)=>{",
        "let tr=document.createElement('tr');",
        "let hora = new Date(item.timestamp).toLocaleTimeString();",
        "tr.innerHTML=`<td>${index+1}</td><td><span class='bola-num'>${item.number}</span></td><td>${item.origem}</td><td>${hora}</td>`;",
        "hbody.appendChild(tr);",
        "});",
        
        "}catch(e){}",
        "}",
        
        "async function enviarManual(){",
        "let txt=document.getElementById('txtManual').value.trim();",
        "if(!txt)return;",
        "await fetch('/api/spins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tableId:'237',numbers:txt})});",
        "document.getElementById('txtManual').value='';",
        "carregarRadar();",
        "}",
        
        "async function salvarConfig(){",
        "let payload={statusRobo:document.getElementById('statusRobo').value};",
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
    console.log("EQUILIBRIUM CONTROL rodando na porta " + PORT);
});
