const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// Credenciais Telegram e Planilha (Resumo Diário)
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "9091680827:AAER8mF6-T5gJ8iL5VGK4EbCFCH4QY7lazc";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "824181525";
const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbzsD45UPV6mQAKLCzVnLCtdAGoG7AVzqwVLjB9y188fzBZc2PXqLz1I6Tbgyoopghb0/exec";

// Cilindro Oficial da Roleta Europeia (Apenas 1 Zero)
const CILINDRO = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

// Catálogo de Roletas Europeias (1 Zero) - Pragmatic Play
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

// Configurações Globais Editáveis pelo Painel Web
let config = {
  statusRobo: "ATIVO",
  jsessionid: process.env.JSESSIONID || "",
  janelaAlvo: 100,
  avisoAntecipado: 98,
  maxSaidas: 10,
  tamConjunto: 6,
  maxEntradas: 3,
  bloquearSimultaneos: false,
  limiteHistorico: 500
};

// Placar do Dia e Memória das Mesas
let placarDia = { g1: 0, g2: 0, g3: 0, reds: 0, msgIdRelatorio: null };
let estadoMesas = {};

function inicializarMesa(id) {
  estadoMesas[id] = {
    id,
    nome: CATALOGO_MESAS[id] ? CATALOGO_MESAS[id].nome : `Mesa ${id}`,
    historico: [], // Índice 0 = giro mais recente (máx 500)
    ultimoGameId: null,
    carregado500: false,
    statusConexao: "Aguardando JSESSIONID",
    ultimaAtualizacao: "-",
    sinais: {}, // Estado dos 37 conjuntos desta mesa
    radar: []   // Dados calculados dos 37 conjuntos para o Painel Web
  };
  calcularRadarMesa(id, false);
}

Object.keys(CATALOGO_MESAS).forEach(id => inicializarMesa(id));

// =========================================================================
// 1. FUNÇÕES DO TELEGRAM (ENVIO, EXCLUSÃO AUTOMÁTICA E RELATÓRIO)
// =========================================================================
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
    console.error("Erro Telegram:", e.message);
    return null;
  }
}

async function apagarTelegram(msgId) {
  if (!msgId) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN.trim()}/deleteMessage`;
    await axios.post(url, {
      chat_id: String(TELEGRAM_CHAT_ID).trim(),
      message_id: Number(msgId)
    }, { timeout: 6000 });
  } catch (e) {}
}

async function enviarRelatorioParcial() {
  if (placarDia.msgIdRelatorio) {
    await apagarTelegram(placarDia.msgIdRelatorio);
  }
  const totalGreens = placarDia.g1 + placarDia.g2 + placarDia.g3;
  const totalOp = totalGreens + placarDia.reds;
  const taxa = totalOp > 0 ? ((totalGreens / totalOp) * 100).toFixed(1) : "0.0";

  const txt =
    `📋 *PLACAR PARCIAL DO DIA (MULTI-ROLETA)*\n\n` +
    `✅ *Acertos (Greens):* ${totalGreens}\n` +
    `   ├ Entrada 1: ${placarDia.g1}\n` +
    `   ├ Entrada 2: ${placarDia.g2}\n` +
    `   └ Entrada 3: ${placarDia.g3}\n` +
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

// =========================================================================
// 2. MOTOR DE ANÁLISE DOS 37 CONJUNTOS POR MESA
// =========================================================================
async function calcularRadarMesa(tableId, dispararAlertas = true) {
  const mesa = estadoMesas[tableId];
  if (!mesa) return;

  const giros = mesa.historico; // 0 = mais recente
  const ultimoNumero = giros.length > 0 ? giros[0] : null;
  const novoRadar = [];

  // Verifica se há entrada ativa em qualquer mesa (caso Bloquear Simultâneos esteja ativo)
  let temEntradaGlobal = false;
  if (config.bloquearSimultaneos) {
    Object.values(estadoMesas).forEach(m => {
      Object.values(m.sinais).forEach(st => {
        if (st.fase === 'ENTRADA') temEntradaGlobal = true;
      });
    });
  }

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
    const bateu = ultimoNumero !== null && numerosConj.includes(ultimoNumero);

    // Se estamos apenas carregando as 500 jogadas iniciais, sincroniza sem floodar o Telegram
    if (!dispararAlertas || config.statusRobo !== 'ATIVO') {
      if (jogadasJanela >= config.janelaAlvo && contSaidas <= config.maxSaidas) {
        st.fase = 'COOLDOWN'; // Evita disparar sinal atrasado do passado ao ligar
      }
    } else if (ultimoNumero !== null) {
      // LÓGICA EM TEMPO REAL A CADA GIRO NOVO
      if (st.fase === 'ENTRADA') {
        if (bateu) {
          if (st.msgId) await apagarTelegram(st.msgId);
          await enviarTelegram(
            `✅ *GREEN NA ${mesa.nome.toUpperCase()}!*\n` +
            `🎯 Conjunto: *${strConjunto}*\n` +
            `🎲 Número sorteado: *${ultimoNumero}* (Entrada ${st.tiro}/${config.maxEntradas})`
          );
          if (st.tiro === 1) placarDia.g1++;
          else if (st.tiro === 2) placarDia.g2++;
          else placarDia.g3++;

          await enviarRelatorioParcial();
          st = { fase: 'COOLDOWN', msgId: null, tiro: 0 };
        } else {
          if (st.tiro >= config.maxEntradas) {
            if (st.msgId) await apagarTelegram(st.msgId);
            await enviarTelegram(
              `❌ *RED NA ${mesa.nome.toUpperCase()}*\n` +
              `Conjunto: *${strConjunto}*\n` +
              `Não saiu nas ${config.maxEntradas} entradas (Último nº: ${ultimoNumero}).`
            );
            placarDia.reds++;
            await enviarRelatorioParcial();
            st = { fase: 'COOLDOWN', msgId: null, tiro: 0 };
          } else {
            st.tiro++;
          }
        }
      } else if (st.fase === 'COOLDOWN') {
        if (bateu || jogadasJanela < config.avisoAntecipado) {
          st = { fase: 'LIVRE', msgId: null, tiro: 0 };
        }
      } else if ((st.fase === 'ALERTA_1' || st.fase === 'ALERTA_2') && jogadasJanela < config.avisoAntecipado) {
        if (st.msgId) await apagarTelegram(st.msgId);
        st = { fase: 'LIVRE', msgId: null, tiro: 0 };
      } else if (!config.bloquearSimultaneos || !temEntradaGlobal) {
        // 3º ALERTA: ORDEM DE ENTRADA
        if (jogadasJanela >= config.janelaAlvo && contSaidas <= config.maxSaidas && st.fase !== 'ENTRADA') {
          if (st.msgId) await apagarTelegram(st.msgId);

          let tab = `Nº | Últ.Saída | Vezes\n`;
          statsNumeros.forEach(s => {
            tab += `${String(s.num).padEnd(2, ' ')} | ${String(s.ultimaSaida).padEnd(9, ' ')} | ${s.vezes}\n`;
          });

          const msgEntrada =
            `🚨 *ENTRADA CONFIRMADA - ${mesa.nome.toUpperCase()}*\n` +
            `👉 Jogar no Conjunto: *${strConjunto}*\n\n` +
            `📊 Saíram *${contSaidas} vezes* nas últimas *${jogadasJanela} jogadas*!\n` +
            `🎯 Fazer até *${config.maxEntradas} jogadas seguidas*\n\n` +
            `\`\`\`\n${tab}\`\`\``;

          const novoId = await enviarTelegram(msgEntrada);
          st = { fase: 'ENTRADA', msgId: novoId, tiro: 1 };
          temEntradaGlobal = true;
        }
        // 2º ALERTA: FALTA 1 JOGADA
        else if (jogadasJanela === (config.janelaAlvo - 1) && contSaidas <= config.maxSaidas && st.fase !== 'ALERTA_2') {
          if (st.msgId) await apagarTelegram(st.msgId);
          const msg2 =
            `⏳ *FALTA 1 JOGADA - ${mesa.nome.toUpperCase()}*\n` +
            `Conjunto: *${strConjunto}*\n` +
            `(${contSaidas} saídas em ${jogadasJanela} jogadas). Se não sair agora, entrar na próxima!`;
          const novoId = await enviarTelegram(msg2);
          st = { fase: 'ALERTA_2', msgId: novoId, tiro: 0 };
        }
        // 1º ALERTA: 2 JOGADAS ANTES (SE PREPARE)
        else if (jogadasJanela === config.avisoAntecipado && contSaidas <= config.maxSaidas && st.fase === 'LIVRE') {
          const msg1 =
            `⚠️ *SE PREPARE (FALTAM 2 GIROS) - ${mesa.nome.toUpperCase()}*\n` +
            `Conjunto *${strConjunto}* se formando (${contSaidas} saídas em ${jogadasJanela} jogadas).`;
          const novoId = await enviarTelegram(msg1);
          st = { fase: 'ALERTA_1', msgId: novoId, tiro: 0 };
        }
      }
    }

    mesa.sinais[idConj] = st;

    let statusTxt = 'Normal';
    let corStatus = '#888';
    if (st.fase === 'ENTRADA') { statusTxt = `🔥 ENTRADA (${st.tiro}/${config.maxEntradas})`; corStatus = '#00ff66'; }
    else if (st.fase === 'ALERTA_2') { statusTxt = '⏳ FALTA 1 GIRO'; corStatus = '#ffcc00'; }
    else if (st.fase === 'ALERTA_1') { statusTxt = '⚠️ PREPARAR (-2)'; corStatus = '#ff9900'; }
    else if (jogadasJanela >= (config.avisoAntecipado - 10)) { statusTxt = '👀 Aquecendo'; corStatus = '#00ccff'; }

    novoRadar.push({
      idConj,
      strConjunto,
      jogadasJanela,
      contSaidas,
      statusTxt,
      corStatus,
      resumoCurto
    });
  }

  // Ordena opcionalmente ou mantém ordem do cilindro
  mesa.radar = novoRadar;
}

// =========================================================================
// 3. COLETOR AUTOMÁTICO EM NUVEM (CARREGA 500 GIROS INICIAIS + TEMPO REAL)
// =========================================================================
async function sincronizarMesaPragmatic(tableId) {
  if (!config.jsessionid) return;
  const mesa = estadoMesas[tableId];
  if (!mesa) return;

  // Se ainda não carregou o histórico completo, puxa 500 de uma vez. Depois puxa 15 por vez para ser leve.
  const qtdBusca = mesa.carregado500 ? 15 : 500;
  const url = `https://games.pragmaticplaylive.net/api/ui/statisticHistory?tableId=${tableId}&numberOfGames=${qtdBusca}&JSESSIONID=${encodeURIComponent(config.jsessionid)}`;

  try {
    const res = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });

    const lista = res.data && (res.data.history || res.data.results || res.data.data);
    if (!Array.isArray(lista) || lista.length === 0) {
      mesa.statusConexao = "⚠️ Sessão Expirada (Atualize o JSESSIONID)";
      return;
    }

    // Extrai números válidos e gameIds (índice 0 da API Pragmatic = mais recente)
    const girosExtraidos = [];
    for (const item of lista) {
      const gId = String(item.gameId || item.id || item.time || "");
      const raw = String(item.gameResult || item.result || item.number || "");
      const m = raw.match(/\b([0-9]|[12][0-9]|3[0-6])\b/);
      if (m && gId) {
        girosExtraidos.push({ gameId: gId, numero: parseInt(m[1], 10) });
      }
    }

    if (girosExtraidos.length === 0) return;

    // 1ª VEZ: Carrega os 500 giros instantaneamente sem disparar alertas antigos
    if (!mesa.carregado500) {
      mesa.historico = girosExtraidos.slice(0, config.limiteHistorico).map(x => x.numero);
      mesa.ultimoGameId = girosExtraidos[0].gameId;
      mesa.carregado500 = true;
      mesa.statusConexao = `🟢 Online (${mesa.historico.length} giros carregados)`;
      mesa.ultimaAtualizacao = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Fortaleza' });
      await calcularRadarMesa(tableId, false);
      console.log(`✅ [${mesa.nome}] Histórico inicial de ${mesa.historico.length} giros carregado!`);
      return;
    }

    // MONITORAMENTO CONTÍNUO: Verifica se saíram giros novos desde o ultimoGameId
    const novosGiros = [];
    for (const item of girosExtraidos) {
      if (item.gameId === mesa.ultimoGameId) break;
      novosGiros.push(item);
    }

    if (novosGiros.length > 0) {
      // Processa do mais antigo para o mais recente caso tenha saído mais de 1
      novosGiros.reverse();
      for (const novo of novosGiros) {
        mesa.historico.unshift(novo.numero);
        if (mesa.historico.length > config.limiteHistorico) {
          mesa.historico.pop(); // Entra a nova, sai a 501ª (velha)
        }
        mesa.ultimoGameId = novo.gameId;
        mesa.ultimaAtualizacao = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Fortaleza' });
        mesa.statusConexao = `🟢 Online (Último nº: ${novo.numero})`;
        await calcularRadarMesa(tableId, true);
      }
    }
  } catch (err) {
    mesa.statusConexao = `❌ Erro API (${err.response ? err.response.status : 'Conexão'})`;
  }
}

// Loop em nuvem a cada 5 segundos percorrendo todas as roletas ativas
setInterval(async () => {
  if (!config.jsessionid) return;
  for (const id of Object.keys(CATALOGO_MESAS)) {
    if (CATALOGO_MESAS[id].ativa) {
      await sincronizarMesaPragmatic(id);
    }
  }
}, 5000);

// =========================================================================
// 4. ROTAS DE AÇÃO (CONFIGURAÇÃO, TESTE MANUAL, FECHAR DIA E API JSON)
// =========================================================================
app.get('/api/state', (req, res) => {
  res.json({ config, placarDia, catalogo: CATALOGO_MESAS, estadoMesas });
});

app.post('/api/config', async (req, res) => {
  const b = req.body;
  const mudouSessao = b.jsessionid && b.jsessionid.trim() !== config.jsessionid;

  if (b.statusRobo) config.statusRobo = b.statusRobo;
  if (b.jsessionid !== undefined) config.jsessionid = b.jsessionid.trim();
  if (b.janelaAlvo) config.janelaAlvo = Number(b.janelaAlvo);
  if (b.avisoAntecipado) config.avisoAntecipado = Number(b.avisoAntecipado);
  if (b.maxSaidas) config.maxSaidas = Number(b.maxSaidas);
  if (b.maxEntradas) config.maxEntradas = Number(b.maxEntradas);
  config.bloquearSimultaneos = b.bloquearSimultaneos === 'SIM';

  // Atualiza quais mesas estão marcadas
  const mesasMarcadas = Array.isArray(b.mesas) ? b.mesas : (b.mesas ? [b.mesas] : []);
  Object.keys(CATALOGO_MESAS).forEach(id => {
    CATALOGO_MESAS[id].ativa = mesasMarcadas.includes(id);
    if (mudouSessao) {
      estadoMesas[id].carregado500 = false; // Força recarregar os 500 giros com a nova sessão
    }
  });

  // Se adicionou ID customizado
  if (b.novaMesaId && b.novaMesaNome) {
    const nid = b.novaMesaId.trim();
    CATALOGO_MESAS[nid] = { id: nid, nome: b.novaMesaNome.trim(), ativa: true };
    inicializarMesa(nid);
  }

  res.redirect('/?aba=' + (b.abaAtual || '237'));
});

// Simular ou Enviar Giro Manual em uma Mesa Específica (Para Testes Instantâneos)
app.get('/report', async (req, res) => {
  const num = parseInt(req.query.num, 10);
  const tableId = req.query.tableId || "237";
  if (isNaN(num) || num < 0 || num > 36) return res.status(400).send("Número inválido (0 a 36)");

  const mesa = estadoMesas[tableId];
  if (mesa) {
    mesa.historico.unshift(num);
    if (mesa.historico.length > config.limiteHistorico) mesa.historico.pop();
    mesa.ultimaAtualizacao = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Fortaleza' });
    mesa.statusConexao = `🟢 Giro Manual Recebido (${num})`;
    await calcularRadarMesa(tableId, true);
  }
  res.redirect('/?aba=' + tableId);
});

// Botão para Preencher 500 Giros Simulados (Para testar o sistema na hora mesmo sem JSESSIONID)
app.post('/api/simular500', async (req, res) => {
  const tableId = req.body.tableId || "237";
  const mesa = estadoMesas[tableId];
  if (mesa) {
    mesa.historico = [];
    for (let i = 0; i < 500; i++) {
      mesa.historico.push(CILINDRO[Math.floor(Math.random() * 37)]);
    }
    mesa.carregado500 = true;
    mesa.statusConexao = "🟢 500 Giros de Teste Carregados!";
    mesa.ultimaAtualizacao = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Fortaleza' });
    await calcularRadarMesa(tableId, false);
  }
  res.redirect('/?aba=' + tableId);
});

app.post('/api/fechar-dia', async (req, res) => {
  const totalGreens = placarDia.g1 + placarDia.g2 + placarDia.g3;
  const totalOp = totalGreens + placarDia.reds;
  const taxa = totalOp > 0 ? ((totalGreens / totalOp) * 100).toFixed(1) + "%" : "0%";
  const dataHoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });

  const msgFinal =
    `🏁 *FECHAMENTO OFICIAL DO DIA (${dataHoje})*\n\n` +
    `✅ *Total de Acertos:* ${totalGreens}\n` +
    `   ├ Entrada 1: ${placarDia.g1}\n` +
    `   ├ Entrada 2: ${placarDia.g2}\n` +
    `   └ Entrada 3: ${placarDia.g3}\n` +
    `❌ *Reds:* ${placarDia.reds}\n` +
    `📈 *Taxa do Dia:* ${taxa}`;

  await enviarTelegram(msgFinal);

  // Opcional: Aciona fechamento na planilha para histórico semanal/mensal
  if (GAS_WEBHOOK_URL) {
    try { await axios.post(GAS_WEBHOOK_URL, { type: 'FECHAR_DIA' }, { timeout: 8000 }); } catch (e) {}
  }

  placarDia = { g1: 0, g2: 0, g3: 0, reds: 0, msgIdRelatorio: null };
  res.redirect('/');
});

// =========================================================================
// 5. PAINEL WEB COMPLETO (SUBSTITUI O PAINEL DA PLANILHA)
// =========================================================================
app.get('/', (req, res) => {
  const abaAtiva = req.query.aba || Object.keys(CATALOGO_MESAS).find(k => CATALOGO_MESAS[k].ativa) || "237";
  const mesaAtual = estadoMesas[abaAtiva] || estadoMesas["237"];
  const totalGreens = placarDia.g1 + placarDia.g2 + placarDia.g3;
  const totalOp = totalGreens + placarDia.reds;
  const taxaHoje = totalOp > 0 ? ((totalGreens / totalOp) * 100).toFixed(1) : "0.0";

  const abasHtml = Object.keys(CATALOGO_MESAS).map(id => {
    const m = CATALOGO_MESAS[id];
    const est = estadoMesas[id];
    const isSel = id === abaAtiva;
    const badge = m.ativa ? "🟢" : "⚪";
    return `<a href="/?aba=${id}" style="padding:10px 14px; text-decoration:none; border-radius:8px 8px 0 0; font-weight:bold; font-size:13px; background:${isSel ? '#00ffcc' : '#222'}; color:${isSel ? '#000' : '#ccc'}; border:1px solid #333;">
      ${badge} ${m.nome} (${est.historico.length})
    </a>`;
  }).join(' ');

  const ultimos20Html = mesaAtual.historico.slice(0, 20).map((n, i) => {
    const isRed = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(n);
    const bg = n === 0 ? '#00aa00' : (isRed ? '#cc0000' : '#222');
    const borda = i === 0 ? '2px solid #00ffcc' : '1px solid #555';
    return `<span style="display:inline-block; width:28px; height:28px; line-height:28px; text-align:center; border-radius:50%; background:${bg}; color:#fff; font-weight:bold; font-size:12px; margin:2px; border:${borda};">${n}</span>`;
  }).join('');

  const linhasRadarHtml = mesaAtual.radar.map(r => {
    const destaque = r.jogadasJanela >= config.avisoAntecipado ? 'background:rgba(255, 204, 0, 0.12);' : '';
    return `<tr style="border-bottom:1px solid #2a2a2a; ${destaque}">
      <td style="padding:8px; font-weight:bold; color:#00ffcc;">${r.idConj}</td>
      <td style="padding:8px; font-weight:bold;">${r.strConjunto}</td>
      <td style="padding:8px; text-align:center; font-size:15px; font-weight:bold; color:#fff;">${r.jogadasJanela}</td>
      <td style="padding:8px; text-align:center;">${r.contSaidas}</td>
      <td style="padding:8px; text-align:center; font-weight:bold; color:${r.corStatus};">${r.statusTxt}</td>
      <td style="padding:8px; font-size:11px; color:#aaa; font-family:monospace;">${r.resumoCurto}</td>
    </tr>`;
  }).join('');

  const checkboxesMesas = Object.keys(CATALOGO_MESAS).map(id => {
    const m = CATALOGO_MESAS[id];
    return `<label style="display:inline-block; margin-right:12px; margin-bottom:6px; font-size:12px; background:#1b1b1b; padding:5px 8px; border-radius:5px; border:1px solid #333;">
      <input type="checkbox" name="mesas" value="${id}" ${m.ativa ? 'checked' : ''}> ${m.nome} (ID ${id})
    </label>`;
  }).join('');

  res.send(`<!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="8">
    <title>Painel Web Multi-Roleta</title>
    <style>
      body { background:#0d0d0d; color:#eee; font-family:Arial, sans-serif; margin:0; padding:15px; }
      .grid-top { display:grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap:15px; margin-bottom:15px; }
      .card { background:#161616; border:1px solid #2b2b2b; border-radius:10px; padding:14px; }
      .card h3 { margin-top:0; color:#00ffcc; font-size:15px; border-bottom:1px solid #2b2b2b; padding-bottom:8px; }
      input[type="text"], input[type="number"], select { background:#222; color:#fff; border:1px solid #444; padding:6px; border-radius:5px; }
      .btn { cursor:pointer; border:none; border-radius:6px; padding:8px 12px; font-weight:bold; color:#fff; }
      table { width:100%; border-collapse:collapse; background:#141414; border-radius:8px; overflow:hidden; font-size:13px; }
      th { background:#222; color:#00ffcc; padding:10px 8px; text-align:left; }
    </style>
  </head>
  <body>
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; margin-bottom:12px;">
      <h2 style="margin:0; color:#00ffcc;">🎯 PAINEL WEB MULTI-ROLETA (1 ZERO - 500 JOGADAS)</h2>
      <span style="font-size:12px; color:#aaa;">Atualização automática a cada 8s | Horário: ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Fortaleza' })}</span>
    </div>

    <div class="grid-top">
      <!-- BLOCO 1: CONFIGURAÇÃO E SELEÇÃO DE ROLETAS -->
      <div class="card">
        <h3>⚙️ Parâmetros e Roletas Monitoradas</h3>
        <form action="/api/config" method="POST">
          <input type="hidden" name="abaAtual" value="${abaAtiva}">
          <div style="margin-bottom:8px;">
            <label style="font-size:12px;"><b>JSESSIONID (Pragmatic Play - Puxa 500 giros):</b></label><br>
            <input type="text" name="jsessionid" value="${config.jsessionid}" placeholder="Cole o JSESSIONID aqui..." style="width:96%; margin-top:4px;">
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:12px; margin-bottom:8px;">
            <div>Status Robô:
              <select name="statusRobo" style="width:100%;">
                <option value="ATIVO" ${config.statusRobo === 'ATIVO' ? 'selected' : ''}>ATIVO</option>
                <option value="PAUSADO" ${config.statusRobo === 'PAUSADO' ? 'selected' : ''}>PAUSADO</option>
              </select>
            </div>
            <div>Bloquear Simultâneos:
              <select name="bloquearSimultaneos" style="width:100%;">
                <option value="NAO" ${!config.bloquearSimultaneos ? 'selected' : ''}>NÃO (Várias Mesas)</option>
                <option value="SIM" ${config.bloquearSimultaneos ? 'selected' : ''}>SIM (1 por vez)</option>
              </select>
            </div>
            <div>Janela Alvo (Gatilho): <input type="number" name="janelaAlvo" value="${config.janelaAlvo}" style="width:90%;"></div>
            <div>Pré-Alerta (-2 Giros): <input type="number" name="avisoAntecipado" value="${config.avisoAntecipado}" style="width:90%;"></div>
            <div>Máx Saídas Conjunto: <input type="number" name="maxSaidas" value="${config.maxSaidas}" style="width:90%;"></div>
            <div>Tiros p/ Entrada: <input type="number" name="maxEntradas" value="${config.maxEntradas}" style="width:90%;"></div>
          </div>
          <div style="margin-bottom:8px;">
            <div style="font-size:12px; font-weight:bold; margin-bottom:4px;">Roletas Europeias (1 Zero) Ativas:</div>
            ${checkboxesMesas}
          </div>
          <div style="display:flex; gap:6px; margin-bottom:8px;">
            <input type="text" name="novaMesaId" placeholder="Novo TableID" style="width:35%; font-size:11px;">
            <input type="text" name="novaMesaNome" placeholder="Nome da Roleta" style="width:65%; font-size:11px;">
          </div>
          <button type="submit" class="btn" style="width:100%; background:#00aa00;">💾 Salvar Configurações e Sincronizar 500 Jogadas</button>
        </form>
      </div>

      <!-- BLOCO 2: PLACAR DO DIA E TESTES RÁPIDOS -->
      <div class="card">
        <h3>📊 Placar do Dia & Simulador de Testes</h3>
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; text-align:center; margin-bottom:12px;">
          <div style="background:#1f2e1f; padding:8px; border-radius:6px;">
            <div style="font-size:11px; color:#aaa;">GREENS HOJE</div>
            <div style="font-size:20px; font-weight:bold; color:#00ff66;">${totalGreens}</div>
            <div style="font-size:10px; color:#ccc;">G1:${placarDia.g1} | G2:${placarDia.g2} | G3:${placarDia.g3}</div>
          </div>
          <div style="background:#2e1f1f; padding:8px; border-radius:6px;">
            <div style="font-size:11px; color:#aaa;">REDS HOJE</div>
            <div style="font-size:20px; font-weight:bold; color:#ff4d4d;">${placarDia.reds}</div>
          </div>
          <div style="background:#1f262e; padding:8px; border-radius:6px;">
            <div style="font-size:11px; color:#aaa;">ASSERTIVIDADE</div>
            <div style="font-size:20px; font-weight:bold; color:#00ccff;">${taxaHoje}%</div>
          </div>
        </div>

        <form action="/api/fechar-dia" method="POST" style="margin-bottom:14px;">
          <button type="submit" class="btn" style="width:100%; background:#cc7a00;">🏁 Fechar Dia (Enviar Relatório Oficial ao Telegram)</button>
        </form>

        <hr style="border-color:#2b2b2b;">
        <div style="font-size:12px; font-weight:bold; margin-bottom:6px; color:#ffcc00;">🧪 Ferramentas de Teste Rápido (${mesaAtual.nome}):</div>
        <div style="display:flex; gap:8px; margin-bottom:8px;">
          <form action="/report" method="GET" style="display:flex; gap:6px; flex:1;">
            <input type="hidden" name="tableId" value="${abaAtiva}">
            <input type="number" name="num" min="0" max="36" placeholder="Nº (0-36)" required style="width:80px;">
            <button type="submit" class="btn" style="background:#0066cc; flex:1;">➕ Inserir Giro</button>
          </form>
          <form action="/api/simular500" method="POST">
            <input type="hidden" name="tableId" value="${abaAtiva}">
            <button type="submit" class="btn" style="background:#555;">🎲 Gerar 500 Giros</button>
          </form>
        </div>
      </div>
    </div>

    <!-- ABAS DAS ROLETAS -->
    <div style="margin-bottom:10px; display:flex; gap:6px; flex-wrap:wrap; border-bottom:2px solid #00ffcc; padding-bottom:4px;">
      ${abasHtml}
    </div>

    <!-- INFO DA MESA SELECIONADA E ÚLTIMOS 20 NÚMEROS -->
    <div class="card" style="margin-bottom:15px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; margin-bottom:8px;">
        <div>
          <b style="color:#00ffcc; font-size:16px;">${mesaAtual.nome} (ID: ${mesaAtual.id})</b>
          <span style="margin-left:12px; font-size:13px; color:#ffcc00;">${mesaAtual.statusConexao}</span>
        </div>
        <div style="font-size:12px; color:#aaa;">
          Histórico na memória: <b>${mesaAtual.historico.length} / ${config.limiteHistorico} jogadas</b> | Último giro: ${mesaAtual.ultimaAtualizacao}
        </div>
      </div>
      <div style="background:#0a0a0a; padding:8px; border-radius:6px; border:1px solid #222;">
        <span style="font-size:11px; color:#888; margin-right:8px;">Últimos 20 giros (Esquerda = Mais recente):</span>
        ${ultimos20Html || '<span style="color:#666; font-size:12px;">Nenhum giro carregado ainda. Cole o JSESSIONID ou clique em "Gerar 500 Giros".</span>'}
      </div>
    </div>

    <!-- TABELA RADAR DOS 37 CONJUNTOS -->
    <div class="card">
      <h3>📡 Radar ao Vivo dos 37 Conjuntos de 6 Vizinhos — ${mesaAtual.nome}</h3>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Conjunto (6 Vizinhos)</th>
              <th style="text-align:center;">Jogadas p/ ${config.maxSaidas} Saídas</th>
              <th style="text-align:center;">Saídas na Janela</th>
              <th style="text-align:center;">Status Atual</th>
              <th>Detalhe Individual (Nº: Última Saída / Vezes na Janela)</th>
            </tr>
          </thead>
          <tbody>
            ${linhasRadarHtml}
          </tbody>
        </table>
      </div>
    </div>
  </body>
  </html>`);
});

app.listen(PORT, () => {
  console.log(`🚀 Painel Web Multi-Roleta rodando na porta ${PORT}`);
});
