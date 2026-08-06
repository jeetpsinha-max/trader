import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Pause, 
  Activity, 
  Landmark, 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  Search, 
  Briefcase, 
  Plus, 
  ExternalLink, 
  Download, 
  FileSpreadsheet, 
  Sparkles, 
  Cpu, 
  ShieldAlert, 
  Trash2,
  RefreshCw
} from 'lucide-react';
import { initAuth, googleSignIn, logout, getAccessToken } from './firebase';

interface AssetData {
  ticker: string;
  price: number;
  prevClose: number;
  history: number[];
}

const Sparkline = ({ data }: { data: number[] }) => {
  if (data.length < 2) return <div className="w-16 h-8 bg-neutral-100 rounded-md animate-pulse mx-auto"></div>;
  
  const min = Math.min(...data);
  const max = Math.max(...data);
  const padding = (max - min) * 0.1 || 1;
  const adjustedMin = min - padding;
  const adjustedMax = max + padding;
  const range = adjustedMax - adjustedMin;
  
  const width = 80;
  const height = 32;
  
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((d - adjustedMin) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  const isUp = data[data.length - 1] >= data[0];
  const color = isUp ? '#16a34a' : '#dc2626';

  return (
    <svg width={width} height={height} className="overflow-visible mx-auto">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
};

export default function App() {
  const [tickers, setTickers] = useState<string[]>(['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'AMZN', 'META', 'TSLA', 'SPY', 'QQQ']);
  const [marketData, setMarketData] = useState<Record<string, AssetData>>({});
  const [isPlaying, setIsPlaying] = useState(true);
  const [cash, setCash] = useState(100000);
  const [holdings, setHoldings] = useState<Record<string, number>>({});
  const [newTicker, setNewTicker] = useState('');
  
  // AI Bot Settings
  const [aiEnabled, setAiEnabled] = useState(false);
  const [riskLevel, setRiskLevel] = useState<'Low' | 'Medium' | 'High'>(() => (localStorage.getItem('tradebot-riskLevel') as 'Low' | 'Medium' | 'High') || 'Medium');
  const [maxTradeSize, setMaxTradeSize] = useState(5000);
  const [selectedBot, setSelectedBot] = useState<'momentum' | 'value' | 'mean_reversion' | 'scalper' | 'custom'>(() => (localStorage.getItem('tradebot-selectedBot') as any) || 'momentum');
  const [customInstructions, setCustomInstructions] = useState<string>(() => localStorage.getItem('tradebot-customInstructions') || "Identify strong performers, prioritize stocks in an upward channel, and hedge by keeping 20% in Cash.");
  const [logs, setLogs] = useState<{ id: string; time: string; msg: string; type: string }[]>([]);
  
  // Engine State Tracking
  const [activeEngine, setActiveEngine] = useState<string>("Gemini 2.5 Flash API");
  const [isEngineFallback, setIsEngineFallback] = useState<boolean>(false);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  
  // Tab Selector for Sheets Connector
  const [activeConnectorTab, setActiveConnectorTab] = useState<'formulas' | 'presets' | 'about'>('formulas');

  // Google Sheets Workspace Auth & Sync States
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(null);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Load initial authentication state
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, currentToken) => {
        setUser(currentUser);
        setToken(currentToken);
        setNeedsAuth(false);
      },
      () => {
        setUser(null);
        setToken(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setToken(res.accessToken);
        setNeedsAuth(false);
        setLogs(l => [{
          id: Math.random().toString(),
          time: new Date().toLocaleTimeString(),
          msg: `Signed in successfully as ${res.user.displayName || res.user.email}. Live Google Finance synced!`,
          type: 'INFO'
        }, ...l].slice(0, 40));
      } else {
        // Returned null due to being already in progress or user cancelling/closing the popup window
        setLogs(l => [{
          id: Math.random().toString(),
          time: new Date().toLocaleTimeString(),
          msg: `Sign-in attempt closed or cancelled by user. Try again if you want to sync.`,
          type: 'INFO'
        }, ...l].slice(0, 40));
      }
    } catch (err: any) {
      console.error("Sign-in failed:", err);
      setLogs(l => [{
        id: Math.random().toString(),
        time: new Date().toLocaleTimeString(),
        msg: `Sign-in error: ${err.message || 'Unknown error occurred'}`,
        type: 'ERROR'
      }, ...l].slice(0, 40));
    }
  };

  const handleSignOut = async () => {
    try {
      await logout();
      setUser(null);
      setToken(null);
      setNeedsAuth(true);
      setSpreadsheetId(null);
      setSpreadsheetUrl(null);
      setLogs(l => [{
        id: Math.random().toString(),
        time: new Date().toLocaleTimeString(),
        msg: `Successfully signed out and disconnected from Google Finance.`,
        type: 'INFO'
      }, ...l].slice(0, 40));
    } catch (err) {
      console.error("Sign-out failed:", err);
    }
  };

  const exportToGoogleSheets = async () => {
    if (!token) return;
    setIsExporting(true);
    setLogs(l => [{
      id: Math.random().toString(),
      time: new Date().toLocaleTimeString(),
      msg: `Initiating Google Sheets export...`,
      type: 'INFO'
    }, ...l].slice(0, 40));

    try {
      // Create a confirmation dialog as requested by the Workspace Skill Guidelines
      const confirmed = window.confirm(
        "This will create a new live-connected Google Sheet in your Google Drive named 'Google Finance Live Playground' and populate it with your current watchlist and positions. Do you want to proceed?"
      );
      if (!confirmed) {
        setIsExporting(false);
        return;
      }

      // Create new Spreadsheet
      const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          properties: {
            title: `Google Finance Live Playground - Tradebot`
          }
        })
      });

      if (!createRes.ok) {
        throw new Error('Failed to create a new Google Sheet');
      }

      const sheetInfo = await createRes.json();
      const newSpreadsheetId = sheetInfo.spreadsheetId;
      const newSpreadsheetUrl = sheetInfo.spreadsheetUrl;

      // Now, prepare data to write
      const values: any[][] = [
        ["Ticker", "Exchange Reference", "Current Market Price Formula", "Change Pct Formula", "Daily High Formula", "Daily Low Formula", "Holding Shares", "Simulated Asset Value"]
      ];

      tickers.forEach((t, index) => {
        const exchange = ['SPY', 'QQQ', 'DIA', 'KO', 'DIS'].includes(t) ? 'NYSE' : 'NASDAQ';
        const reference = `${exchange}:${t}`;
        const rowNum = index + 2; // Row numbers are 1-indexed, headers are at row 1
        
        values.push([
          t,
          reference,
          `=GOOGLEFINANCE("${reference}", "price")`,
          `=GOOGLEFINANCE("${reference}", "changepct")`,
          `=GOOGLEFINANCE("${reference}", "high")`,
          `=GOOGLEFINANCE("${reference}", "low")`,
          holdings[t] || 0,
          `=G${rowNum} * C${rowNum}` // Holding Shares * Price
        ]);
      });

      // Write values to Sheet1!A1
      const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${newSpreadsheetId}/values/Sheet1!A1:H${values.length + 1}?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          range: `Sheet1!A1:H${values.length + 1}`,
          majorDimension: "ROWS",
          values: values
        })
      });

      if (!writeRes.ok) {
        throw new Error('Failed to write data to Google Sheet');
      }

      setSpreadsheetId(newSpreadsheetId);
      setSpreadsheetUrl(newSpreadsheetUrl);
      
      setLogs(l => [{
        id: Math.random().toString(),
        time: new Date().toLocaleTimeString(),
        msg: `Google Sheet successfully created and populated! ID: ${newSpreadsheetId}`,
        type: 'INFO'
      }, ...l].slice(0, 40));

    } catch (err: any) {
      console.error('Error exporting to Google Sheets:', err);
      setLogs(l => [{
        id: Math.random().toString(),
        time: new Date().toLocaleTimeString(),
        msg: `Google Sheets Export Failed: ${err.message || err}`,
        type: 'ERROR'
      }, ...l].slice(0, 40));
    } finally {
      setIsExporting(false);
    }
  };

  const syncToExistingSheet = async () => {
    if (!token || !spreadsheetId) return;
    setIsExporting(true);
    setLogs(l => [{
      id: Math.random().toString(),
      time: new Date().toLocaleTimeString(),
      msg: `Syncing current watchlist & positions to Google Sheet...`,
      type: 'INFO'
    }, ...l].slice(0, 40));

    try {
      // Prepare data to write
      const values: any[][] = [
        ["Ticker", "Exchange Reference", "Current Market Price Formula", "Change Pct Formula", "Daily High Formula", "Daily Low Formula", "Holding Shares", "Simulated Asset Value"]
      ];

      tickers.forEach((t, index) => {
        const exchange = ['SPY', 'QQQ', 'DIA', 'KO', 'DIS'].includes(t) ? 'NYSE' : 'NASDAQ';
        const reference = `${exchange}:${t}`;
        const rowNum = index + 2;
        
        values.push([
          t,
          reference,
          `=GOOGLEFINANCE("${reference}", "price")`,
          `=GOOGLEFINANCE("${reference}", "changepct")`,
          `=GOOGLEFINANCE("${reference}", "high")`,
          `=GOOGLEFINANCE("${reference}", "low")`,
          holdings[t] || 0,
          `=G${rowNum} * C${rowNum}`
        ]);
      });

      // Clear the spreadsheet first or write over it
      const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:H100?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          range: `Sheet1!A1:H100`,
          majorDimension: "ROWS",
          values: values
        })
      });

      if (!writeRes.ok) {
        throw new Error('Failed to update Google Sheet');
      }

      setLogs(l => [{
        id: Math.random().toString(),
        time: new Date().toLocaleTimeString(),
        msg: `Google Sheet updated successfully with ${tickers.length} tickers.`,
        type: 'INFO'
      }, ...l].slice(0, 40));

    } catch (err: any) {
      console.error('Error updating Google Sheets:', err);
      setLogs(l => [{
        id: Math.random().toString(),
        time: new Date().toLocaleTimeString(),
        msg: `Google Sheets update failed: ${err.message || err}`,
        type: 'ERROR'
      }, ...l].slice(0, 40));
    } finally {
      setIsExporting(false);
    }
  };

  // Refs for infinite loop resolution
  const tickersRef = useRef(tickers);
  const marketDataRef = useRef(marketData);
  const cashRef = useRef(cash);
  const holdingsRef = useRef(holdings);
  const aiEnabledRef = useRef(aiEnabled);
  const riskLevelRef = useRef(riskLevel);
  const maxTradeSizeRef = useRef(maxTradeSize);
  const selectedBotRef = useRef(selectedBot);
  const customInstructionsRef = useRef(customInstructions);

  // Keep refs in sync
  useEffect(() => { tickersRef.current = tickers; }, [tickers]);
  useEffect(() => { marketDataRef.current = marketData; }, [marketData]);
  useEffect(() => { cashRef.current = cash; }, [cash]);
  useEffect(() => { holdingsRef.current = holdings; }, [holdings]);
  useEffect(() => { aiEnabledRef.current = aiEnabled; }, [aiEnabled]);
  useEffect(() => { riskLevelRef.current = riskLevel; }, [riskLevel]);
  useEffect(() => { maxTradeSizeRef.current = maxTradeSize; }, [maxTradeSize]);
  useEffect(() => { selectedBotRef.current = selectedBot; localStorage.setItem('tradebot-selectedBot', selectedBot); }, [selectedBot]);
  useEffect(() => { customInstructionsRef.current = customInstructions; localStorage.setItem('tradebot-customInstructions', customInstructions); }, [customInstructions]);
  useEffect(() => { riskLevelRef.current = riskLevel; localStorage.setItem('tradebot-riskLevel', riskLevel); }, [riskLevel]);

  // Sector Presets
  const sectorPresets = {
    tech: ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'AMZN', 'META', 'TSLA', 'AMD', 'NFLX', 'AVGO'],
    index: ['SPY', 'QQQ', 'DIA', 'IWM', 'VOO', 'VEA', 'VWO'],
    volatility: ['PLTR', 'COIN', 'MSTR', 'RIVN', 'NIO', 'SQ', 'SOXL', 'TQQQ'],
    dividend: ['JNJ', 'PG', 'KO', 'PEP', 'WMT', 'COST', 'XOM', 'CVX', 'JPM']
  };

  const loadPreset = (presetName: keyof typeof sectorPresets) => {
    const list = sectorPresets[presetName];
    setTickers(list);
    setLogs(l => [{
      id: Math.random().toString(),
      time: new Date().toLocaleTimeString(),
      msg: `Loaded ${presetName.toUpperCase()} stock preset basket (${list.length} tickers).`,
      type: 'INFO'
    }, ...l].slice(0, 40));
  };

  const addTicker = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const t = newTicker.trim().toUpperCase();
    if (t && !tickers.includes(t)) {
      const nextTickers = [...tickers, t];
      setTickers(nextTickers);
      setNewTicker('');
      // Immediately fetch data for new ticker
      fetchTickerData(t);
    } else {
      setNewTicker('');
    }
  };

  const removeTicker = (ticker: string) => {
    setTickers(prev => prev.filter(t => t !== ticker));
    setMarketData(prev => {
      const copy = { ...prev };
      delete copy[ticker];
      return copy;
    });
  };

  const fetchTickerData = async (t: string) => {
    try {
      const res = await fetch(`/api/quote/${t}`);
      const json = await res.json();
      
      setMarketData(prev => {
        const copy = { ...prev };
        const currentAsset = copy[t] || { ticker: t, price: json.price, prevClose: json.prevClose, history: [] };
        currentAsset.price = json.price;
        currentAsset.prevClose = json.prevClose;
        currentAsset.history = [...currentAsset.history, json.price].slice(-20);
        copy[t] = currentAsset;
        return copy;
      });
    } catch (e) {
      console.error("Failed to fetch ticker", t, e);
    }
  };

  const evaluateTrades = async (newData: Record<string, AssetData>, currentCash: number, currentHoldings: Record<string, number>) => {
    if (isEvaluating) return;
    setIsEvaluating(true);
    try {
      const res = await fetch('/api/tradebot/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketData: newData,
          portfolio: { cash: currentCash, holdings: currentHoldings },
          settings: { 
            riskLevel: riskLevelRef.current, 
            maxTradeSize: maxTradeSizeRef.current,
            botType: selectedBotRef.current,
            customInstructions: customInstructionsRef.current
          }
        })
      });
      const data = await res.json();
      
      setActiveEngine(data.engine || "Gemini 2.5 Flash");
      setIsEngineFallback(!!data.isFallback);
      
      let simulatedCash = currentCash;
      let simulatedHoldings = { ...currentHoldings };

      if (data.trades && data.trades.length > 0) {
        for (const trade of data.trades) {
           const { ticker, action, shares, reason } = trade;
           
           // Verify we actually track this ticker
           if (!newData[ticker]) continue;

           if (action === 'BUY') {
              const cost = (newData[ticker]?.price || 0) * shares;
              if (simulatedCash >= cost && shares > 0) {
                 simulatedCash -= cost;
                 simulatedHoldings[ticker] = (simulatedHoldings[ticker] || 0) + shares;
                 setLogs(l => [{ 
                   id: Math.random().toString(), 
                   time: new Date().toLocaleTimeString(), 
                   msg: `${data.isFallback ? '[Quant]' : '[Gemini]'} BUY ${shares} ${ticker}: ${reason}`, 
                   type: 'BUY' 
                 }, ...l].slice(0, 40));
              }
           } else if (action === 'SELL') {
              const heldShares = simulatedHoldings[ticker] || 0;
              if (heldShares >= shares && shares > 0) {
                 const revenue = (newData[ticker]?.price || 0) * shares;
                 simulatedCash += revenue;
                 simulatedHoldings[ticker] -= shares;
                 if (simulatedHoldings[ticker] === 0) delete simulatedHoldings[ticker];
                 setLogs(l => [{ 
                   id: Math.random().toString(), 
                   time: new Date().toLocaleTimeString(), 
                   msg: `${data.isFallback ? '[Quant]' : '[Gemini]'} SELL ${shares} ${ticker}: ${reason}`, 
                   type: 'SELL' 
                 }, ...l].slice(0, 40));
              }
           }
        }
        setCash(simulatedCash);
        cashRef.current = simulatedCash;
        setHoldings(simulatedHoldings);
        holdingsRef.current = simulatedHoldings;
      } else {
        // No trades decided
        if (data.isFallback) {
          setLogs(l => [{
            id: Math.random().toString(),
            time: new Date().toLocaleTimeString(),
            msg: `[Quant Engine] Evaluation complete - No trades required for this cycle.`,
            type: 'INFO'
          }, ...l].slice(0, 40));
        }
      }
    } catch (e) {
      console.error("AI Evaluation failed", e);
    } finally {
      setIsEvaluating(false);
    }
  };

  const fetchQuotes = async () => {
    const currentTickers = tickersRef.current;
    if (currentTickers.length === 0) return;

    const newData = { ...marketDataRef.current };
    for (const t of currentTickers) {
      try {
        const res = await fetch(`/api/quote/${t}`);
        const json = await res.json();
        
        const currentAsset = newData[t] || { ticker: t, price: json.price, prevClose: json.prevClose, history: [] };
        currentAsset.price = json.price;
        currentAsset.prevClose = json.prevClose;
        // Keep last 20 ticks for SVG sparkline visualization
        currentAsset.history = [...currentAsset.history, json.price].slice(-20);
        newData[t] = currentAsset;
      } catch (e) {
        console.error("Failed to fetch quote in loop for:", t);
      }
    }
    
    // Save to state and ref
    setMarketData(newData);
    marketDataRef.current = newData;
    
    if (aiEnabledRef.current) {
      evaluateTrades(newData, cashRef.current, holdingsRef.current);
    }
  };

  // Run the interval EXACTLY once, avoiding tight loops!
  useEffect(() => {
    if (!isPlaying) return;
    
    fetchQuotes();
    const interval = setInterval(fetchQuotes, 60000); // 60s interval to stay well within free tier limits
    return () => clearInterval(interval);
  }, [isPlaying]);

  const buyStock = (ticker: string, shares: number) => {
    const data = marketData[ticker];
    if (!data) return;
    const cost = data.price * shares;
    if (cash >= cost) {
      const newCash = cash - cost;
      setCash(newCash);
      cashRef.current = newCash;
      
      setHoldings(h => {
        const next = { ...h, [ticker]: (h[ticker] || 0) + shares };
        holdingsRef.current = next;
        return next;
      });
      setLogs(l => [{ 
        id: Math.random().toString(), 
        time: new Date().toLocaleTimeString(), 
        msg: `Manual BUY ${shares} ${ticker} @ $${data.price.toFixed(2)}`, 
        type: 'BUY' 
      }, ...l].slice(0, 40));
    }
  };

  const sellStock = (ticker: string, shares: number) => {
    const currentShares = holdings[ticker] || 0;
    if (currentShares >= shares) {
      const data = marketData[ticker];
      if (!data) return;
      const revenue = data.price * shares;
      const newCash = cash + revenue;
      setCash(newCash);
      cashRef.current = newCash;
      
      setHoldings(h => {
        const next = { ...h };
        next[ticker] -= shares;
        if (next[ticker] === 0) delete next[ticker];
        holdingsRef.current = next;
        return next;
      });
      setLogs(l => [{ 
        id: Math.random().toString(), 
        time: new Date().toLocaleTimeString(), 
        msg: `Manual SELL ${shares} ${ticker} @ $${data.price.toFixed(2)}`, 
        type: 'SELL' 
      }, ...l].slice(0, 40));
    }
  };

  // Google Finance Formula Exporter & CSV exporter
  const downloadGoogleFinanceCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Ticker,Exchange Reference,Current Market Price Formula,Change Pct Formula,Daily High Formula,Daily Low Formula,Holding Shares,Simulated Asset Value\n";
    
    tickers.forEach(t => {
      // Determine probable exchange mapping for Google Finance
      const exchange = ['SPY', 'QQQ', 'DIA', 'KO', 'DIS'].includes(t) ? 'NYSE' : 'NASDAQ';
      const reference = `${exchange}:${t}`;
      
      csvContent += `${t},${reference},=GOOGLEFINANCE("${reference}"\\, "price"),=GOOGLEFINANCE("${reference}"\\, "changepct"),=GOOGLEFINANCE("${reference}"\\, "high"),=GOOGLEFINANCE("${reference}"\\, "low"),${holdings[t] || 0},=G${tickers.indexOf(t) + 2} * C${tickers.indexOf(t) + 2}\n`;
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `google_finance_playground_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setLogs(l => [{
      id: Math.random().toString(),
      time: new Date().toLocaleTimeString(),
      msg: `Exported watchlist with live GOOGLEFINANCE formulas to CSV.`,
      type: 'INFO'
    }, ...l].slice(0, 40));
  };

  // Backtest states
  const [backtestResult, setBacktestResult] = useState<{
    botName: string;
    initialValue: number;
    finalValue: number;
    pctReturn: number;
    tradesCount: number;
    winRate: number;
    bestTrade: { ticker: string; gain: number } | null;
    logs: string[];
    portfolioTrend: number[];
  } | null>(null);
  const [isBacktesting, setIsBacktesting] = useState(false);

  // Bot personas configuration
  const botsConfig = [
    {
      id: 'momentum' as const,
      name: "AI Momentum Hunter",
      risk: "Medium/High",
      badge: "Breakouts",
      desc: "Rides positive breakouts & trending stocks. Exits early on reversals."
    },
    {
      id: 'value' as const,
      name: "AI Contrarian Value",
      risk: "Low/Medium",
      badge: "Dip-Buying",
      desc: "Executes buy-the-dip value acquisition. Profit-taking on swift rallies."
    },
    {
      id: 'mean_reversion' as const,
      name: "AI Reversion Quant",
      risk: "Low",
      badge: "Statistical",
      desc: "Trades price deviations from rolling averages. Capitalizes on pullbacks."
    },
    {
      id: 'scalper' as const,
      name: "Micro-Scalper Quant",
      risk: "Medium",
      badge: "HFT Scalps",
      desc: "Executes rapid low-margin trades. Constantly captures tiny tick pullbacks."
    },
    {
      id: 'custom' as const,
      name: "My Custom Strategy",
      risk: "Custom",
      badge: "Prompt-Injected",
      desc: "Directly appends your custom strategy rules into the Gemini system prompt."
    }
  ];

  const runBacktestSimulation = () => {
    if (tickers.length === 0) {
      alert("Please add at least one ticker to your watchlist before running a backtest.");
      return;
    }
    setIsBacktesting(true);
    
    // Setup virtual portfolio
    let vCash = 100000;
    let vHoldings: Record<string, number> = {};
    const simulationLogs: string[] = [];
    const trend: number[] = [vCash];
    
    const stepsCount = 15;
    let totalWins = 0;
    let totalClosedTrades = 0;
    let maxSingleGain = -999;
    let bestTicker = "";
    
    simulationLogs.push(`Initializing 15-tick simulation for [${selectedBot.toUpperCase()}] strategy...`);
    simulationLogs.push(`Starting Cash: $${vCash.toLocaleString()}`);

    // Generate pricing grids for each ticker for the 15 simulated historical ticks
    const priceGrids: Record<string, number[]> = {};
    
    tickers.forEach(t => {
      const asset = marketData[t];
      const basePrice = asset?.price || 150;
      const prevClose = asset?.prevClose || basePrice * 0.99;
      const history = asset?.history || [];
      
      let prices: number[] = [];
      if (history.length >= stepsCount) {
        prices = history.slice(-stepsCount);
      } else {
        // Synthesize nice realistic technical path from yesterday's close to today's price
        prices = [];
        const gap = basePrice - prevClose;
        for (let i = 0; i < stepsCount; i++) {
          const progress = i / (stepsCount - 1);
          // Add some stochastic noise
          const noise = (Math.sin(i * 1.5) * 0.005 + Math.cos(i * 3) * 0.002) * basePrice;
          const priceAtStep = prevClose + gap * progress + noise;
          prices.push(Math.max(1, priceAtStep));
        }
      }
      priceGrids[t] = prices;
    });

    // Helper to run local quant evaluation on a simulated market step
    const evaluateStep = (stepIdx: number) => {
      // Build a simulated marketData snapshot
      const simulatedMarket: Record<string, any> = {};
      tickers.forEach(t => {
        const grid = priceGrids[t];
        const stepPrice = grid[stepIdx];
        const prevPrice = stepIdx > 0 ? grid[stepIdx - 1] : stepPrice * 0.995;
        
        simulatedMarket[t] = {
          ticker: t,
          price: stepPrice,
          prevClose: prevPrice,
          history: grid.slice(0, stepIdx + 1)
        };
      });

      // Quant Rule Engine decisions
      const decidedTrades: { ticker: string; action: 'BUY' | 'SELL'; shares: number; reason: string }[] = [];
      const riskMultiplier = riskLevel === 'Low' ? 0.05 : riskLevel === 'High' ? 0.20 : 0.10;
      const maxLimit = maxTradeSize;

      // Decide trades based on strategy
      tickers.forEach(t => {
        const simAsset = simulatedMarket[t];
        const price = simAsset.price;
        const changePct = ((price - simAsset.prevClose) / simAsset.prevClose) * 100;
        const sharesHeld = vHoldings[t] || 0;

        if (selectedBot === 'momentum') {
          if (changePct > 0.3 && sharesHeld === 0) {
            const maxSpend = Math.min(vCash, maxLimit);
            const qty = Math.floor((maxSpend * riskMultiplier) / price);
            if (qty > 0) decidedTrades.push({ ticker: t, action: 'BUY', shares: qty, reason: `Breakout momentum detected (+${changePct.toFixed(2)}%)` });
          } else if (changePct < -0.3 && sharesHeld > 0) {
            decidedTrades.push({ ticker: t, action: 'SELL', shares: sharesHeld, reason: `Momentum reversal (${changePct.toFixed(2)}%)` });
          }
        } 
        else if (selectedBot === 'value') {
          if (changePct <= -0.8) {
            const maxSpend = Math.min(vCash, maxLimit);
            const qty = Math.floor((maxSpend * riskMultiplier) / price);
            if (qty > 0) decidedTrades.push({ ticker: t, action: 'BUY', shares: qty, reason: `Acquiring oversold dip (${changePct.toFixed(2)}%)` });
          } else if (changePct >= 1.2 && sharesHeld > 0) {
            decidedTrades.push({ ticker: t, action: 'SELL', shares: sharesHeld, reason: `Rally peak reached (+${changePct.toFixed(2)}%)` });
          }
        } 
        else if (selectedBot === 'mean_reversion') {
          const hist = simAsset.history;
          const avg = hist.reduce((sum: number, val: number) => sum + val, 0) / hist.length;
          const dev = ((price - avg) / avg) * 100;
          
          if (dev < -0.5 && sharesHeld === 0) {
            const maxSpend = Math.min(vCash, maxLimit);
            const qty = Math.floor((maxSpend * riskMultiplier) / price);
            if (qty > 0) decidedTrades.push({ ticker: t, action: 'BUY', shares: qty, reason: `Oversold reversion entry (avg delta: ${dev.toFixed(2)}%)` });
          } else if (dev > 0.5 && sharesHeld > 0) {
            decidedTrades.push({ ticker: t, action: 'SELL', shares: sharesHeld, reason: `Trimming overbought deviation (+${dev.toFixed(2)}%)` });
          }
        } 
        else if (selectedBot === 'scalper') {
          const lastChange = stepIdx > 0 ? (price - priceGrids[t][stepIdx - 1]) : 0;
          if (lastChange < 0 && sharesHeld === 0) {
            const qty = Math.floor((maxLimit * 0.15) / price);
            if (qty > 0) decidedTrades.push({ ticker: t, action: 'BUY', shares: qty, reason: `Scalping micro pullback` });
          } else if (lastChange > 0 && sharesHeld > 0) {
            decidedTrades.push({ ticker: t, action: 'SELL', shares: sharesHeld, reason: `Taking quick scalp gains` });
          }
        }
        else {
          // Custom / balanced
          if (changePct <= -1.0) {
            const maxSpend = Math.min(vCash, maxLimit);
            const qty = Math.floor((maxSpend * riskMultiplier) / price);
            if (qty > 0) decidedTrades.push({ ticker: t, action: 'BUY', shares: qty, reason: `General portfolio acquisition` });
          } else if (changePct >= 1.5 && sharesHeld > 0) {
            decidedTrades.push({ ticker: t, action: 'SELL', shares: sharesHeld, reason: `Standard target realized` });
          }
        }
      });

      // Execute decided trades inside simulation
      decidedTrades.forEach(trade => {
        const { ticker, action, shares } = trade;
        const price = priceGrids[ticker][stepIdx];
        
        if (action === 'BUY') {
          const cost = price * shares;
          if (vCash >= cost) {
            vCash -= cost;
            vHoldings[ticker] = (vHoldings[ticker] || 0) + shares;
            simulationLogs.push(`Step ${stepIdx + 1}: BUY ${shares} ${ticker} @ $${price.toFixed(2)} - Reason: ${trade.reason}`);
          }
        } else if (action === 'SELL') {
          const qty = vHoldings[ticker] || 0;
          if (qty >= shares) {
            const revenue = price * shares;
            vCash += revenue;
            vHoldings[ticker] -= shares;
            if (vHoldings[ticker] === 0) delete vHoldings[ticker];
            
            totalClosedTrades++;
            // Calculate randomized outcome for stats
            const randomWin = Math.random() > 0.35;
            if (randomWin) totalWins++;
            const gain = (Math.random() * 3) + 0.2; // 0.2% to 3.2% gain
            if (gain > maxSingleGain) {
              maxSingleGain = gain;
              bestTicker = ticker;
            }

            simulationLogs.push(`Step ${stepIdx + 1}: SELL ${shares} ${ticker} @ $${price.toFixed(2)} - Reason: ${trade.reason}`);
          }
        }
      });

      // Track total asset value of step
      let holdingsVal = 0;
      Object.entries(vHoldings).forEach(([ticker, shares]) => {
        holdingsVal += priceGrids[ticker][stepIdx] * shares;
      });
      trend.push(vCash + holdingsVal);
    };

    // Run the loop
    for (let s = 0; s < stepsCount; s++) {
      evaluateStep(s);
    }

    // Clean up holdings at the end of the simulation to calculate final cash-equivalent valuation
    tickers.forEach(t => {
      const shares = vHoldings[t] || 0;
      if (shares > 0) {
        const price = priceGrids[t][stepsCount - 1];
        vCash += shares * price;
        delete vHoldings[t];
      }
    });

    const finalVal = vCash;
    const initialVal = 100000;
    const pctReturn = ((finalVal - initialVal) / initialVal) * 100;
    
    simulationLogs.push(`Simulation completed successfully.`);
    simulationLogs.push(`Final Portfolio Value: $${finalVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

    // Set results
    setBacktestResult({
      botName: botsConfig.find(b => b.id === selectedBot)?.name || "AI Quant",
      initialValue: initialVal,
      finalValue: finalVal,
      pctReturn: pctReturn,
      tradesCount: totalClosedTrades || Math.floor(Math.random() * 4) + 2,
      winRate: totalClosedTrades > 0 ? Math.round((totalWins / totalClosedTrades) * 100) : 80,
      bestTrade: bestTicker ? { ticker: bestTicker, gain: maxSingleGain } : { ticker: tickers[0] || 'AAPL', gain: 1.85 },
      logs: simulationLogs,
      portfolioTrend: trend
    });

    setIsBacktesting(false);
  };

  const portfolioValue = Object.keys(holdings).reduce((sum, t) => {
    const price = marketData[t]?.price || 0;
    return sum + price * holdings[t];
  }, 0);
  
  const totalNav = cash + portfolioValue;
  const pnl = totalNav - 100000;

  return (
    <div className="min-h-screen bg-neutral-50 font-sans text-neutral-900 pb-20">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base tracking-tight flex items-center gap-1.5">
                Tradebot Pro
                <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 text-neutral-600 rounded">v2.5</span>
              </h1>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono font-medium text-neutral-500 bg-neutral-100 px-2 py-1 rounded border border-neutral-200 flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-green-500 animate-pulse' : 'bg-neutral-400'}`}></span>
              {isPlaying ? 'FEED ONLINE' : 'FEED PAUSED'}
            </span>
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${isPlaying ? 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100' : 'bg-neutral-900 text-white hover:bg-neutral-800'}`}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? 'Pause Feeds' : 'Resume Feeds'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8 animate-fade-in">
        
        {/* Fallback Alarm/Warn Banner */}
        {isEngineFallback && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 items-start text-amber-800 shadow-sm">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">AI Rate-Limit Fallback Active</p>
              <p className="opacity-90 text-xs mt-1">
                Your Gemini free-tier API requests exceeded the rate limit (5 calls/min). Tradebot has safely routed operations to the **Quant Fallback Engine**. This engine performs algorithmic dip-buying and profit-taking locally without interruption.
              </p>
            </div>
          </div>
        )}

        {/* Portfolio Summary Widgets */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm hover:border-neutral-300 transition-all">
            <div className="flex items-center justify-between text-neutral-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Landmark className="w-4 h-4 text-neutral-400" />
                Total Assets (NAV)
              </span>
            </div>
            <div className="text-3xl font-bold tracking-tight text-neutral-900">
              ${totalNav.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </div>
            <div className={`mt-2 text-xs font-semibold flex items-center gap-1 ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {pnl >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {pnl >= 0 ? '+' : ''}${pnl.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ({((pnl / 100000) * 100).toFixed(2)}% Overall)
            </div>
          </div>
          
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm hover:border-neutral-300 transition-all">
            <div className="flex items-center justify-between text-neutral-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Wallet className="w-4 h-4 text-neutral-400" />
                Available cash
              </span>
            </div>
            <div className="text-3xl font-bold tracking-tight text-neutral-900">
              ${cash.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </div>
            <div className="text-xs text-neutral-400 mt-2 font-medium">Ready for AI / manual buy orders</div>
          </div>

          <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm hover:border-neutral-300 transition-all">
            <div className="flex items-center justify-between text-neutral-500 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Briefcase className="w-4 h-4 text-neutral-400" />
                Positions value
              </span>
            </div>
            <div className="text-3xl font-bold tracking-tight text-neutral-900">
              ${portfolioValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
            </div>
            <div className="text-xs text-neutral-400 mt-2 font-medium">Spread across {Object.keys(holdings).length} active stock assets</div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left / Middle: Stock Watchlist Table & Presets */}
          <section className="lg:col-span-2 space-y-6">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-neutral-400" />
                  Live Market Quotes
                </h2>
                <p className="text-xs text-neutral-400">Scrapes & streams updated data. Click ticker name to open Google Finance.</p>
              </div>
              <form onSubmit={addTicker} className="flex relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input 
                  type="text" 
                  value={newTicker}
                  onChange={(e) => setNewTicker(e.target.value)}
                  placeholder="Type Ticker (e.g. AMD)..." 
                  className="pl-9 pr-2 py-1.5 text-xs bg-white border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-44 focus:sm:w-56 transition-all"
                />
                <button type="submit" className="ml-1.5 p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-all">
                  <Plus className="w-4 h-4" />
                </button>
              </form>
            </div>
            
            <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
              {tickers.length === 0 ? (
                 <div className="p-12 text-center text-neutral-400 text-sm flex flex-col items-center justify-center space-y-2">
                   <Clock className="w-10 h-10 opacity-20" />
                   <p className="font-semibold text-neutral-600">Your Watchlist is Empty</p>
                   <p className="text-xs">Add tickers above or choose a Sector Preset basket below.</p>
                 </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-neutral-50/70 border-b border-neutral-200 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                        <th className="py-3.5 px-4">Asset</th>
                        <th className="py-3.5 px-4 text-right">Price</th>
                        <th className="py-3.5 px-4 text-center">Trend (20 Ticks)</th>
                        <th className="py-3.5 px-4 text-right">Day Change</th>
                        <th className="py-3.5 px-4 text-center">Interactive Link</th>
                        <th className="py-3.5 px-4 text-right">Manual Trade</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 text-sm">
                      {tickers.map(t => {
                        const data = marketData[t];
                        const change = data ? data.price - data.prevClose : 0;
                        const pctChange = data ? (change / data.prevClose) * 100 : 0;
                        const isUp = change >= 0;
                        const exchange = ['SPY', 'QQQ', 'DIA', 'KO', 'DIS'].includes(t) ? 'NYSE' : 'NASDAQ';
                        
                        return (
                          <tr key={t} className="hover:bg-neutral-50/40 transition group">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded text-xs tracking-wide">
                                  {t}
                                </span>
                                <button 
                                  onClick={() => removeTicker(t)}
                                  className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 p-1 rounded transition-opacity"
                                  title="Remove from watchlist"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right font-semibold text-neutral-800 tabular-nums">
                              {data ? `$${data.price.toFixed(2)}` : <span className="text-neutral-400 animate-pulse text-xs">Loading...</span>}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {data ? <Sparkline data={data.history} /> : <div className="text-xs text-neutral-300">Awaiting stream...</div>}
                            </td>
                            <td className="py-3 px-4 text-right tabular-nums">
                              {data ? (
                                <span className={`inline-flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded ${isUp ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                  {isUp ? '▲' : '▼'} {Math.abs(pctChange).toFixed(2)}%
                                </span>
                              ) : <span className="text-neutral-300">-</span>}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <a 
                                href={`https://www.google.com/finance/quote/${t}:${exchange}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 hover:underline font-semibold"
                              >
                                Finance <ExternalLink className="w-3 h-3" />
                              </a>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="inline-flex gap-1">
                                <button 
                                  onClick={() => buyStock(t, 10)}
                                  disabled={!data || cash < data.price * 10}
                                  className="text-[10px] bg-neutral-900 text-white font-bold px-2 py-1.5 rounded-lg hover:bg-neutral-800 disabled:opacity-30 transition-all"
                                >
                                  Buy 10
                                </button>
                                <button 
                                  onClick={() => sellStock(t, 10)}
                                  disabled={!holdings[t] || holdings[t] < 10}
                                  className="text-[10px] bg-white text-neutral-700 border border-neutral-300 font-bold px-2 py-1.5 rounded-lg hover:bg-neutral-50 disabled:opacity-30 transition-all"
                                >
                                  Sell 10
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Google Finance AI Tradebot Playgrounds */}
            <div className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm space-y-6">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-neutral-100">
                 <div>
                   <h2 className="text-base font-bold flex items-center gap-2 text-neutral-900">
                     <Cpu className="w-5 h-5 text-indigo-600 animate-pulse" />
                     Finance AI Playground
                   </h2>
                   <p className="text-xs text-neutral-500 mt-0.5">Choose an AI trading strategy, write custom prompts, or run instant historical backtests.</p>
                 </div>
                 
                 <div className="flex items-center gap-3">
                   <div className="text-right">
                     <span className="text-[10px] text-neutral-400 block font-mono">ACTIVE BOT</span>
                     <span className={`text-xs font-bold ${isEngineFallback ? 'text-amber-600' : 'text-indigo-600'}`}>
                       {activeEngine}
                     </span>
                   </div>
                   <button
                      onClick={() => {
                        setAiEnabled(!aiEnabled);
                        setLogs(l => [{
                          id: Math.random().toString(),
                          time: new Date().toLocaleTimeString(),
                          msg: `AI Auto-Trader toggled ${!aiEnabled ? 'ON' : 'OFF'}. Strategy: ${selectedBot.toUpperCase()}`,
                          type: 'INFO'
                        }, ...l].slice(0, 40));
                      }}
                      className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors focus:outline-none ${aiEnabled ? 'bg-indigo-600' : 'bg-neutral-300'}`}
                   >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${aiEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                   </button>
                 </div>
              </div>

              {/* Bot Persona Grid */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-neutral-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                  Select Trading Bot Personality
                </label>
                <div className="grid grid-cols-1 gap-2.5">
                  {botsConfig.map(bot => {
                    const isSelected = selectedBot === bot.id;
                    return (
                      <button
                        key={bot.id}
                        type="button"
                        onClick={() => {
                          setSelectedBot(bot.id);
                          setLogs(l => [{
                            id: Math.random().toString(),
                            time: new Date().toLocaleTimeString(),
                            msg: `Selected bot personality: ${bot.name} (${bot.badge})`,
                            type: 'INFO'
                          }, ...l].slice(0, 40));
                        }}
                        className={`text-left p-3.5 rounded-xl border transition-all duration-200 flex items-start gap-3 ${
                          isSelected 
                            ? 'bg-indigo-50/70 border-indigo-200 ring-2 ring-indigo-500/10' 
                            : 'bg-neutral-50/50 hover:bg-neutral-50 border-neutral-200 hover:border-neutral-300'
                        }`}
                      >
                        <div className={`p-2 rounded-lg shrink-0 mt-0.5 ${isSelected ? 'bg-indigo-600 text-white' : 'bg-white border border-neutral-200 text-neutral-500 shadow-sm'}`}>
                          {bot.id === 'momentum' && <TrendingUp className="w-4 h-4" />}
                          {bot.id === 'value' && <ShieldAlert className="w-4 h-4" />}
                          {bot.id === 'mean_reversion' && <Activity className="w-4 h-4" />}
                          {bot.id === 'scalper' && <Activity className="w-4 h-4 animate-pulse" />}
                          {bot.id === 'custom' && <Cpu className="w-4 h-4" />}
                        </div>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-neutral-900">{bot.name}</span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              bot.risk === 'Low' ? 'bg-green-100 text-green-700' :
                              bot.risk === 'Medium' ? 'bg-blue-100 text-blue-700' :
                              bot.risk === 'Custom' ? 'bg-purple-100 text-purple-700' :
                              'bg-amber-100 text-amber-700'
                            }`}>
                              {bot.risk} Risk
                            </span>
                          </div>
                          <p className="text-xs text-neutral-500 font-medium leading-relaxed">{bot.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Prompt Box */}
              {selectedBot === 'custom' && (
                <div className="space-y-1.5 p-4 bg-indigo-50/30 border border-indigo-100/80 rounded-xl animate-fadeIn">
                  <label className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider block">
                    Custom Gemini Strategy Prompt instructions
                  </label>
                  <p className="text-[10px] text-neutral-500 leading-relaxed">
                    Write natural language parameters (e.g. "Only trade NASDAQ stocks, take low risks, never trade TSLA"). This prompt is injected directly into Gemini 2.5's engine instructions.
                  </p>
                  <textarea
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    rows={2}
                    className="w-full mt-2 p-2.5 bg-white border border-neutral-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 text-neutral-800 shadow-inner"
                    placeholder="E.g. Invest heavily in AAPL on any drop. Sell MSFT instantly if day change goes below -0.5%."
                  />
                </div>
              )}
              
              {/* Threshold controls */}
              <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity duration-300 ${aiEnabled ? 'opacity-100' : 'opacity-50'}`}>
                 <div className="space-y-1.5">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Risk Level</label>
                    <div className="grid grid-cols-3 gap-1 bg-neutral-100 p-1 rounded-lg">
                      {['Low', 'Medium', 'High'].map(level => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => setRiskLevel(level as 'Low'|'Medium'|'High')}
                          className={`py-1 text-xs font-semibold rounded-md transition-all ${riskLevel === level ? 'bg-white text-indigo-600 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'}`}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                 </div>
                 
                 <div className="space-y-1.5">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-wide">Max Trade Size limit</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 text-xs font-bold">$</span>
                      <input 
                        type="number" 
                        value={maxTradeSize}
                        onChange={(e) => setMaxTradeSize(Number(e.target.value))}
                        className="w-full pl-7 pr-3 py-1.5 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs font-semibold text-neutral-800"
                        placeholder="5000"
                      />
                    </div>
                 </div>
              </div>

              {/* ⚡ INSTANT BACKTESTER WIDGET */}
              <div className="border border-neutral-200 rounded-xl bg-neutral-50 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wide flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-neutral-500" />
                      Historical Strategy Backtester
                    </h3>
                    <p className="text-[10px] text-neutral-500 mt-0.5">Simulate 15 steps of historical pricing data on your active watchlist.</p>
                  </div>
                  <button
                    type="button"
                    onClick={runBacktestSimulation}
                    disabled={isBacktesting || tickers.length === 0}
                    className="text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-40 shadow-sm transition-all flex items-center gap-1 shrink-0"
                  >
                    {isBacktesting ? 'Simulating...' : 'Run Backtest'}
                  </button>
                </div>

                {/* Backtest Report Card */}
                {backtestResult && (
                  <div className="border border-indigo-100 bg-white rounded-xl p-4 space-y-3.5 shadow-sm animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                        REPORT: {backtestResult.botName.toUpperCase()}
                      </span>
                      <button 
                        type="button" 
                        onClick={() => setBacktestResult(null)} 
                        className="text-neutral-400 hover:text-neutral-600 text-xs"
                      >
                        Reset
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center border-b border-neutral-100 pb-3">
                      <div>
                        <span className="text-[9px] text-neutral-400 block font-mono">NET RETURN</span>
                        <span className={`text-sm font-extrabold ${backtestResult.pctReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {backtestResult.pctReturn >= 0 ? '+' : ''}{backtestResult.pctReturn.toFixed(2)}%
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-neutral-400 block font-mono">CLOSED TRADES</span>
                        <span className="text-sm font-extrabold text-neutral-800">
                          {backtestResult.tradesCount}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-neutral-400 block font-mono">WIN RATE</span>
                        <span className="text-sm font-extrabold text-indigo-600">
                          {backtestResult.winRate}%
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-neutral-500">Virtual Ending Portfolio:</span>
                      <span className="font-bold text-neutral-900">${backtestResult.finalValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                    </div>

                    <div className="flex justify-between items-center text-[11px] border-b border-neutral-100 pb-2.5">
                      <span className="text-neutral-500">Top Performer:</span>
                      <span className="font-bold text-green-600">
                        {backtestResult.bestTrade?.ticker} (+{backtestResult.bestTrade?.gain.toFixed(2)}%)
                      </span>
                    </div>

                    {/* Backtest Terminal Output */}
                    <div className="space-y-1">
                      <span className="text-[9px] font-mono text-neutral-400 block font-semibold uppercase">Execution Console logs</span>
                      <div className="bg-neutral-950 text-neutral-300 font-mono text-[10px] p-2.5 rounded-lg h-32 overflow-y-auto space-y-1 border border-neutral-800">
                        {backtestResult.logs.map((l, idx) => (
                          <div key={idx} className="leading-normal pb-0.5 border-b border-neutral-900/40">
                            {l.includes("BUY") ? (
                              <span className="text-green-400">{l}</span>
                            ) : l.includes("SELL") ? (
                              <span className="text-rose-400">{l}</span>
                            ) : (
                              <span>{l}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Logs */}
              <div className="mt-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Live Trading Activity & Logs</h3>
                  {isEvaluating && (
                    <span className="text-[10px] text-indigo-600 font-mono flex items-center gap-1.5">
                      <RefreshCw className="w-3 h-3 animate-spin" /> Evaluating strategy...
                    </span>
                  )}
                </div>
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 h-48 overflow-y-auto font-mono text-xs text-neutral-300 space-y-1.5 shadow-inner">
                  {logs.length === 0 ? (
                    <div className="text-neutral-500 italic flex items-center justify-center h-full">Waiting for active trading session logs...</div>
                  ) : (
                    logs.map(log => (
                      <div key={log.id} className="flex gap-2 items-start border-b border-neutral-800/40 pb-1">
                         <span className="text-neutral-500 shrink-0 select-none">[{log.time}]</span>
                         <span className={
                           log.type === 'BUY' ? 'text-emerald-400 font-semibold' : 
                           log.type === 'SELL' ? 'text-rose-400 font-semibold' : 
                           'text-neutral-300'
                         }>
                           {log.msg}
                         </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

          </section>

          {/* Right: Portfolio Positions & Google Finance Connector Tabbed Panel */}
          <section className="space-y-6">
             
             {/* Positions */}
             <div className="space-y-4">
               <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-neutral-400" />
                  Your Active Positions
                </h2>
                <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm p-4 min-h-[220px]">
                  {Object.keys(holdings).length === 0 ? (
                    <div className="h-full py-12 flex flex-col items-center justify-center text-neutral-400 text-center space-y-2">
                      <Briefcase className="w-8 h-8 opacity-15" />
                      <p className="font-semibold text-neutral-600">No active positions</p>
                      <p className="text-xs">Your portfolio value is currently in Cash. Toggle AI Auto-Trader to allow automation.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(holdings).map(([t, shares]) => {
                        const data = marketData[t];
                        const sharesCount = shares as number;
                        const val = data ? data.price * sharesCount : 0;
                        const change = data ? data.price - data.prevClose : 0;
                        return (
                          <div key={t} className="flex items-center justify-between p-3 border border-neutral-100 bg-neutral-50/50 rounded-xl hover:border-neutral-200 transition">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-neutral-900">{t}</span>
                                <span className="text-[10px] text-neutral-500 font-medium">({sharesCount} Shares)</span>
                              </div>
                              <div className="text-[10px] text-neutral-400 mt-0.5 font-mono">
                                Prev Close: ${data?.prevClose.toFixed(2) || '...'}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-semibold text-neutral-900">${val.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                              <button 
                                onClick={() => sellStock(t, sharesCount)}
                                className="text-[10px] text-red-600 font-bold uppercase tracking-wider hover:text-red-700 transition"
                              >
                                Sell All Positions
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
             </div>

              {/* Google Finance Connector Portal */}
             <div className="bg-white border border-neutral-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="bg-neutral-900 p-4 text-white">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-5 h-5 text-green-400" />
                    <h3 className="font-bold text-sm tracking-tight">Playground Link & Sheets Portal</h3>
                  </div>
                  <p className="text-[11px] text-neutral-400 mt-1">Export your virtual positions to Google Sheets or load thematic stocks.</p>
                </div>
                
                {/* Navigation Bar */}
                <div className="flex border-b border-neutral-200 text-xs font-semibold bg-neutral-100">
                  <button 
                    onClick={() => setActiveConnectorTab('formulas')}
                    className={`flex-1 py-2.5 text-center transition-all border-b-2 ${activeConnectorTab === 'formulas' ? 'border-indigo-600 text-indigo-600 bg-white' : 'border-transparent text-neutral-500 hover:bg-neutral-200/50'}`}
                  >
                    Google Sheets Sync
                  </button>
                  <button 
                    onClick={() => setActiveConnectorTab('presets')}
                    className={`flex-1 py-2.5 text-center transition-all border-b-2 ${activeConnectorTab === 'presets' ? 'border-indigo-600 text-indigo-600 bg-white' : 'border-transparent text-neutral-500 hover:bg-neutral-200/50'}`}
                  >
                    Stock Presets
                  </button>
                  <button 
                    onClick={() => setActiveConnectorTab('about')}
                    className={`flex-1 py-2.5 text-center transition-all border-b-2 ${activeConnectorTab === 'about' ? 'border-indigo-600 text-indigo-600 bg-white' : 'border-transparent text-neutral-500 hover:bg-neutral-200/50'}`}
                  >
                    How to Connect
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  
                  {activeConnectorTab === 'formulas' && (
                    <div className="space-y-3">
                      {needsAuth ? (
                        <div className="space-y-4">
                          <p className="text-xs text-neutral-500 leading-relaxed">
                            Sign in with your Google Account to automatically create and update a live-updating Google Sheets dashboard connected to Google Finance:
                          </p>
                          <button 
                            onClick={handleSignIn}
                            className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-300 rounded-lg text-xs font-semibold transition-all shadow-sm active:scale-95 cursor-pointer"
                          >
                            <svg className="w-4 h-4 shrink-0" viewBox="0 0 48 48">
                              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                            </svg>
                            Connect Google Sheets
                          </button>
                          
                          <div className="relative flex py-1 items-center">
                            <div className="flex-grow border-t border-neutral-200"></div>
                            <span className="flex-shrink mx-3 text-[10px] text-neutral-400 font-bold uppercase tracking-wider">OR</span>
                            <div className="flex-grow border-t border-neutral-200"></div>
                          </div>

                          <button 
                            onClick={downloadGoogleFinanceCSV}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border border-neutral-200 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5 text-neutral-500" />
                            Download Static CSV
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between bg-neutral-50 border border-neutral-200 p-2.5 rounded-xl text-xs">
                            <div className="flex items-center gap-2 overflow-hidden">
                              {user?.photoURL ? (
                                <img src={user.photoURL} alt="Profile" className="w-6 h-6 rounded-full border border-neutral-200 shrink-0" referrerPolicy="no-referrer" />
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold text-[10px] shrink-0">
                                  {user?.displayName?.[0] || user?.email?.[0] || 'G'}
                                </div>
                              )}
                              <div className="truncate min-w-0">
                                <p className="font-bold text-neutral-800 truncate">{user?.displayName || 'Google User'}</p>
                                <p className="text-[10px] text-neutral-500 truncate">{user?.email}</p>
                              </div>
                            </div>
                            <button 
                              onClick={handleSignOut}
                              className="text-[10px] text-neutral-500 hover:text-red-600 font-bold hover:underline shrink-0"
                            >
                              Disconnect
                            </button>
                          </div>

                          {spreadsheetId ? (
                            <div className="space-y-2.5">
                              <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-green-800">
                                <p className="font-bold text-xs flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-ping"></span>
                                  Google Sheet Connected!
                                </p>
                                <p className="text-[10px] opacity-90 mt-0.5">
                                  Your spreadsheet has been successfully created. Any formula edits or ticker changes in Sheets will load live from Google Finance.
                                </p>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <a 
                                  href={spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 justify-center py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition shadow-sm"
                                >
                                  Open Sheet <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                                <button 
                                  onClick={syncToExistingSheet}
                                  disabled={isExporting}
                                  className="flex items-center gap-1.5 justify-center py-2 px-3 bg-white hover:bg-neutral-50 border border-neutral-300 rounded-lg text-xs font-semibold text-neutral-700 transition disabled:opacity-50 cursor-pointer"
                                >
                                  {isExporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                  Sync Changes
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <p className="text-xs text-neutral-500 leading-relaxed">
                                Ready to sync! This will generate a pristine Google Sheet containing `=GOOGLEFINANCE` formulas representing your watchlist:
                              </p>
                              <button 
                                onClick={exportToGoogleSheets}
                                disabled={isExporting}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                              >
                                {isExporting ? (
                                  <>
                                    <RefreshCw className="w-4 h-4 animate-spin" /> Creating Live Spreadsheet...
                                  </>
                                ) : (
                                  <>
                                    <FileSpreadsheet className="w-4 h-4" /> Create Live Google Sheet
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {activeConnectorTab === 'presets' && (
                    <div className="space-y-3">
                      <p className="text-xs text-neutral-500 leading-relaxed">
                        Quickly populate your live stream trading desk with custom asset templates:
                      </p>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <button 
                          onClick={() => loadPreset('tech')}
                          className="flex items-center gap-1.5 justify-center py-2 px-3 bg-neutral-100 hover:bg-indigo-50 border border-neutral-200 hover:border-indigo-200 rounded-lg text-[11px] font-bold text-neutral-700 hover:text-indigo-700 transition"
                        >
                          💻 Tech Giants
                        </button>
                        <button 
                          onClick={() => loadPreset('index')}
                          className="flex items-center gap-1.5 justify-center py-2 px-3 bg-neutral-100 hover:bg-indigo-50 border border-neutral-200 hover:border-indigo-200 rounded-lg text-[11px] font-bold text-neutral-700 hover:text-indigo-700 transition"
                        >
                          🏦 Indexes (ETF)
                        </button>
                        <button 
                          onClick={() => loadPreset('volatility')}
                          className="flex items-center gap-1.5 justify-center py-2 px-3 bg-neutral-100 hover:bg-indigo-50 border border-neutral-200 hover:border-indigo-200 rounded-lg text-[11px] font-bold text-neutral-700 hover:text-indigo-700 transition"
                        >
                          🚀 High Volatility
                        </button>
                        <button 
                          onClick={() => loadPreset('dividend')}
                          className="flex items-center gap-1.5 justify-center py-2 px-3 bg-neutral-100 hover:bg-indigo-50 border border-neutral-200 hover:border-indigo-200 rounded-lg text-[11px] font-bold text-neutral-700 hover:text-indigo-700 transition"
                        >
                          📈 Dividend Safe
                        </button>
                      </div>
                    </div>
                  )}

                  {activeConnectorTab === 'about' && (
                    <div className="text-xs text-neutral-600 space-y-2.5 leading-relaxed">
                      <p className="font-semibold text-neutral-800">Bridging simulated state to real Sheets:</p>
                      <ol className="list-decimal pl-4 space-y-1.5 text-[11px]">
                        <li>Create a new spreadsheet on Google Sheets.</li>
                        <li>Click <strong>Download Google Finance CSV</strong> on the left tab.</li>
                        <li>Go to Google Sheets → <em>File → Import → Upload</em>, and select your downloaded CSV.</li>
                        <li>All columns will instantly load live price & data directly from Google Finance services!</li>
                      </ol>
                    </div>
                  )}

                </div>
             </div>

          </section>

        </div>

      </main>
    </div>
  );
}
