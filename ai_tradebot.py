import asyncio
import json
import logging
import os
from typing import List, Dict

# pip install google-genai yfinance
from google import genai
from google.genai import types
import yfinance as yf

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class MarketReader:
    """Fetches live market data (using yfinance for reliability over scraping)."""
    def __init__(self, tickers: List[str]):
        self.tickers = tickers

    async def fetch_latest_data(self) -> Dict[str, dict]:
        data = {}
        for ticker in self.tickers:
            # Running synchronous yfinance call in a thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            ticker_obj = await loop.run_in_executor(None, yf.Ticker, ticker)
            hist = await loop.run_in_executor(None, ticker_obj.history, "1d")
            
            if not hist.empty:
                last_price = hist['Close'].iloc[-1]
                data[ticker] = {
                    "price": round(last_price, 2),
                    "volume": int(hist['Volume'].iloc[-1]),
                    "high": round(hist['High'].iloc[-1], 2),
                    "low": round(hist['Low'].iloc[-1], 2)
                }
        return data


class PortfolioTracker:
    """Manages virtual cash and stock holdings."""
    def __init__(self, initial_cash: float = 100000.0):
        self.cash = initial_cash
        self.holdings: Dict[str, int] = {}
        
    def execute_trade(self, action: str, ticker: str, shares: int, current_price: float) -> bool:
        if shares <= 0:
            return False
            
        cost = current_price * shares
        if action == "BUY":
            if self.cash >= cost:
                self.cash -= cost
                self.holdings[ticker] = self.holdings.get(ticker, 0) + shares
                logging.info(f"EXECUTED BUY: {shares} {ticker} @ ${current_price:.2f}")
                return True
            else:
                logging.warning(f"INSUFFICIENT FUNDS: Cannot buy {shares} {ticker} @ ${current_price:.2f}")
                return False
        elif action == "SELL":
            if self.holdings.get(ticker, 0) >= shares:
                self.cash += cost
                self.holdings[ticker] -= shares
                if self.holdings[ticker] == 0:
                    del self.holdings[ticker]
                logging.info(f"EXECUTED SELL: {shares} {ticker} @ ${current_price:.2f}")
                return True
            else:
                logging.warning(f"INSUFFICIENT SHARES: Cannot sell {shares} {ticker}")
                return False
        return False


class AILogicEngine:
    """Uses Gemini to evaluate market data and make trading decisions."""
    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)
        
    async def evaluate(self, market_data: Dict[str, dict], portfolio: PortfolioTracker, risk_level: str = "Medium") -> List[dict]:
        prompt = f"""You are an AI quantitative trading bot.
Here is the current state of the market:
{json.dumps(market_data, indent=2)}

Here is the current portfolio:
Cash: ${portfolio.cash:.2f}
Holdings: {json.dumps(portfolio.holdings, indent=2)}

User Settings:
Risk Level: {risk_level}

Based on this, what actions should be taken? You can choose to BUY or SELL assets. 
Ensure you don't spend more than the available cash, and don't sell more than you hold.
Limit to 1-3 trades max per cycle.
Respond with a JSON array of trades. If no actions, return an empty array.
"""
        try:
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(None, lambda: self.client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema={
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "ticker": {"type": "STRING"},
                                "action": {"type": "STRING", "description": "BUY or SELL"},
                                "shares": {"type": "INTEGER", "description": "Number of shares to trade"},
                                "reason": {"type": "STRING", "description": "Brief reason for this trade"}
                            },
                            "required": ["ticker", "action", "shares", "reason"]
                        }
                    }
                )
            ))
            
            return json.loads(response.text)
        except Exception as e:
            logging.error(f"AI Evaluation Error: {e}")
            return []


class TradingApp:
    """Main application loop."""
    def __init__(self, api_key: str, tickers: List[str]):
        self.reader = MarketReader(tickers)
        self.portfolio = PortfolioTracker()
        self.engine = AILogicEngine(api_key)
        self.running = False
        
    async def run(self, interval_seconds: int = 60):
        self.running = True
        logging.info("Starting Live Trading Session...")
        
        while self.running:
            try:
                logging.info("Fetching market data...")
                market_data = await self.reader.fetch_latest_data()
                
                if not market_data:
                    logging.warning("No market data fetched. Waiting for next cycle.")
                else:
                    logging.info("Evaluating trades with AI Engine...")
                    trades = await self.engine.evaluate(market_data, self.portfolio)
                    
                    for trade in trades:
                        ticker = trade.get('ticker')
                        action = trade.get('action')
                        shares = trade.get('shares')
                        reason = trade.get('reason')
                        
                        if ticker in market_data:
                            current_price = market_data[ticker]['price']
                            logging.info(f"AI Decision: {action} {shares} {ticker} - Reason: {reason}")
                            self.portfolio.execute_trade(action, ticker, shares, current_price)
                            
                logging.info(f"Portfolio NAV: Cash=${self.portfolio.cash:.2f}, Holdings={self.portfolio.holdings}")
                logging.info(f"Sleeping for {interval_seconds} seconds...\n")
                await asyncio.sleep(interval_seconds)
                
            except Exception as e:
                logging.error(f"Error in trading loop: {e}")
                await asyncio.sleep(10)


if __name__ == "__main__":
    API_KEY = os.environ.get("GEMINI_API_KEY")
    if not API_KEY:
        logging.error("Please set the GEMINI_API_KEY environment variable.")
        exit(1)
        
    app = TradingApp(api_key=API_KEY, tickers=["AAPL", "MSFT", "GOOGL", "NVDA"])
    
    try:
        asyncio.run(app.run(interval_seconds=60))
    except KeyboardInterrupt:
        logging.info("Trading session stopped by user.")
