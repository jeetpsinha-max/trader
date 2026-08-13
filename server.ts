import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

export const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CORS Middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Rate Limiting Headers Middleware
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 60;

app.use((req, res, next) => {
  const ip = req.ip || "127.0.0.1";
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };

  if (now > record.resetTime) {
    record.count = 0;
    record.resetTime = now + RATE_LIMIT_WINDOW_MS;
  }

  record.count += 1;
  rateLimitMap.set(ip, record);

  res.setHeader("X-RateLimit-Limit", MAX_REQUESTS.toString());
  res.setHeader("X-RateLimit-Remaining", Math.max(0, MAX_REQUESTS - record.count).toString());
  res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetTime / 1000).toString());

  next();
});

const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  return new GoogleGenAI({
    apiKey: apiKey || "",
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
};

// 1. Health Check Endpoint
app.get("/api/health", (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  res.json({
    status: "ok",
    service: "trader-ai-api",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    geminiConfigured: Boolean(apiKey && apiKey !== "your_gemini_api_key_here")
  });
});

// 2. Gemini AI Agent Endpoint
app.post("/api/gemini/ask", async (req, res) => {
  try {
    const { prompt, model = "gemini-2.5-flash", systemInstruction } = req.body;
    if (!prompt) {
      return res.status(400).json({
        error: "Bad Request",
        message: "The 'prompt' field is required in request body."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "your_gemini_api_key_here") {
      return res.json({
        success: true,
        response: `[Trader AI Fallback Mode] Gemini API key not configured. Financial query: "${prompt}"`,
        fallback: true,
        model
      });
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: model || "gemini-2.5-flash",
      contents: prompt,
      ...(systemInstruction ? { config: { systemInstruction } } : {})
    });

    return res.json({
      success: true,
      response: response.text || "",
      fallback: false,
      model: model || "gemini-2.5-flash"
    });
  } catch (error: any) {
    console.error("Trader AI Gemini error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: error.message || "Financial AI calculations failed",
      fallback: true
    });
  }
});

// 3. Market Scraping Endpoint
app.get("/api/market/scrape", async (req, res) => {
  try {
    const url = 'https://finance.yahoo.com/';
    const response = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const $ = cheerio.load(response.data);
    const headlines: string[] = [];
    $('h3').each((i, el) => {
      const title = $(el).text().trim();
      if (title && headlines.length < 5) headlines.push(title);
    });
    res.json({ status: "success", headlines });
  } catch (error: any) {
    res.status(500).json({ error: error.message, headlines: ["Market headlines unavailable"] });
  }
});

// 4. Market Analysis Endpoint
app.post("/api/market/analysis", async (req, res) => {
  const { ticker, marketData } = req.body;
  if (!ticker) {
    return res.status(400).json({ error: "ticker is required" });
  }
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "your_gemini_api_key_here") {
      return res.json({
        analysis: `Fallback analysis for ${ticker}: Neutral sentiment with steady baseline volume.`,
        fallback: true
      });
    }

    const ai = getGeminiClient();
    const prompt = `Perform technical and sentiment analysis on ${ticker} using the following data: ${JSON.stringify(marketData)}. Respond with your analysis.`;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    res.json({ analysis: response.text });
  } catch (error: any) {
    res.status(500).json({ error: error.message, fallback: true });
  }
});

// 5. Trade Signal Endpoint
app.post("/api/trade/signal", async (req, res) => {
  const { ticker, marketData } = req.body;
  if (!ticker) {
    return res.status(400).json({ error: "ticker is required" });
  }
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "your_gemini_api_key_here") {
      return res.json({
        signal: "HOLD",
        confidence: 75,
        fallback: true
      });
    }

    const ai = getGeminiClient();
    const prompt = `Based on this data for ${ticker}: ${JSON.stringify(marketData)}, generate a trading signal.`;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            signal: { type: Type.STRING, description: "BUY, SELL, or HOLD" },
            confidence: { type: Type.NUMBER, description: "Confidence score between 0 and 100" }
          }
        }
      }
    });
    res.json(JSON.parse(response.text || "{}"));
  } catch (error: any) {
    res.status(500).json({ error: error.message, fallback: true });
  }
});

// 6. Stock Quote Endpoint
app.get("/api/quote/:ticker", async (req, res) => {
  const { ticker } = req.params;
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d`;
    
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json"
      },
      timeout: 5000
    });
    
    const meta = response.data.chart.result[0].meta;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose;
    
    if (isNaN(price)) {
      throw new Error("Price not found");
    }

    res.json({ ticker, price, prevClose });
  } catch (err) {
    const synthPrice = 150 + Math.random() * 50;
    res.json({ ticker, price: synthPrice, prevClose: synthPrice * 0.995, simulated: true });
  }
});

// 7. Tradebot Evaluation Engine
let lastGeminiRequestTime = 0;
const GEMINI_COOLDOWN_MS = 60000;

app.post("/api/tradebot/evaluate", async (req, res) => {
  const { marketData, portfolio, settings } = req.body;
  if (!marketData || !portfolio) {
    return res.status(400).json({ error: "marketData and portfolio are required" });
  }
  
  const generateQuantFallbackTrades = (m: any, p: any, s: any) => {
    const fallbackTrades: any[] = [];
    let availableCash = p.cash || 10000;
    const maxTradeSize = (s && s.maxTradeSize) || 5000;
    const tickers = Object.keys(m);
    
    for (const ticker of tickers) {
      const asset = m[ticker];
      if (!asset || typeof asset.price !== 'number') continue;
      const price = asset.price;
      const prevClose = asset.prevClose || price;
      const changePct = ((price - prevClose) / prevClose) * 100;
      const heldShares = (p.holdings && p.holdings[ticker]) || 0;
      
      if (changePct < -1.0) {
        const maxSpend = Math.min(availableCash, maxTradeSize);
        const sharesToBuy = Math.floor((maxSpend * 0.1) / price);
        if (sharesToBuy > 0) {
          fallbackTrades.push({
            ticker,
            action: "BUY",
            shares: sharesToBuy,
            reason: `[Quant Fallback] Dip buying asset down ${changePct.toFixed(2)}%.`
          });
          availableCash -= (sharesToBuy * price);
        }
      } else if (changePct > 1.5 && heldShares > 0) {
        fallbackTrades.push({
          ticker,
          action: "SELL",
          shares: heldShares,
          reason: `[Quant Fallback] Realizing gain of +${changePct.toFixed(2)}%.`
        });
      }
      if (fallbackTrades.length >= 2) break;
    }
    return fallbackTrades;
  };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    const fallbackTrades = generateQuantFallbackTrades(marketData, portfolio, settings || {});
    return res.json({
      trades: fallbackTrades,
      engine: "Local Quant Fallback Engine",
      isFallback: true,
      message: "Gemini API key not configured. Using local quantitative engine."
    });
  }

  const now = Date.now();
  if (now - lastGeminiRequestTime < GEMINI_COOLDOWN_MS) {
    const fallbackTrades = generateQuantFallbackTrades(marketData, portfolio, settings || {});
    return res.json({ 
      trades: fallbackTrades, 
      engine: "Local Quant Fallback Engine (Rate-Limit Protected)", 
      isFallback: true,
      message: "Cooldown active to safeguard API limits. Using local quantitative engine."
    });
  }

  try {
    lastGeminiRequestTime = Date.now();
    const prompt = `Analyze market data and suggest algorithmic trades: ${JSON.stringify(marketData)}`;
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              ticker: { type: Type.STRING },
              action: { type: Type.STRING, description: "BUY or SELL" },
              shares: { type: Type.INTEGER },
              reason: { type: Type.STRING }
            },
            required: ["ticker", "action", "shares", "reason"]
          }
        }
      }
    });

    const trades = JSON.parse(response.text || "[]");
    return res.json({ trades, engine: "Gemini 2.5 Flash Quant Engine", isFallback: false });
  } catch (e: any) {
    const fallbackTrades = generateQuantFallbackTrades(marketData, portfolio, settings || {});
    return res.json({
      trades: fallbackTrades,
      engine: "Local Quant Fallback Engine",
      isFallback: true,
      message: "API error encountered. Routed to quantitative engine."
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, () => {
    console.log(`Trader Server running on http://localhost:${PORT}`);
  });
}

if (process.env.NODE_ENV !== "test") {
  startServer();
}
