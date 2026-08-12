import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
const PORT = 3000;

app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});
// New Endpoints Added

app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

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
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/market/analysis", async (req, res) => {
  const { ticker, marketData } = req.body;
  try {
    const prompt = `Perform technical and sentiment analysis on ${ticker} using the following data: ${JSON.stringify(marketData)}. Respond with your analysis.`;
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });
    res.json({ analysis: response.text });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/trade/signal", async (req, res) => {
  const { ticker, marketData } = req.body;
  try {
    const prompt = `Based on this data for ${ticker}: ${JSON.stringify(marketData)}, generate a trading signal.`;
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
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
    res.status(500).json({ error: error.message });
  }
});

// Existing code
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
    console.error(`Failed to fetch ${ticker}:`, err);
    // Return a synthesized price if scraping fails
    const synthPrice = 150 + Math.random() * 50;
    res.json({ ticker, price: synthPrice, prevClose: synthPrice * 0.995, simulated: true });
  }
});

let lastGeminiRequestTime = 0;
const GEMINI_COOLDOWN_MS = 60000; // 60 seconds rate limit protector

app.post("/api/tradebot/evaluate", async (req, res) => {
  const { marketData, portfolio, settings } = req.body;
  
  // Helper to generate rule-based fallback quantitative trades when Gemini API is rate-limited
  const generateQuantFallbackTrades = (m: any, p: any, s: any) => {
    const fallbackTrades: any[] = [];
    let availableCash = p.cash;
    const maxTradeSize = s.maxTradeSize || 5000;
    const riskMultiplier = s.riskLevel === 'Low' ? 0.05 : s.riskLevel === 'High' ? 0.20 : 0.10;
    const botType = s.botType || 'momentum';
    
    const tickers = Object.keys(m);
    
    // Sort tickers depending on Strategy to prioritize specific actions
    let sortedTickers = [...tickers];
    if (botType === 'momentum') {
      sortedTickers.sort((a, b) => {
        const changeA = m[a] ? ((m[a].price - (m[a].prevClose || m[a].price)) / (m[a].prevClose || m[a].price)) : 0;
        const changeB = m[b] ? ((m[b].price - (m[b].prevClose || m[b].price)) / (m[b].prevClose || m[b].price)) : 0;
        return changeB - changeA; // High momentum first
      });
    } else if (botType === 'value') {
      sortedTickers.sort((a, b) => {
        const changeA = m[a] ? ((m[a].price - (m[a].prevClose || m[a].price)) / (m[a].prevClose || m[a].price)) : 0;
        const changeB = m[b] ? ((m[b].price - (m[b].prevClose || m[b].price)) / (m[b].prevClose || m[b].price)) : 0;
        return changeA - changeB; // Most negative change first
      });
    }
    
    for (const ticker of sortedTickers) {
      const asset = m[ticker];
      if (!asset || typeof asset.price !== 'number') continue;
      
      const price = asset.price;
      const prevClose = asset.prevClose || price;
      const changePct = ((price - prevClose) / prevClose) * 100;
      const heldShares = p.holdings[ticker] || 0;
      
      if (botType === 'momentum') {
        // Buy if trending up (momentum breakout)
        if (changePct > 0.4 && heldShares === 0) {
          const maxSpend = Math.min(availableCash, maxTradeSize);
          const sharesToBuy = Math.floor((maxSpend * riskMultiplier) / price);
          if (sharesToBuy > 0) {
            fallbackTrades.push({
              ticker,
              action: "BUY",
              shares: sharesToBuy,
              reason: `[Quant Momentum] Asset is up +${changePct.toFixed(2)}% with positive breakout momentum.`
            });
            availableCash -= (sharesToBuy * price);
          }
        } else if (changePct < -0.4 && heldShares > 0) {
          // Sell if turning negative to safeguard portfolio
          fallbackTrades.push({
            ticker,
            action: "SELL",
            shares: heldShares,
            reason: `[Quant Momentum] Exiting stock to protect capital as trend reverses to ${changePct.toFixed(2)}%.`
          });
        }
      } 
      else if (botType === 'value') {
        // Buy if down significantly (contrarian dip-buying)
        if (changePct <= -1.0) {
          const maxSpend = Math.min(availableCash, maxTradeSize);
          const sharesToBuy = Math.floor((maxSpend * riskMultiplier) / price);
          if (sharesToBuy > 0) {
            fallbackTrades.push({
              ticker,
              action: "BUY",
              shares: sharesToBuy,
              reason: `[Quant Contrarian] Dip-buying oversold asset down ${changePct.toFixed(2)}% below yesterday close.`
            });
            availableCash -= (sharesToBuy * price);
          }
        } else if (changePct >= 1.5 && heldShares > 0) {
          // Sell on recovery rally to lock in profits
          fallbackTrades.push({
            ticker,
            action: "SELL",
            shares: heldShares,
            reason: `[Quant Contrarian] Realizing +${changePct.toFixed(2)}% returns on value recovery swing.`
          });
        }
      } 
      else if (botType === 'mean_reversion') {
        const history = asset.history || [];
        const avgPrice = history.length > 0 
          ? history.reduce((sum: number, val: number) => sum + val, 0) / history.length
          : (price + prevClose) / 2;
        
        const devPct = ((price - avgPrice) / avgPrice) * 100;
        
        if (devPct < -0.7) {
          const maxSpend = Math.min(availableCash, maxTradeSize);
          const sharesToBuy = Math.floor((maxSpend * riskMultiplier) / price);
          if (sharesToBuy > 0) {
            fallbackTrades.push({
              ticker,
              action: "BUY",
              shares: sharesToBuy,
              reason: `[Quant Reversion] Buying price deviation (${devPct.toFixed(2)}% below 20-tick rolling average).`
            });
            availableCash -= (sharesToBuy * price);
          }
        } else if (devPct > 0.7 && heldShares > 0) {
          fallbackTrades.push({
            ticker,
            action: "SELL",
            shares: Math.ceil(heldShares * 0.75),
            reason: `[Quant Reversion] Trimming overbought positions (${devPct.toFixed(2)}% above average).`
          });
        }
      } 
      else if (botType === 'scalper') {
        const history = asset.history || [];
        const lastTickChange = history.length >= 2 ? (price - history[history.length - 2]) : 0;
        
        if (lastTickChange < 0 && heldShares === 0) {
          const maxSpend = Math.min(availableCash, maxTradeSize * 0.5);
          const sharesToBuy = Math.floor((maxSpend * 0.15) / price);
          if (sharesToBuy > 0) {
            fallbackTrades.push({
              ticker,
              action: "BUY",
              shares: sharesToBuy,
              reason: `[Quant Scalper] Capturing quick entry on tick down of $${Math.abs(lastTickChange).toFixed(2)}.`
            });
            availableCash -= (sharesToBuy * price);
          }
        } else if (lastTickChange > 0 && heldShares > 0) {
          fallbackTrades.push({
            ticker,
            action: "SELL",
            shares: heldShares,
            reason: `[Quant Scalper] Closing scalping position on positive tick movement. Profit locked.`
          });
        }
      }
      else {
        // Balanced fallback for Custom User Bot / default
        if (changePct <= -1.2) {
          const maxSpend = Math.min(availableCash, maxTradeSize);
          const sharesToBuy = Math.floor((maxSpend * riskMultiplier) / price);
          if (sharesToBuy > 0) {
            fallbackTrades.push({
              ticker,
              action: "BUY",
              shares: sharesToBuy,
              reason: `[Quant Custom Bot] Executing trade on ${ticker} under general balanced parameters.`
            });
            availableCash -= (sharesToBuy * price);
          }
        } else if (changePct >= 1.8 && heldShares > 0) {
          fallbackTrades.push({
            ticker,
            action: "SELL",
            shares: heldShares,
            reason: `[Quant Custom Bot] Selling ${ticker} at $${price.toFixed(2)} under general rules.`
          });
        }
      }
      
      if (fallbackTrades.length >= 2) break;
    }
    return fallbackTrades;
  };

  const botType = settings.botType || 'momentum';
  let strategyInstructions = "";

  if (botType === 'momentum') {
    strategyInstructions = "Your strategy is MOMENTUM TRADING. You seek assets showing strong positive momentum (upward price trend, positive day change) to ride the trend. You are aggressive in entering trades when an asset is breaking out, and you sell quickly if the momentum reverses.";
  } else if (botType === 'value') {
    strategyInstructions = "Your strategy is VALUE INVESTING & CONTRARIAN DIP-BUYING. You seek high-quality assets that are down significantly on the day but are otherwise solid. You buy the dip when assets are cheap, and sell to lock in profits once they recover or rally.";
  } else if (botType === 'mean_reversion') {
    strategyInstructions = "Your strategy is MEAN REVERSION. You believe asset prices fluctuate around their moving average. Look at the price history of assets. If an asset's current price is significantly below its average price history, execute a BUY. If it is priced significantly above its average, execute a SELL to lock in profits.";
  } else if (botType === 'scalper') {
    strategyInstructions = "Your strategy is MICRO-SCALPING. You execute rapid, low-margin trades. You buy assets that show small downward dips and sell them immediately for 0.4% - 1% profits. You avoid holding any asset for too long, maintaining extremely high cash turnover.";
  } else if (botType === 'custom') {
    strategyInstructions = `Your strategy is a CUSTOM USER-DEFINED STRATEGY. You MUST strictly follow the user's rules: "${settings.customInstructions || "No custom instructions. Trade standard balanced."}"`;
  }

  const now = Date.now();
  if (now - lastGeminiRequestTime < GEMINI_COOLDOWN_MS) {
    const fallbackTrades = generateQuantFallbackTrades(marketData, portfolio, settings);
    const fallbackNames: Record<string, string> = {
      momentum: "Local Quant: Momentum Engine (Power Saver)",
      value: "Local Quant: Contrarian Engine (Power Saver)",
      mean_reversion: "Local Quant: Reversion Engine (Power Saver)",
      scalper: "Local Quant: Scalping Engine (Power Saver)",
      custom: "Local Quant: Custom Rules Engine (Power Saver)"
    };
    return res.json({ 
      trades: fallbackTrades, 
      engine: fallbackNames[botType] || "Quant Fallback Engine", 
      isFallback: true,
      message: "Cooldown active to safeguard API rate limits. Automatically routed to local high-speed quantitative algorithms."
    });
  }

  try {
    lastGeminiRequestTime = Date.now(); // Record the timestamp of the actual network request
    const prompt = `You are an AI quantitative trading bot operating in the Google Finance Live Playground.
Your personality and core instructions:
${strategyInstructions}

Here is the current state of the market:
${JSON.stringify(marketData, null, 2)}

Here is the current portfolio:
Cash: $${portfolio.cash}
Holdings: ${JSON.stringify(portfolio.holdings, null, 2)}

User Settings:
Risk Level: ${settings.riskLevel}
Max Trade Size: $${settings.maxTradeSize}

Based on this, what actions should be taken? You can choose to BUY or SELL assets. Ensure you don't spend more than the available cash, and don't sell more than you hold.
A BUY order cost cannot exceed the Max Trade Size. Limit to 1-3 trades max per cycle.
Respond with a JSON array of trades. If no actions, return an empty array.
`;

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
              shares: { type: Type.INTEGER, description: "Number of shares to trade" },
              reason: { type: Type.STRING, description: "Brief reason for this trade matching your selected strategy" }
            },
            required: ["ticker", "action", "shares", "reason"]
          }
        }
      }
    });

    const text = response.text || "[]";
    const trades = JSON.parse(text);
    
    // Set descriptive engine name based on chosen bot
    const botNames: Record<string, string> = {
      momentum: "Gemini 2.5 Flash: Momentum Hunter",
      value: "Gemini 2.5 Flash: Value Contrarian",
      mean_reversion: "Gemini 2.5 Flash: Reversion Quant",
      scalper: "Gemini 2.5 Flash: Micro-Scalper",
      custom: "Gemini 2.5 Flash: Custom User Bot"
    };
    
    res.json({ trades, engine: botNames[botType] || "Gemini 2.5 Flash", isFallback: false });

  } catch(e: any) {
    console.warn("Gemini API call failed or rate-limited. Falling back to Quant Engine.", e.message || e);
    const fallbackTrades = generateQuantFallbackTrades(marketData, portfolio, settings);
    
    const fallbackNames: Record<string, string> = {
      momentum: "Local Quant: Momentum Engine",
      value: "Local Quant: Contrarian Engine",
      mean_reversion: "Local Quant: Reversion Engine",
      scalper: "Local Quant: Scalping Engine",
      custom: "Local Quant: Custom Rules Engine"
    };
    
    res.json({ 
      trades: fallbackTrades, 
      engine: fallbackNames[botType] || "Quant Fallback Engine", 
      isFallback: true,
      message: "API rate limits handled. Automatically routed to the local high-frequency quantitative algorithm."
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
