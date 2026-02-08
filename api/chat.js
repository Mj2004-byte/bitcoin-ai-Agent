
import 'dotenv/config';
const groqApiKey = process.env.GROQ_API_KEY;
import express from "express";
import cors from "cors";
import Groq from "groq-sdk";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

/* ------------------ APP SETUP ------------------ */
const app = express();
app.use(cors());
app.use(express.json());

/* ------------------ PATH SETUP ------------------ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");
const indexHtmlPath = path.join(publicDir, "index.html");

/* ------------------ STATIC FILES ------------------ */
app.use(express.static(publicDir));
app.get("/", (_req, res) => {
  if (fs.existsSync(indexHtmlPath)) {
    return res.sendFile(indexHtmlPath);
  }
  return res.status(404).send("index.html not found");
});

/* ------------------ HEALTH ------------------ */
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    groqConfigured: Boolean(process.env.GROQ_API_KEY)
  });
});

/* ------------------ GROQ CLIENT ------------------ */
let groqClient = null;
function getGroqClient() {
  if (groqClient) return groqClient;
  if (!process.env.GROQ_API_KEY) return null;
  groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groqClient;
}

if (!process.env.GROQ_API_KEY) {
  console.warn("⚠️ GROQ_API_KEY not set. Running in offline demo mode.");
}

/* ------------------ CHAT HISTORY ------------------ */
const History = [
  {
    role: "system",
    content:
      "You are an AI robot agent. You can do math, check prime numbers, " +
      "and fetch crypto prices. When using tools, explain results clearly."
  }
];

/* ------------------ TOOLS ------------------ */
const sum = (a, b) => a + b;

const prime = (n) => {
  if (n <= 1) return false;
  for (let i = 2; i <= Math.sqrt(n); i++) {
    if (n % i === 0) return false;
  }
  return true;
};

async function getCryptoPrice(coin) {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd`
  );
  if (!res.ok) throw new Error("Crypto fetch failed");
  return res.json();
}

/* ------------------ OFFLINE DEMO ------------------ */
async function runOfflineDemo(message) {
  const text = message.toLowerCase();

  const sumMatch = text.match(/(-?\d+)\s*\+\s*(-?\d+)/);
  if (sumMatch) {
    const result = sum(Number(sumMatch[1]), Number(sumMatch[2]));
    return { text: `Result: ${result}` };
  }

  if (text.includes("prime")) {
    const n = Number(text.match(/\d+/)?.[0]);
    if (!isNaN(n)) {
      return { text: `${n} is ${prime(n) ? "" : "not "}a prime number.` };
    }
  }

  if (text.includes("bitcoin") || text.includes("ethereum")) {
    const coin = text.includes("ethereum") ? "ethereum" : "bitcoin";
    const price = await getCryptoPrice(coin);
    return { text: `${coin.toUpperCase()} price: $${price[coin].usd}` };
  }

  return {
    text:
      "Offline demo mode.\nTry:\n- 12 + 34\n- Is 97 prime?\n- Bitcoin price"
  };
}

/* ------------------ GROQ TOOLS ------------------ */
const tools = [
  {
    type: "function",
    function: {
      name: "sum",
      description: "Add two numbers",
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
      name: "check_prime",
      description: "Check if a number is prime",
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
      name: "crypto_price",
      description: "Get crypto price in USD",
      parameters: {
        type: "object",
        properties: {
          coin: { type: "string" }
        },
        required: ["coin"]
      }
    }
  }
];

const toolMap = {
  sum: ({ num1, num2 }) => sum(num1, num2),
  check_prime: ({ number }) => prime(number),
  crypto_price: ({ coin }) => getCryptoPrice(coin)
};

/* ------------------ GROQ AGENT ------------------ */
async function runAgent(userMessage) {
  const groq = getGroqClient();
  if (!groq) throw new Error("Groq not configured");

  History.push({ role: "user", content: userMessage });

  const response = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: History,
    tools,
    tool_choice: "auto"
  });

  const msg = response.choices[0].message;

  if (msg.tool_calls?.length) {
    const call = msg.tool_calls[0];
    const args = JSON.parse(call.function.arguments);
    const result = await toolMap[call.function.name](args);

    History.push(msg);
    History.push({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(result)
    });

    const final = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: History
    });

    const content = final.choices[0].message.content;
    History.push({ role: "assistant", content });
    return content;
  }

  History.push({ role: "assistant", content: msg.content });
  return msg.content;
}

/* ------------------ CHAT ROUTE ------------------ */
async function chatHandler(req, res) {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: "Message required" });

  try {
    if (!process.env.GROQ_API_KEY) {
      const demo = await runOfflineDemo(message);
      return res.json({ response: demo.text });
    }

    const reply = await runAgent(message);
    res.json({ response: reply });
  } catch (err) {
    console.error("Chat error:", err);
    const fallback = await runOfflineDemo(message);
    res.json({
      response:
        fallback.text +
        "\n\n[Groq failed — offline fallback used]"
    });
  }
}

app.post("/chat", chatHandler);
app.post("/api/chat", chatHandler);

/* ------------------ START SERVER ------------------ */
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

export default app;

