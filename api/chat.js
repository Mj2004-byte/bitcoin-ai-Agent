import "dotenv/config";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
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

/* ------------------ LOGGING ------------------ */

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

/* ------------------ STATIC FILES ------------------ */

app.use(express.static(publicDir));

app.get("/", (_req, res) => {
  if (fs.existsSync(indexHtmlPath)) {
    return res.sendFile(indexHtmlPath);
  }
  return res.status(404).send("index.html not found");
});

/* ------------------ GROQ CLIENT ------------------ */

let groqClient = null;

function getGroqClient() {
  if (groqClient) return groqClient;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  groqClient = new Groq({ apiKey });
  return groqClient;
}

if (!process.env.GROQ_API_KEY) {
  console.warn(
    "⚠️ GROQ_API_KEY not set. Server will run in offline demo mode."
  );
}

/* ------------------ CHAT HISTORY ------------------ */

const History = [
  {
    role: "system",
    content:
      "You are an AI robot agent that can optionally call tools to do math, " +
      "check if a number is prime, or fetch crypto prices."
  }
];

/* ------------------ LOCAL TOOLS ------------------ */

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
  return response.json();
}

/* ------------------ OFFLINE DEMO ------------------ */

async function runOfflineDemo(message) {
  const lower = message.toLowerCase();

  if (message.includes("+")) {
    const m = message.match(/(-?\d+)\s*\+\s*(-?\d+)/);
    if (m) {
      const result = sum(Number(m[1]), Number(m[2]));
      return { text: `Result: ${m[1]} + ${m[2]} = ${result}` };
    }
  }

  if (lower.includes("prime")) {
    const m = message.match(/(\d+)/);
    if (m) {
      return {
        text: `${m[1]} is ${prime(Number(m[1])) ? "" : "not "}a prime number.`
      };
    }
  }

  if (lower.includes("bitcoin") || lower.includes("ethereum")) {
    const coin = lower.includes("ethereum") ? "ethereum" : "bitcoin";
    const price = await getcryptoprice(coin);
    return {
      text: `${coin.toUpperCase()} price: $${price[coin].usd} USD`
    };
  }

  return {
    text:
      "Offline demo mode.\nTry:\n- 12 + 34\n- Is 97 prime?\n- Bitcoin price"
  };
}

/* ------------------ CHAT HANDLER ------------------ */

async function chatHandler(req, res) {
  const { message } = req.body || {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Message is required" });
  }

  if (!process.env.GROQ_API_KEY) {
    const demo = await runOfflineDemo(message);
    return res.json({ response: demo.text });
  }

  try {
    const groq = getGroqClient();

    History.push({ role: "user", content: message });

    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: History
    });

    const reply = response.choices[0].message.content;
    History.push({ role: "assistant", content: reply });

    return res.json({ response: reply });
  } catch (err) {
    console.error("Groq error:", err);
    const fallback = await runOfflineDemo(message);
    return res.json({
      response:
        fallback.text +
        "\n\n[Groq failed — fallback response used]"
    });
  }
}

/* ------------------ ROUTES ------------------ */

app.post("/chat", chatHandler);
app.post("/api/chat", chatHandler);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    groqConfigured: Boolean(process.env.GROQ_API_KEY)
  });
});

/* ------------------ START SERVER ------------------ */

async function startServer(initialPort) {
  const maxAttempts = 10;

  for (let i = 0; i <= maxAttempts; i++) {
    const port = initialPort + i;
    try {
      const server = app.listen(port, () => {
        console.log(`🚀 Server running at http://localhost:${port}`);
      });
      return server;
    } catch (err) {
      if (err.code !== "EADDRINUSE") throw err;
      console.warn(`⚠️ Port ${port} busy, trying next...`);
    }
  }

  console.error("❌ No available ports found");
  process.exit(1);
}

const initialPort = Number(process.env.PORT) || 3000;
startServer(initialPort);

export default app;
