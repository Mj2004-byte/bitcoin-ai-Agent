import "dotenv/config";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import Groq from "groq-sdk";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// ------------------ SETUP ------------------
let groqClient = null;

function getGroqClient() {
  if (groqClient) return groqClient;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  groqClient = new Groq({ apiKey });
  return groqClient;
}
app.get("/health", (req, res) => {
  res.json({ ok: true });
});


if (!process.env.GROQ_API_KEY) {
  console.warn(
    "⚠️ GROQ_API_KEY is not set. The server will start, but /chat will fail until you add GROQ_API_KEY to a .env file."
  );
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
const publicDir = path.join(__dirname, "..", "public");
const indexHtmlPath = path.join(publicDir, "index.html");

console.log("[AI_AGENT_BOOT]", {
  cwd: process.cwd(),
  __dirname,
  publicDir,
  indexHtmlExists: fs.existsSync(indexHtmlPath)
});

app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

app.get("/", (_req, res) => {
  if (fs.existsSync(indexHtmlPath)) {
    return res.sendFile(indexHtmlPath);
  }
  return res.status(404).send("index.html not found");
});

app.use(express.static(publicDir));

// In‑memory chat history (per server process)
const History = [
  {
    role: "system",
    content:
      "You are an AI robot agent that can optionally call tools to do math, check if a number is prime, or fetch crypto prices. " +
      "When you use tools, clearly explain what you did and include the result in natural language."
  }
];

// ------------------ LOCAL FUNCTIONS ------------------
function sum(num1, num2) {
  return num1 + num2;
}

function prime(num) {
  if (num < 2) return false;
  for (let i = 2; i <= Math.sqrt(num); i++) {
    if (num % i === 0) return false;
  }
  return true;
}

async function getcryptoprice(coin) {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch price for ${coin}`);
  }
  return await response.json();
}

function parseTwoNumbersForSum(text) {
  // Supports: "123 + 456", "Calculate 1234 + 5678"
  const m = text.match(/(-?\d+(?:\.\d+)?)\s*\+\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  return { num1: Number(m[1]), num2: Number(m[2]) };
}

function parseNumberForPrime(text) {
  // Supports: "Is 9973 prime?" "prime 9973"
  const m = text.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  return { number: Number(m[1]) };
}

function parseCoinForPrice(text) {
  const t = text.toLowerCase();
  if (t.includes("bitcoin") || t.includes("btc")) return { coin: "bitcoin" };
  if (t.includes("ethereum") || t.includes("eth")) return { coin: "ethereum" };
  // allow: "price of dogecoin" etc
  const m = t.match(/price\s+of\s+([a-z0-9-]+)/) || t.match(/([a-z0-9-]+)\s+price/);
  if (m) return { coin: m[1] };
  return null;
}

async function runOfflineDemo(userMessage) {
  const lower = userMessage.toLowerCase();

  const sumArgs = parseTwoNumbersForSum(userMessage);
  if (sumArgs) {
    const result = sum(sumArgs.num1, sumArgs.num2);
    return {
      text: `Result: ${sumArgs.num1} + ${sumArgs.num2} = ${result}`,
      toolCall: { name: "sum", args: sumArgs }
    };
  }

  if (lower.includes("prime")) {
    const primeArgs = parseNumberForPrime(userMessage);
    if (primeArgs) {
      const isPrime = prime(primeArgs.number);
      return {
        text: `${primeArgs.number} is ${isPrime ? "" : "not "}a prime number.`,
        toolCall: { name: "check_prime_number", args: primeArgs }
      };
    }
  }

  if (lower.includes("price") || lower.includes("crypto") || lower.includes("bitcoin") || lower.includes("ethereum")) {
    const coinArgs = parseCoinForPrice(userMessage);
    if (coinArgs) {
      const price = await getcryptoprice(coinArgs.coin);
      const usd = price?.[coinArgs.coin]?.usd;
      return {
        text: usd != null
          ? `${coinArgs.coin.toUpperCase()} price: $${usd} USD`
          : `I couldn't find a USD price for "${coinArgs.coin}". Try: bitcoin, ethereum.`,
        toolCall: { name: "get_crypto_price", args: coinArgs }
      };
    }
  }

  return {
    text:
      "Offline demo mode is active because GROQ_API_KEY is not set.\n" +
      "Try:\n" +
      "- Calculate 1234 + 5678\n" +
      "- Is 9973 prime?\n" +
      "- Bitcoin price\n" +
      "\nTo enable full AI chat, add GROQ_API_KEY to a .env file and restart the server.",
    toolCall: null
  };
}

// ------------------ TOOL DEFINITIONS ------------------
const tools = [
  {
    type: "function",
    function: {
      name: "sum",
      description: "Returns the sum of two numbers",
      parameters: {
        type: "object",
        properties: {
          num1: { type: "number" },
          num2: { type: "number" }
        },
        required: ["num1", "num2"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "check_prime_number",
      description: "Checks whether a number is prime",
      parameters: {
        type: "object",
        properties: {
          number: { type: "number" }
        },
        required: ["number"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_crypto_price",
      description: "Gets current crypto price in USD",
      parameters: {
        type: "object",
        properties: {
          coin: {
            type: "string",
            description: "Cryptocurrency name like bitcoin, ethereum"
          }
        },
        required: ["coin"]
      }
    }
  }
];

// ------------------ TOOL IMPLEMENTATIONS ------------------
const availableTools = {
  sum: ({ num1, num2 }) => sum(num1, num2),
  check_prime_number: ({ number }) => prime(number),
  get_crypto_price: ({ coin }) => getcryptoprice(coin)
};

// ------------------ CORE CHAT HANDLER ------------------
async function runAgent(userMessage) {
  const groq = getGroqClient();
  if (!groq) {
    throw new Error("GROQ_API_KEY is not configured on the server.");
  }

  const MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

  // Add the new user message to history
  History.push({ role: "user", content: userMessage });

  // First call: let the model decide if it wants to call a tool
  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: History,
    tools,
    tool_choice: "auto"
  });

  let message = response.choices[0].message;
  let toolCallInfo = null;

  // If Groq wants to call a function
  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolCall = message.tool_calls[0];
    const { name, arguments: argsJson } = toolCall.function;
    const args = JSON.parse(argsJson);

    console.log(`🔧 Function called: ${name}`);
    console.log("📦 Arguments:", args);

    const tool = availableTools[name];
    const result = await tool(args);

    // Store the assistant tool-call message
    History.push(message);

    // Store the tool result message
    History.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(result)
    });

    // Second call: ask the model to respond using the tool result
    const finalResponse = await groq.chat.completions.create({
      model: MODEL,
      messages: History
    });

    const finalMessage = finalResponse.choices[0].message;

    if (finalMessage?.content) {
      History.push({ role: "assistant", content: finalMessage.content });
    }

    toolCallInfo = { name, args };
    return { text: finalMessage.content, toolCall: toolCallInfo };
  }

  // No tool call – just a normal assistant reply
  if (message?.content) {
    History.push({ role: "assistant", content: message.content });
  }

  return { text: message.content, toolCall: null };
}

// ------------------ EXPRESS ROUTES ------------------
async function chatHandler(req, res) {
  const { message } = req.body || {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing 'message' field in request body." });
  }

  // If no API key, still keep the app usable in offline demo mode.
  if (!process.env.GROQ_API_KEY) {
    try {
      const demo = await runOfflineDemo(message);
      return res.json({ response: demo.text, toolCall: demo.toolCall });
    } catch (err) {
      console.error("❌ Offline demo error:", err);
      return res.status(500).json({ error: "Offline demo failed." });
    }
  }

  try {
    const result = await runAgent(message);
    return res.json({
      response: result.text,
      toolCall: result.toolCall
    });
  } catch (err) {
    console.error("❌ Error in /chat (Groq path):", err);

    // Graceful fallback: if Groq fails for any reason, use offline demo
    try {
      const demo = await runOfflineDemo(message);
      return res.json({
        response:
          demo.text +
          "\n\n[Note: Groq API call failed; you are seeing the offline/tool-based fallback response instead.]",
        toolCall: demo.toolCall
      });
    } catch (fallbackErr) {
      console.error("❌ Error in /chat (offline fallback):", fallbackErr);
      const safeMessage =
        (err && typeof err === "object" && "message" in err && err.message)
          ? String(err.message)
          : "Internal server error while processing the AI request.";
      return res
        .status(500)
        .json({ error: safeMessage });
    }
  }
}

app.post("/chat", chatHandler);
app.post("/api/chat", chatHandler);

app.get("/health", (_req, res) => {
  return res.json({
    ok: true,
    groqConfigured: Boolean(process.env.GROQ_API_KEY)
  });
});

// ------------------ START SERVER ------------------
async function startServer(initialPort) {
  const maxAttempts = 10;

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    const port = initialPort + attempt;
    try {
      const server = await new Promise((resolve, reject) => {
        const s = app.listen(port);
        s.once("listening", () => resolve(s));
        s.once("error", (err) => reject(err));
      });

      console.log(`🚀 Server running at http://localhost:${port}`);
      return server;
    } catch (err) {
      if (err && err.code === "EADDRINUSE" && attempt < maxAttempts) {
        console.warn(`⚠️ Port ${port} is in use. Trying ${port + 1}...`);
        continue;
      }

      console.error("❌ Failed to start server:", err);
      process.exit(1);
    }
  }

  console.error(`❌ Could not find a free port in range ${initialPort}-${initialPort + maxAttempts}`);
  process.exit(1);
}

const initialPort = Number(process.env.PORT) || 3000;
startServer(initialPort);
export default app;
