
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const TABLE_ID = "rwbrzportrwa16rg";
const HISTORY_URL = "https://games.pragmaticplaylive.net/api/ui/statisticHistory";

let ultimoTeste = null;
let historicoRecebido = [];

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "online",
    projeto: "Teste API Pragmatic Play",
    mesa: TABLE_ID,
    mensagem: "Servidor funcionando."
  });
});

app.get("/api/testar-pragmatic", async (req, res) => {
  try {
    console.log("Iniciando consulta à API Pragmatic...");

    const resposta = await axios.get(HISTORY_URL, {
      params: {
        numberOfGames: 500,
        tableId: TABLE_ID
      },
      timeout: 20000,
      headers: {
        Accept: "application/json"
      }
    });

    const dados = resposta.data;

    if (String(dados.errorCode) !== "0") {
      throw new Error(
        "API respondeu: " + JSON.stringify(dados)
      );
    }

    if (!Array.isArray(dados.history)) {
      throw new Error("Histórico não encontrado na resposta.");
    }

    const resultados = dados.history.map(item => {
      const texto = String(item.gameResult || "").trim();
      const match = texto.match(
        /^(0|[1-9]|[12][0-9]|3[0-6])\s+(Red|Black|Green)$/i
      );

      if (!match || !item.gameId) return null;

      return {
        gameId: String(item.gameId),
        number: Number(match[1]),
        color: match[2].toLowerCase(),
        rawResult: texto
      };
    }).filter(Boolean);

    historicoRecebido = resultados;

    ultimoTeste = {
      horario: new Date().toISOString(),
      quantidadeRecebida: dados.history.length,
      quantidadeValida: resultados.length,
      primeiroResultado: resultados[0] || null,
      ultimoResultado: resultados[resultados.length - 1] || null
    };

    console.log("TESTE CONCLUÍDO:", ultimoTeste);

    return res.json({
      status: "success",
      mensagem: "Consulta realizada.",
      resultado: ultimoTeste,
      primeiros5: resultados.slice(0, 5)
    });

  } catch (erro) {
    console.error(
      "ERRO PRAGMATIC:",
      erro.response?.status || "",
      erro.message
    );

    return res.status(502).json({
      status: "error",
      codigoHTTP: erro.response?.status || null,
      mensagem: erro.message,
      respostaServidor: erro.response?.data || null
    });
  }
});

app.get("/api/historico-teste", (req, res) => {
  res.json({
    status: "success",
    quantidade: historicoRecebido.length,
    ultimoTeste,
    historico: historicoRecebido
  });
});

app.listen(PORT, () => {
  console.log("Servidor de teste iniciado na porta " + PORT);
});
