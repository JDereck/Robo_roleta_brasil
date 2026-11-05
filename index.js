const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "9091680827:AAER8mF6-T5gJ8iL5VGK4EbCFCH4QY7lazc";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "824181525";

const CILINDRO = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

let config = {
  statusRobo: "ATIVO",
  janelaAlvo: 100,
  avisoAntecipado: 98,
  maxSaidas: 10,
  tamConjunto: 6,
  maxEntradas: 3,
  limiteHistorico: 500
};

let mesa = {
  historico: [],
  sinais: {},
  radar: [],
  ultimoGiroHora: "-"
};

let placarDia = { g1: 0, g2: 0, g3: 0, reds: 0, msgIdRelatorio: null };

async function enviarTelegram(texto) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN.trim()}/sendMessage`;
    const res = await axios.post(url, {
      chat_id: String(TELEGRAM_CHAT_ID).trim(),
      text: texto,
      parse_mode: "Markdown"
    }, { timeout: 8000 });
    return (res.data && res.data.ok) ? res.data.result.message_id : null;
  } catch (e) {
    return null;
  }
}

async function apagarTelegram(msgId) {
  if (!msgId) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN.trim()}/deleteMessage`;
    await axios.post(url, { chat_id: String(TELEGRAM_CHAT_ID).trim(), message_id: Number(msgId) }, { timeout: 6000 });
  } catch (e) {}
}

async function enviarRelatorioParcial() {
  if (placarDia.msgIdRelatorio) await apagarTelegram(placarDia.msgIdRelatorio);
  const totalGreens = placarDia.g1 + placarDia.g2 + placarDia.g3;
  const totalOp = totalGreens + placarDia.reds;
  const taxa = totalOp > 0 ? ((totalGreens / totalOp) * 100).toFixed(1) : "0.0";

  const txt =
    `📋 *PLACAR PARCIAL DO DIA*\n\n` +
    `✅ *Greens:* ${totalGreens} (G1:${placarDia.g1} | G2:${placarDia.g2} | G3:${placarDia.g3})\n` +
    `❌ *Reds:* ${placarDia.reds}\n` +
    `📈 *Assertividade:* ${taxa}%`;

  placarDia.msgIdRelatorio = await enviarTelegram(txt);
}

function obterConjunto(indiceInicial, tamanho) {
  const res = [];
  for (let i = 0; i < tamanho; i++) {
    res.push(CILINDRO[(indiceInicial + i) % CILINDRO.length]);
  }
  return res;
}

async function processarNovoGiro(novoNumero) {
  if (mesa.historico.length > 0 && mesa.historico[0] === novoNumero) return; // Evita duplicados seguidos

  mesa.historico.unshift(novoNumero);
  if (mesa.historico.length > config.limiteHistorico) mesa.historico.pop();
  mesa.ultimoGiroHora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Fortaleza' });

  const giros = mesa.historico;
  const novoRadar = [];

  for (let idx = 0; idx < 37; idx++) {
    const idConj = `C${idx + 1}`;
    const numerosConj = obterConjunto(idx, config.tamConjunto);
    const strConjunto = numerosConj.join('. ');

    let contSaidas = 0;
    let jogadasJanela = 0;

    for (let g = 0; g < giros.length; g++) {
      if (numerosConj.includes(giros[g])) {
        if (contSaidas === config.maxSaidas) break;
        contSaidas++;
      }
      jogadasJanela++;
    }

    const statsNumeros = numerosConj.map(num => {
      let ultimaSaida = -1;
      let vezes = 0;
      for (let g = 0; g < jogadasJanela; g++) {
        if (giros[g] === num) {
          vezes++;
          if (ultimaSaida === -1) ultimaSaida = g + 1;
        }
      }
      if (ultimaSaida === -1) {
        const pos = giros.indexOf(num);
        ultimaSaida = pos !== -1 ? pos + 1 : `${giros.length}+`;
      }
      return { num, ultimaSaida, vezes };
    });

    const resumoCurto = statsNumeros.map(s => `${s.num}(${s.ultimaSaida}g/${s.vezes}x)`).join('  ');
    let st = mesa.sinais[idConj] || { fase: 'LIVRE', msgId: null, tiro: 0 };
    const bateu = numerosConj.includes(novoNumero);

    if (config.statusRobo === 'ATIVO') {
      if (st.fase === 'ENTRADA') {
        if (bateu) {
          if (st.msgId) await apagarTelegram(st.msgId);
          await enviarTelegram(`✅ *GREEN NO CONJUNTO (${strConjunto})!*\n🎯 Sorteado: *${novoNumero}* (Entrada ${st.tiro}/${config.maxEntradas})`);
          if (st.tiro === 1) placarDia.g1++; else if (st.tiro === 2) placarDia.g2++; else placarDia.g3++;
          await enviarRelatorioParcial();
          st = { fase: 'COOLDOWN', msgId: null, tiro: 0 };
        } else {
          if (st.tiro >= config.maxEntradas) {
            if (st.msgId) await apagarTelegram(st.msgId);
            await enviarTelegram(`❌ *RED NO CONJUNTO (${strConjunto})*\nNão saiu nas ${config.maxEntradas} entradas.`);
            placarDia.reds++;
            await enviarRelatorioParcial();
            st = { fase: 'COOLDOWN', msgId: null, tiro: 0 };
          } else {
            st.tiro++;
          }
        }
      } else if (st.fase === 'COOLDOWN') {
        if (bateu || jogadasJanela < config.avisoAntecipado) st = { fase: 'LIVRE', msgId: null, tiro: 0 };
      } else if ((st.fase === 'ALERTA_1' || st.fase === 'ALERTA_2') && jogadasJanela < config.avisoAntecipado) {
        if (st.msgId) await apagarTelegram(st.msgId);
        st = { fase: 'LIVRE', msgId: null, tiro: 0 };
      } else {
        if (jogadasJanela >= config.janelaAlvo && contSaidas <= config.maxSaidas && st.fase !== 'ENTRADA') {
          if (st.msgId) await apagarTelegram(st.msgId);
          let tab = `Nº | Últ.Saída | Vezes\n`;
          statsNumeros.forEach(s => { tab += `${String(s.num).padEnd(2, ' ')} | ${String(s.ultimaSaida).padEnd(9, ' ')} | ${s.vezes}\n`; });
          const novoId = await enviarTelegram(`🚨 *JOGAR NO CONJUNTO:*\n👉 *${strConjunto}* (${contSaidas} saídas em ${jogadasJanela} giros)\n\`\`\`\n${tab}\`\`\``);
          st = { fase: 'ENTRADA', msgId: novoId, tiro: 1 };
        } else if (jogadasJanela === (config.janelaAlvo - 1) && contSaidas <= config.maxSaidas && st.fase !== 'ALERTA_2') {
          if (st.msgId) await apagarTelegram(st.msgId);
          const novoId = await enviarTelegram(`⏳ *ATENÇÃO - FALTA 1 JOGADA!*\nConjunto: *${strConjunto}*`);
          st = { fase: 'ALERTA_2', msgId: novoId, tiro: 0 };
        } else if (jogadasJanela === config.avisoAntecipado && contSaidas <= config.maxSaidas && st.fase === 'LIVRE') {
          const novoId = await enviarTelegram(`⚠️ *SE PREPARE!*\nConjunto: *${strConjunto}* se formando.`);
          st = { fase: 'ALERTA_1', msgId: novoId, tiro: 0 };
        }
      }
    }
    mesa.sinais[idConj] = st;
    let statusTxt = 'Normal', corStatus = '#888';
    if (st.fase === 'ENTRADA') { statusTxt = `🔥 ENTRADA (${st.tiro}/${config.maxEntradas})`; corStatus = '#00ff66'; }
    else if (st.fase === 'ALERTA_2') { statusTxt = '⏳ FALTA 1 GIRO'; corStatus = '#ffcc00'; }
    else if (st.fase === 'ALERTA_1') { statusTxt = '⚠️ PREPARAR'; corStatus = '#ff9900'; }
    novoRadar.push({ idConj, strConjunto, jogadasJanela, contSaidas, statusTxt, corStatus, resumoCurto });
  }
  mesa.radar = novoRadar;
}

app.get('/report', async (req, res) => {
  const num = parseInt(req.query.num, 10);
  if (!isNaN(num) && num >= 0 && num <= 36) await processarNovoGiro(num);
  res.json({ status: 'ok', num });
});

app.post('/api/config', (req, res) => {
  const b = req.body;
  if (b.janelaAlvo) config.janelaAlvo = Number(b.janelaAlvo);
  if (b.avisoAntecipado) config.avisoAntecipado = Number(b.avisoAntecipado);
  if (b.maxSaidas) config.maxSaidas = Number(b.maxSaidas);
  if (b.maxEntradas) config.maxEntradas = Number(b.maxEntradas);
  res.redirect('/');
});

app.post('/api/fechar-dia', async (req, res) => {
  const totalGreens = placarDia.g1 + placarDia.g2 + placarDia.g3;
  const totalOp = totalGreens + placarDia.reds;
  const taxa = totalOp > 0 ? ((totalGreens / totalOp) * 100).toFixed(1) + "%" : "0%";
  await enviarTelegram(`🏁 *FECHAMENTO DO DIA*\nGreens: ${totalGreens} | Reds: ${placarDia.reds} | Taxa: ${taxa}`);
  placarDia = { g1: 0, g2: 0, g3: 0, reds: 0, msgIdRelatorio: null };
  res.redirect('/');
});

app.get('/', (req, res) => {
  const totalGreens = placarDia.g1 + placarDia.g2 + placarDia.g3;
  const totalOp = totalGreens + placarDia.reds;
  const taxaHoje = totalOp > 0 ? ((totalGreens / totalOp) * 100).toFixed(1) : "0.0";

  const ultimos20Html = mesa.historico.slice(0, 20).map((n, i) => {
    const isRed = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(n);
    const bg = n === 0 ? '#00aa00' : (isRed ? '#cc0000' : '#222');
    const borda = i === 0 ? '2px solid #00ffcc' : '1px solid #555';
    return `<span style="display:inline-block; width:28px; height:28px; line-height:28px; text-align:center; border-radius:50%; background:${bg}; color:#fff; font-weight:bold; font-size:12px; margin:2px; border:${borda};">${n}</span>`;
  }).join('');

  const linhasRadarHtml = mesa.radar.map(r => `
    <tr style="border-bottom:1px solid #2a2a2a;">
      <td style="padding:8px; font-weight:bold; color:#00ffcc;">${r.idConj}</td>
      <td style="padding:8px; font-weight:bold;">${r.strConjunto}</td>
      <td style="padding:8px; text-align:center; font-weight:bold; color:#fff;">${r.jogadasJanela}</td>
      <td style="padding:8px; text-align:center;">${r.contSaidas}</td>
      <td style="padding:8px; text-align:center; font-weight:bold; color:${r.corStatus};">${r.statusTxt}</td>
      <td style="padding:8px; font-size:11px; color:#aaa; font-family:monospace;">${r.resumoCurto}</td>
    </tr>`).join('');

  res.send(`<!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Painel e Captura Automática</title>
    <style>
      body { background:#0d0d0d; color:#eee; font-family:Arial, sans-serif; margin:0; padding:15px; }
      .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap:15px; margin-bottom:15px; }
      .card { background:#161616; border:1px solid #2b2b2b; border-radius:10px; padding:14px; }
      input, select { background:#222; color:#fff; border:1px solid #444; padding:6px; border-radius:5px; }
      .btn { cursor:pointer; border:none; border-radius:6px; padding:8px 12px; font-weight:bold; color:#fff; }
      table { width:100%; border-collapse:collapse; background:#141414; border-radius:8px; font-size:13px; }
      th { background:#222; color:#00ffcc; padding:10px 8px; text-align:left; }
    </style>
    <script>
      // CAPTURADOR AUTOMÁTICO EMBUTIDO: Busca os dados da Pragmatic Play direto pela página se aberta na mesma sessão
      function iniciarCapturaAutomatica() {
        const statusEl = document.getElementById('status-captura');
        statusEl.innerText = "🟢 Captura Automática Ativa (Buscando a cada 4s)";
        statusEl.style.color = "#00ffcc";
        
        setInterval(async () => {
          try {
            // Tenta ler o histórico da Pragmatic Play se estiver carregado nas requisições da página
            const recursos = performance.getEntriesByType('resource').map(r => r.name);
            const urlStat = recursos.find(u => u.includes('statisticHistory'));
            if (urlStat) {
              const res = await fetch(urlStat);
              const data = await res.json();
              const lista = data.history || data.results || data.data;
              if (Array.isArray(lista) && lista.length > 0) {
                const ultimo = lista[0];
                const raw = String(ultimo.gameResult || ultimo.result || ultimo.number || "");
                const m = raw.match(/\\b([0-9]|[12][0-9]|3[0-6])\\b/);
                if (m) {
                  const num = parseInt(m[1], 10);
                  // Envia para o próprio servidor atualizar
                  fetch('/report?num=' + num);
                }
              }
            }
          } catch(e) {}
        }, 4000);
      }
      window.onload = iniciarCapturaAutomatica;
      // Atualiza a tela a cada 6 segundos para mostrar novos giros sem precisar dar F5
      setInterval(() => { location.reload(); }, 6000);
    </script>
  </head>
  <body>
    <h2 style="color:#00ffcc; margin-top:0;">🎯 Painel Web com Captura Automática</h2>
    <div id="status-captura" style="font-size:12px; color:#ffcc00; margin-bottom:10px; font-weight:bold;">A iniciar capturador...</div>
    
    <div class="grid">
      <div class="card">
        <h3>⚙️ Configurar Gatilhos</h3>
        <form action="/api/config" method="POST">
          <div style="font-size:12px; display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px;">
            <div>Janela Alvo: <input type="number" name="janelaAlvo" value="${config.janelaAlvo}" style="width:90%;"></div>
            <div>Pré-Alerta (-2): <input type="number" name="avisoAntecipado" value="${config.avisoAntecipado}" style="width:90%;"></div>
            <div>Máx Saídas: <input type="number" name="maxSaidas" value="${config.maxSaidas}" style="width:90%;"></div>
            <div>Tiros: <input type="number" name="maxEntradas" value="${config.maxEntradas}" style="width:90%;"></div>
          </div>
          <button type="submit" class="btn" style="width:100%; background:#00aa00;">💾 Salvar Configurações</button>
        </form>
      </div>
      <div class="card">
        <h3>📊 Placar do Dia</h3>
        <div style="display:flex; justify-content:space-between; margin-bottom:10px; font-size:13px;">
          <div>Greens: <b style="color:#00ff66;">${totalGreens}</b></div>
          <div>Reds: <b style="color:#ff4d4d;">${placarDia.reds}</b></div>
          <div>Assertividade: <b style="color:#00ccff;">${taxaHoje}%</b></div>
        </div>
        <form action="/api/fechar-dia" method="POST">
          <button type="submit" class="btn" style="width:100%; background:#cc7a00; font-size:11px;">🏁 Fechar Dia / Resetar Placar</button>
        </form>
      </div>
    </div>
    
    <div class="card" style="margin-bottom:15px;">
      <b>Histórico acumulado:</b> ${mesa.historico.length} giros gravados | Último giro às ${mesa.ultimoGiroHora}<br><br>
      <div style="background:#0a0a0a; padding:8px; border-radius:6px; border:1px solid #222;">
        ${ultimos20Html || '<span style="color:#666;">Aguardando o primeiro giro automático... Abra as estatísticas da roleta no cassino para sincronizar.</span>'}
      </div>
    </div>
    
    <div class="card">
      <h3>📡 Radar dos 37 Conjuntos</h3>
      <table>
        <thead><tr><th>ID</th><th>Conjunto</th><th>Jogadas</th><th>Saídas</th><th>Status</th><th>Detalhe</th></tr></thead>
        <tbody>${linhasRadarHtml || '<tr><td colspan="6" style="padding:15px; text-align:center; color:#666;">Aguardando os primeiros giros...</td></tr>'}</tbody>
      </table>
    </div>
  </body>
  </html>`);
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
