const SS_ID = "1zrMzYqGRqdRl40bUDz3gvky3URtSIIa_Lyv9PQ1mQ_g";
const TELEGRAM_TOKEN = "9091680827:AAER8mF6-T5gJ8iL5VGK4EbCFCH4QY7lazc";
const TELEGRAM_CHAT_ID = "824181525";

// Sequência oficial do cilindro da Roleta Europeia
const CILINDRO = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

// =========================================================================
// 1. ESTRUTURAÇÃO AUTOMÁTICA DA PLANILHA
// =========================================================================
function estruturarPlanilhaCompleta() {
  const ss = SpreadsheetApp.openById(SS_ID);

  let shHist = ss.getSheetByName('Historico');
  if (!shHist) shHist = ss.insertSheet('Historico');
  if (shHist.getLastRow() === 0) {
    shHist.getRange('A1:D1').setValues([['GameId', 'Numero', 'RawResult', 'Timestamp']]);
    shHist.getRange('A1:D1').setFontWeight('bold').setBackground('#222222').setFontColor('#FFFFFF');
  }

  let shRes = ss.getSheetByName('Resumos');
  if (!shRes) shRes = ss.insertSheet('Resumos');
  if (shRes.getLastRow() === 0) {
    shRes.getRange('A1:H1').setValues([[
      'Data', 'Total Giros', 'Greens Total', 'Entrada 1 (G1)', 'Entrada 2 (G2)', 'Entrada 3 (G3)', 'Reds', '% Assertividade'
    ]]);
    shRes.getRange('A1:H1').setFontWeight('bold').setBackground('#1c4587').setFontColor('#FFFFFF');
  }

  let shPainel = ss.getSheetByName('Painel');
  if (!shPainel) shPainel = ss.insertSheet('Painel');
  shPainel.clear();

  shPainel.getRange('A1:J1').merge().setValue('🎯 PAINEL DE CONTROLE E RADAR DE CONJUNTOS - ROLETA EUROPEIA')
    .setFontWeight('bold').setFontSize(12).setBackground('#111111').setFontColor('#00ffcc').setHorizontalAlignment('center');

  shPainel.getRange('A3:B3').merge().setValue('⚙️ PARÂMETROS EDITÁVEIS').setFontWeight('bold').setBackground('#333333').setFontColor('#FFFFFF');
  const configs = [
    ['Status do Robô (ATIVO/PAUSADO)', 'ATIVO'],
    ['Janela Alvo de Jogadas (Gatilho)', 100],
    ['Aviso Antecipado (2 Jogadas Antes)', 98],
    ['Limite Máximo de Saídas no Conjunto', 10],
    ['Tamanho do Conjunto (Vizinhos)', 6],
    ['Quantidade de Entradas (Tiros)', 3],
    ['Bloquear Sinais Simultâneos (SIM/NAO)', 'NAO'],
    ['Limite do Histórico Rolante', 500]
  ];
  shPainel.getRange('A4:B11').setValues(configs);
  shPainel.getRange('B4:B11').setFontWeight('bold').setBackground('#fff2cc').setHorizontalAlignment('center');
  shPainel.getRange('A3:B11').setBorder(true, true, true, true, true, true);

  shPainel.getRange('A13:B13').merge().setValue('📊 PLACAR DO DIA ATUAL').setFontWeight('bold').setBackground('#134f5c').setFontColor('#FFFFFF');
  const placarDia = [
    ['Total de Giros no Histórico (Máx 500)', '=COUNTA(Historico!B2:B)'],
    ['Último Número Sorteado', '=IF(COUNTA(Historico!B2:B)>0, INDEX(Historico!B2:B, COUNTA(Historico!B2:B)), "-")'],
    ['Total de Greens Hoje', '=SUM(B17:B19)'],
    ['✅ Acerto na Entrada 1', 0],
    ['✅ Acerto na Entrada 2', 0],
    ['✅ Acerto na Entrada 3', 0],
    ['❌ Total de Reds Hoje', 0],
    ['📈 Assertividade Hoje (%)', '=IF((B16+B20)>0, ROUND((B16/(B16+B20))*100, 1)&"%", "0%")']
  ];
  shPainel.getRange('A14:B21').setValues(placarDia);
  shPainel.getRange('B14:B21').setFontWeight('bold').setHorizontalAlignment('center');
  shPainel.getRange('A13:B21').setBorder(true, true, true, true, true, true);

  shPainel.getRange('A23:B23').merge().setValue('📅 ACUMULADO GERAL (ABA RESUMOS)').setFontWeight('bold').setBackground('#274e13').setFontColor('#FFFFFF');
  shPainel.getRange('A24:B26').setValues([
    ['Greens Acumulados (Mês/Geral)', '=SUM(Resumos!C2:C) + B16'],
    ['Reds Acumulados (Mês/Geral)', '=SUM(Resumos!G2:G) + B20'],
    ['Taxa de Acerto Geral', '=IF((B24+B25)>0, ROUND((B24/(B24+B25))*100, 1)&"%", "0%")']
  ]);
  shPainel.getRange('B24:B26').setFontWeight('bold').setHorizontalAlignment('center');
  shPainel.getRange('A23:B26').setBorder(true, true, true, true, true, true);

  shPainel.getRange('D3:I3').merge().setValue('📡 RADAR AO VIVO DOS 37 CONJUNTOS (CONTAGEM PARA 10 SAÍDAS)')
    .setFontWeight('bold').setBackground('#333333').setFontColor('#FFFFFF').setHorizontalAlignment('center');
  
  shPainel.getRange('D4:I4').setValues([[
    'ID', 'Conjunto (6 Vizinhos)', 'Jogadas p/ 10 Saídas', 'Saídas na Janela', 'Status Atual', 'Detalhe (Nº: Últ.Saída / Vezes)'
  ]]).setFontWeight('bold').setBackground('#d9d9d9').setHorizontalAlignment('center');

  const linhasConjuntos = [];
  for (let i = 0; i < 37; i++) {
    const nums = obterConjunto(i, 6);
    linhasConjuntos.push([`Conjunto ${i + 1}`, nums.join('. '), 0, 0, 'Aguardando giros', '-']);
  }
  shPainel.getRange(5, 4, 37, 6).setValues(linhasConjuntos);
  shPainel.getRange(4, 4, 38, 6).setBorder(true, true, true, true, true, true);

  PropertiesService.getScriptProperties().deleteAllProperties();
  Logger.log('Estrutura completa criada com sucesso!');
}

// =========================================================================
// 2. RECEBIMENTO AUTOMÁTICO DE GIROS DA NUVEM (DOPOST)
// =========================================================================
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    const rawData = e && e.postData ? e.postData.contents : "{}";
    const data = JSON.parse(rawData);
    const ss = SpreadsheetApp.openById(SS_ID);

    if (data.type === 'NEW_SPIN') {
      const shHist = ss.getSheetByName('Historico');
      const shPainel = ss.getSheetByName('Painel');
      const spin = data.spin;
      const numSorteado = Number(spin.number);

      // 1. Grava o giro novo
      shHist.appendRow([String(spin.gameId), numSorteado, String(spin.rawResult), String(spin.timestamp)]);

      // 2. Mantém no máximo 500 jogadas (entra nova, sai velha)
      const limiteHist = Number(shPainel.getRange('B11').getValue()) || 500;
      const totalLinhas = shHist.getLastRow() - 1;
      if (totalLinhas > limiteHist) {
        shHist.deleteRows(2, totalLinhas - limiteHist);
      }

      // 3. Roda a inteligência dos 37 conjuntos
      analisarConjuntosEAlertar(ss, shHist, shPainel, numSorteado);

      return jsonResponse({ status: 'success', number: numSorteado });
    }

    if (data.type === 'FECHAR_DIA') {
      fecharDia();
      return jsonResponse({ status: 'success', message: 'Fechamento realizado' });
    }

    return jsonResponse({ status: 'error', message: 'Comando desconhecido' });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  } finally {
    lock.releaseLock();
  }
}

// =========================================================================
// 3. MOTOR DE ANÁLISE DOS 37 CONJUNTOS (FUNCIONA AUTOMÁTICO E MANUAL)
// =========================================================================
function analisarConjuntosEAlertar(ss, shHist, shPainel, ultimoNumero) {
  // Se for executada manualmente pelo botão "Executar", carrega a planilha sozinha:
  if (!ss) ss = SpreadsheetApp.openById(SS_ID);
  if (!shHist) shHist = ss.getSheetByName('Historico');
  if (!shPainel) shPainel = ss.getSheetByName('Painel');

  const lastRow = shHist.getLastRow();
  if (lastRow < 2) {
    Logger.log("Histórico ainda está vazio.");
    return;
  }

  const colNumeros = shHist.getRange(2, 2, lastRow - 1, 1).getValues().map(r => Number(r[0]));
  const girosRecentes = colNumeros.slice().reverse(); // índice 0 = mais recente
  if (ultimoNumero === undefined) ultimoNumero = girosRecentes[0];

  const cfgVals = shPainel.getRange('B4:B10').getValues();
  const statusRobo      = String(cfgVals[0][0]).trim().toUpperCase();
  const janelaAlvo      = Number(cfgVals[1][0]) || 100;
  const avisoAntecipado = Number(cfgVals[2][0]) || (janelaAlvo - 2);
  const maxSaidas       = Number(cfgVals[3][0]) || 10;
  const tamConjunto     = Number(cfgVals[4][0]) || 6;
  const maxEntradas     = Number(cfgVals[5][0]) || 3;
  const bloquearSimult  = String(cfgVals[6][0]).trim().toUpperCase() === 'SIM';

  const props = PropertiesService.getScriptProperties();
  let estadoSinais = JSON.parse(props.getProperty('ESTADO_SINAIS') || '{}');
  let temEntradaAtiva = Object.values(estadoSinais).some(st => st.fase === 'ENTRADA');

  const tabelaRadar = [];

  for (let idx = 0; idx < 37; idx++) {
    const idConj = `C${idx + 1}`;
    const numerosConj = obterConjunto(idx, tamConjunto);
    const strConjunto = numerosConj.join('. ');

    let contSaidas = 0;
    let jogadasJanela = 0;

    for (let g = 0; g < girosRecentes.length; g++) {
      if (numerosConj.includes(girosRecentes[g])) {
        if (contSaidas === maxSaidas) break;
        contSaidas++;
      }
      jogadasJanela++;
    }

    const statsNumeros = numerosConj.map(num => {
      let ultimaSaida = -1;
      let vezesNaJanela = 0;
      for (let g = 0; g < jogadasJanela; g++) {
        if (girosRecentes[g] === num) {
          vezesNaJanela++;
          if (ultimaSaida === -1) ultimaSaida = g + 1;
        }
      }
      if (ultimaSaida === -1) {
        const posGeral = girosRecentes.indexOf(num);
        ultimaSaida = posGeral !== -1 ? posGeral + 1 : '500+';
      }
      return { num, ultimaSaida, vezes: vezesNaJanela };
    });

    const resumoCurto = statsNumeros.map(s => `${s.num}(${s.ultimaSaida}g/${s.vezes}x)`).join(' ');
    let st = estadoSinais[idConj] || { fase: 'LIVRE', msgId: null, tiro: 0 };
    const bateuNumeroDoConjunto = numerosConj.includes(ultimoNumero);

    if (statusRobo === 'ATIVO') {
      if (st.fase === 'ENTRADA') {
        if (bateuNumeroDoConjunto) {
          if (st.msgId) apagarMensagemTelegram(st.msgId);

          const textoGreen =
            `✅ *GREEN NO CONJUNTO (${strConjunto})!*\n` +
            `🎯 Número sorteado: *${ultimoNumero}* (Entrada ${st.tiro}/${maxEntradas})`;
          enviarMensagemTelegram(textoGreen);

          const linhaGreen = 16 + st.tiro;
          const valAtual = Number(shPainel.getRange(linhaGreen, 2).getValue()) || 0;
          shPainel.getRange(linhaGreen, 2).setValue(valAtual + 1);

          enviarRelatorioParcialTelegram(shPainel);
          st = { fase: 'LIVRE', msgId: null, tiro: 0 };
        } else {
          if (st.tiro >= maxEntradas) {
            if (st.msgId) apagarMensagemTelegram(st.msgId);

            const textoRed =
              `❌ *RED NO CONJUNTO (${strConjunto})*\n` +
              `Não saiu nas ${maxEntradas} entradas (Último nº: ${ultimoNumero}).`;
            enviarMensagemTelegram(textoRed);

            const redAtual = Number(shPainel.getRange(20, 2).getValue()) || 0;
            shPainel.getRange(20, 2).setValue(redAtual + 1);

            enviarRelatorioParcialTelegram(shPainel);
            st = { fase: 'COOLDOWN', msgId: null, tiro: 0 };
          } else {
            st.tiro += 1;
          }
        }
      } else if (st.fase === 'COOLDOWN') {
        if (bateuNumeroDoConjunto || jogadasJanela < avisoAntecipado) {
          st = { fase: 'LIVRE', msgId: null, tiro: 0 };
        }
      } else if ((st.fase === 'ALERTA_1' || st.fase === 'ALERTA_2') && jogadasJanela < avisoAntecipado) {
        if (st.msgId) apagarMensagemTelegram(st.msgId);
        st = { fase: 'LIVRE', msgId: null, tiro: 0 };
      } else if (!bloquearSimult || !temEntradaAtiva) {
        if (jogadasJanela >= janelaAlvo && contSaidas <= maxSaidas && st.fase !== 'ENTRADA') {
          if (st.msgId) apagarMensagemTelegram(st.msgId);

          let tabelaTexto = `Nº | Últ. Saída | Vezes\n`;
          statsNumeros.forEach(s => {
            tabelaTexto += `${String(s.num).padEnd(2, ' ')} | ${String(s.ultimaSaida).padEnd(10, ' ')} | ${s.vezes}\n`;
          });

          const msgEntrada =
            `🚨 *JOGAR NO CONJUNTO:*\n` +
            `👉 *${strConjunto}*\n\n` +
            `📊 Saíram *${contSaidas} vezes* nas últimas *${jogadasJanela} jogadas*!\n` +
            `🎯 Fazer até *${maxEntradas} entradas seguidas*\n\n` +
            `\`\`\`\n${tabelaTexto}\`\`\``;

          const novoMsgId = enviarMensagemTelegram(msgEntrada);
          st = { fase: 'ENTRADA', msgId: novoMsgId, tiro: 1 };
          temEntradaAtiva = true;
        } else if (jogadasJanela === (janelaAlvo - 1) && contSaidas <= maxSaidas && st.fase !== 'ALERTA_2') {
          if (st.msgId) apagarMensagemTelegram(st.msgId);

          const msgAlerta2 =
            `⏳ *ATENÇÃO - FALTA 1 JOGADA!*\n` +
            `Conjunto: *${strConjunto}*\n` +
            `(${contSaidas} saídas em ${jogadasJanela} jogadas).\n` +
            `Se não sair agora, entrar na próxima rodada!`;

          const novoMsgId = enviarMensagemTelegram(msgAlerta2);
          st = { fase: 'ALERTA_2', msgId: novoMsgId, tiro: 0 };
        } else if (jogadasJanela === avisoAntecipado && contSaidas <= maxSaidas && st.fase === 'LIVRE') {
          const msgAlerta1 =
            `⚠️ *CONJUNTO SE FORMANDO - SE PREPARE!*\n` +
            `Conjunto: *${strConjunto}*\n` +
            `Está com ${contSaidas} saídas nas últimas ${jogadasJanela} jogadas (Faltam 2 giros).`;

          const novoMsgId = enviarMensagemTelegram(msgAlerta1);
          st = { fase: 'ALERTA_1', msgId: novoMsgId, tiro: 0 };
        }
      }
    }

    estadoSinais[idConj] = st;

    let statusPainel = 'Normal';
    if (st.fase === 'ENTRADA') statusPainel = `🔥 EM ENTRADA (${st.tiro}/${maxEntradas})`;
    else if (st.fase === 'ALERTA_2') statusPainel = '⏳ FALTA 1 GIRO';
    else if (st.fase === 'ALERTA_1') statusPainel = '⚠️ PREPARAR (FALTAM 2)';
    else if (jogadasJanela >= (avisoAntecipado - 10)) statusPainel = '👀 Aquecendo';

    tabelaRadar.push([idConj, strConjunto, jogadasJanela, contSaidas, statusPainel, resumoCurto]);
  }

  props.setProperty('ESTADO_SINAIS', JSON.stringify(estadoSinais));
  shPainel.getRange(5, 4, 37, 6).setValues(tabelaRadar);
  Logger.log("Análise dos 37 conjuntos concluída e Painel atualizado!");
}

// =========================================================================
// 4. FUNÇÕES AUXILIARES E TELEGRAM
// =========================================================================
function obterConjunto(indiceInicial = 0, tamanho = 6) {
  const resultado = [];
  for (let i = 0; i < tamanho; i++) {
    resultado.push(CILINDRO[(indiceInicial + i) % CILINDRO.length]);
  }
  return resultado;
}

function enviarMensagemTelegram(texto) {
  const msgFinal = texto || "🔔 Teste manual do Google Apps Script: Conexão OK!";
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN.trim()}/sendMessage`;
  const payload = {
    chat_id: String(TELEGRAM_CHAT_ID).trim(),
    text: msgFinal,
    parse_mode: "Markdown"
  };
  try {
    const res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const json = JSON.parse(res.getContentText());
    return (json.ok && json.result) ? json.result.message_id : null;
  } catch (e) {
    Logger.log("Erro envio Telegram: " + e.message);
    return null;
  }
}

function apagarMensagemTelegram(messageId) {
  if (!messageId) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN.trim()}/deleteMessage`;
  const payload = {
    chat_id: String(TELEGRAM_CHAT_ID).trim(),
    message_id: Number(messageId)
  };
  try {
    UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log("Erro ao apagar mensagem: " + e.message);
  }
}

function enviarRelatorioParcialTelegram(shPainel) {
  if (!shPainel) {
    const ss = SpreadsheetApp.openById(SS_ID);
    shPainel = ss.getSheetByName('Painel');
  }

  const props = PropertiesService.getScriptProperties();
  const oldRelatorioId = props.getProperty('MSG_ID_RELATORIO_DIA');
  if (oldRelatorioId) apagarMensagemTelegram(oldRelatorioId);

  const g1 = Number(shPainel.getRange('B17').getValue()) || 0;
  const g2 = Number(shPainel.getRange('B18').getValue()) || 0;
  const g3 = Number(shPainel.getRange('B19').getValue()) || 0;
  const reds = Number(shPainel.getRange('B20').getValue()) || 0;
  const totalGreens = g1 + g2 + g3;
  const totalOp = totalGreens + reds;
  const taxa = totalOp > 0 ? ((totalGreens / totalOp) * 100).toFixed(1) : "0.0";

  const textoRelatorio =
    `📋 *RELATÓRIO PARCIAL DO DIA*\n\n` +
    `✅ *Acertos (Greens):* ${totalGreens}\n` +
    `   ├ Entrada 1: ${g1}\n` +
    `   ├ Entrada 2: ${g2}\n` +
    `   └ Entrada 3: ${g3}\n` +
    `❌ *Reds:* ${reds}\n` +
    `📈 *Assertividade:* ${taxa}%`;

  const novoId = enviarMensagemTelegram(textoRelatorio);
  if (novoId) props.setProperty('MSG_ID_RELATORIO_DIA', String(novoId));
}

function fecharDia() {
  const ss = SpreadsheetApp.openById(SS_ID);
  const shPainel = ss.getSheetByName('Painel');
  const shRes = ss.getSheetByName('Resumos');

  const giros = Number(shPainel.getRange('B14').getValue()) || 0;
  const g1 = Number(shPainel.getRange('B17').getValue()) || 0;
  const g2 = Number(shPainel.getRange('B18').getValue()) || 0;
  const g3 = Number(shPainel.getRange('B19').getValue()) || 0;
  const reds = Number(shPainel.getRange('B20').getValue()) || 0;
  const totalGreens = g1 + g2 + g3;
  const totalOp = totalGreens + reds;
  const taxa = totalOp > 0 ? ((totalGreens / totalOp) * 100).toFixed(1) + "%" : "0%";
  const dataHoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });

  shRes.appendRow([dataHoje, giros, totalGreens, g1, g2, g3, reds, taxa]);

  const totalLinhas = shRes.getLastRow();
  let semGreens = 0, semReds = 0, mesGreens = 0, mesReds = 0;

  if (totalLinhas >= 2) {
    const dadosRes = shRes.getRange(2, 1, totalLinhas - 1, 8).getValues();
    dadosRes.slice(-7).forEach(r => { semGreens += Number(r[2]); semReds += Number(r[6]); });
    dadosRes.slice(-30).forEach(r => { mesGreens += Number(r[2]); mesReds += Number(r[6]); });
  }

  const msgFinal =
    `🏁 *FECHAMENTO OFICIAL DO DIA (${dataHoje})*\n\n` +
    `✅ *Total de Acertos:* ${totalGreens}\n` +
    `   ├ Entrada 1: ${g1}\n` +
    `   ├ Entrada 2: ${g2}\n` +
    `   └ Entrada 3: ${g3}\n` +
    `❌ *Reds:* ${reds}\n` +
    `📈 *Taxa do Dia:* ${taxa}\n\n` +
    `📅 *Acumulado Semanal:* ${semGreens} Greens | ${semReds} Reds\n` +
    `📆 *Acumulado Mensal:* ${mesGreens} Greens | ${mesReds} Reds`;

  enviarMensagemTelegram(msgFinal);
  shPainel.getRange('B17:B20').setValues([[0], [0], [0], [0]]);
  PropertiesService.getScriptProperties().deleteProperty('MSG_ID_RELATORIO_DIA');
}

function doGet(e) {
  return jsonResponse({ status: 'online', timestamp: new Date().toLocaleString('pt-BR') });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
