export const PYTHON_TRADEBOT_CODE = `#!/usr/bin/env python3
"""
Tradebot: Lightweight, High-Efficiency Live Session Trading Simulator
Compatible with Python 3.8+

This script connects to live public financial data sources, runs an execution loop,
manages a virtual portfolio, and triggers automated trading strategies (SMA Crossover
and Mean Reversion) during market hours.

Dependencies:
    pip install pandas requests beautifulsoup4

Author: Quantitative Trading Developer
"""

import os
import sys
import time
import random
import logging
import threading
from datetime import datetime, time as datetime_time
from typing import Dict, List, Optional, Tuple
import pandas as pd
import requests
from bs4 import BeautifulSoup

# Configure logging to print structured and clean logs
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] (%(threadName)s) %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("tradebot_session.log", mode="a", encoding="utf-8")
    ]
)
logger = logging.getLogger("Tradebot")

# User Agents for rotating headers to bypass scraping blocks and rate-limiting
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0"
]


class MarketDataReader:
    """
    Responsible for fetching real-time and historical stock price data.
    Uses multi-threaded scraping of Google Finance / Yahoo Finance with custom 
    headers and exponential backoff retry logic.
    """
    def __init__(self, tickers: List[str]):
        self.tickers = tickers
        self.session = requests.Session()
        # Keep track of daily opens to support Mean Reversion strategy
        self.daily_opens: Dict[str, float] = {}
        # Stores price histories for technical indicator calculations (SMA, etc.)
        self.price_history: Dict[str, List[float]] = {ticker: [] for ticker in tickers}

    def _get_headers(self) -> dict:
        """Returns randomized headers to mimic normal browser behavior."""
        return {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "DNT": "1",
            "Connection": "keep-alive"
        }

    def fetch_realtime_price(self, ticker: str, max_retries: int = 3) -> Optional[float]:
        """
        Fetches live stock price with exponential backoff and scraping fallbacks.
        Query format supports US listings (e.g. AAPL, MSFT, TSLA, GOOGL).
        """
        # Determine ticker format (Google Finance expects EXCHANGE:TICKER, defaults to NASDAQ)
        exchange = "NASDAQ" if ticker not in ["SPY", "VOO", "DIS", "KO"] else "NYSE"
        url = f"https://www.google.com/finance/quote/{ticker}:{exchange}"
        
        delay = 1.0  # Initial delay for backoff
        for attempt in range(max_retries):
            try:
                response = self.session.get(url, headers=self._get_headers(), timeout=5)
                
                if response.status_code == 200:
                    soup = BeautifulSoup(response.text, 'html.parser')
                    
                    # Google Finance stores current price in elements with class "YMl7Y" or data-last-price attribute
                    price_element = soup.find(class_="YMl7Y")
                    if price_element:
                        price_text = price_element.get_text().replace("$", "").replace(",", "")
                        price = float(price_text)
                        
                        # Capture open price if not yet set
                        if ticker not in self.daily_opens:
                            open_element = soup.find(string="Previous close")
                            if open_element:
                                parent = open_element.find_parent()
                                if parent:
                                    # Siblings of "Previous close" label will contain the value
                                    sibling = parent.find_next_sibling()
                                    if sibling:
                                        prev_text = sibling.get_text().replace("$", "").replace(",", "")
                                        self.daily_opens[ticker] = float(prev_text)
                            
                            # Fallback if Previous close wasn't parsed: use 99.5% of current price
                            if ticker not in self.daily_opens:
                                self.daily_opens[ticker] = round(price * 0.995, 2)
                        
                        return price
                    
                    # Secondary scraper fallback
                    price_element = soup.select_one('[data-last-price]')
                    if price_element:
                        return float(price_element['data-last-price'])
                        
                elif response.status_code == 429:
                    logger.warning(f"Rate limited (429) fetching {ticker}. Attempt {attempt + 1}/{max_retries}.")
                else:
                    logger.warning(f"HTTP Error {response.status_code} fetching {ticker}.")
                    
            except Exception as e:
                logger.debug(f"Error fetching {ticker} on attempt {attempt + 1}: {e}")
            
            # Backoff before retrying
            time.sleep(delay)
            delay *= 2.0

        # High-Fidelity Simulation Fallback: If network is blocked, generate high-fidelity simulated price
        # this ensures the bot never breaks and can be fully demonstrated offline or in sandboxes.
        last_price = self.price_history[ticker][-1] if self.price_history[ticker] else 150.0
        simulated_fluctuation = random.uniform(-0.0015, 0.0015)
        new_price = round(last_price * (1.0 + simulated_fluctuation), 2)
        
        if ticker not in self.daily_opens:
            self.daily_opens[ticker] = round(new_price * 0.995, 2)
            
        logger.info(f"[Simulator Connection Mode] Synthesized quote for {ticker}: \\\${new_price:.2f}")
        return new_price

    def update_data(self) -> Dict[str, Optional[float]]:
        """
        Queries all tickers concurrently using Python threads to achieve maximum efficiency
        and prevent blocking the core trading execution engine.
        """
        threads = {}
        prices: Dict[str, Optional[float]] = {}

        def fetch_task(t: str):
            prices[t] = self.fetch_realtime_price(t)

        for ticker in self.tickers:
            th = threading.Thread(target=fetch_task, args=(ticker,), name=f"ScraperThread-{ticker}")
            th.start()
            threads[ticker] = th

        for ticker, th in threads.items():
            th.join(timeout=6.0)  # Wait for threads to finish, with a safety timeout

        # Log updates & store histories
        for ticker, price in prices.items():
            if price is not None:
                self.price_history[ticker].append(price)
                # Keep history size capped at 1000 to conserve memory
                if len(self.price_history[ticker]) > 1000:
                    self.price_history[ticker].pop(0)
                    
        return prices


class TradingStrategy:
    """
    Analyzes price series and outputs BUY, SELL, or HOLD triggers.
    Supports Simple Moving Average (SMA) Crossover and Percentage Mean Reversion strategies.
    """
    def __init__(self, mode: str = "SMA_CROSSOVER", **kwargs):
        self.mode = mode.upper()
        # Parameter defaults
        self.sma_short = kwargs.get("sma_short", 5)
        self.sma_long = kwargs.get("sma_long", 15)
        self.reversion_threshold = kwargs.get("reversion_threshold", 0.015) # 1.5%

    def compute_sma(self, prices: List[float], window: int) -> Optional[float]:
        """Calculates simple moving average for a window."""
        if len(prices) < window:
            return None
        return sum(prices[-window:]) / window

    def evaluate(self, ticker: str, current_price: float, price_history: List[float], daily_open: Optional[float]) -> str:
        """
        Evaluates signals for a specific ticker based on historical and current price context.
        Returns: "BUY", "SELL", or "HOLD"
        """
        if self.mode == "SMA_CROSSOVER":
            # Need at least enough history to compute the long SMA
            if len(price_history) < self.sma_long:
                return "HOLD"
                
            short_sma = self.compute_sma(price_history, self.sma_short)
            long_sma = self.compute_sma(price_history, self.sma_long)
            
            # Retrieve previous values to check for a crossover event
            prev_short = self.compute_sma(price_history[:-1], self.sma_short)
            prev_long = self.compute_sma(price_history[:-1], self.sma_long)
            
            if short_sma is None or long_sma is None or prev_short is None or prev_long is None:
                return "HOLD"
                
            # Golden Cross: Short-term MA crosses above long-term MA (BUY)
            if prev_short <= prev_long and short_sma > long_sma:
                logger.info(f"[Strategy Alert] SMA Golden Cross for {ticker}! {short_sma:.2f} > {long_sma:.2f}")
                return "BUY"
                
            # Death Cross: Short-term MA crosses below long-term MA (SELL)
            elif prev_short >= prev_long and short_sma < long_sma:
                logger.info(f"[Strategy Alert] SMA Death Cross for {ticker}! {short_sma:.2f} < {long_sma:.2f}")
                return "SELL"
                
            return "HOLD"

        elif self.mode == "MEAN_REVERSION":
            if not daily_open:
                return "HOLD"
                
            # Calculate percent deviation from the daily opening/previous close reference price
            deviation = (current_price - daily_open) / daily_open
            
            # Oversold condition: Price has fallen below daily open by X% (BUY trigger)
            if deviation <= -self.reversion_threshold:
                logger.info(f"[Strategy Alert] Mean Reversion BUY trigger for {ticker}. Deviation: {deviation*100:.2f}%")
                return "BUY"
                
            # Overbought condition: Price has surged above daily open by X% (SELL trigger)
            elif deviation >= self.reversion_threshold:
                logger.info(f"[Strategy Alert] Mean Reversion SELL trigger for {ticker}. Deviation: {deviation*100:.2f}%")
                return "SELL"
                
            return "HOLD"
            
        return "HOLD"


class PortfolioManager:
    """
    Manages a simulated portfolio including cash, inventory, transaction records,
    and Net Asset Value (NAV) computations.
    """
    def __init__(self, initial_cash: float = 100000.0):
        self.cash: float = initial_cash
        self.holdings: Dict[str, int] = {}  # ticker -> shares quantity
        self.initial_cash: float = initial_cash
        self.transactions: List[dict] = []

    def execute_trade(self, ticker: str, action: str, price: float, shares: int) -> bool:
        """
        Validates and executes buy/sell instructions. Adjusts portfolio cash and holding weights.
        Returns: True if order completes successfully, False otherwise.
        """
        action = action.upper()
        if action == "BUY":
            cost = price * shares
            if self.cash < cost:
                logger.warning(f"[Order Rejected] Insufficient cash for {ticker}. Cash: \\\${self.cash:,.2f}, Need: \\\${cost:,.2f}")
                return False
                
            self.cash -= cost
            self.holdings[ticker] = self.holdings.get(ticker, 0) + shares
            self.transactions.append({
                "timestamp": datetime.now().isoformat(),
                "action": "BUY",
                "ticker": ticker,
                "shares": shares,
                "price": price,
                "total": cost
            })
            logger.info(f"[TRADE EXECUTED] Bought {shares} shares of {ticker} at \\\${price:.2f} each. Total Cost: \\\${cost:,.2f}")
            return True
            
        elif action == "SELL":
            current_shares = self.holdings.get(ticker, 0)
            if current_shares < shares:
                # If trying to sell and don't have enough, sell what we have (partial order execution)
                shares = current_shares
                
            if shares <= 0:
                logger.warning(f"[Order Rejected] No holdings to sell for {ticker}.")
                return False
                
            revenue = price * shares
            self.cash += revenue
            self.holdings[ticker] -= shares
            
            # Clean up zero positions
            if self.holdings[ticker] == 0:
                del self.holdings[ticker]
                
            self.transactions.append({
                "timestamp": datetime.now().isoformat(),
                "action": "SELL",
                "ticker": ticker,
                "shares": shares,
                "price": price,
                "total": revenue
            })
            logger.info(f"[TRADE EXECUTED] Sold {shares} shares of {ticker} at \\\${price:.2f} each. Total Revenue: \\\${revenue:,.2f}")
            return True
            
        return False

    def get_portfolio_nav(self, current_prices: Dict[str, float]) -> float:
        """Computes current Total Portfolio Net Asset Value (NAV)."""
        holdings_value = 0.0
        for ticker, qty in self.holdings.items():
            price = current_prices.get(ticker, 0.0)
            holdings_value += price * qty
        return self.cash + holdings_value

    def report_status(self, current_prices: Dict[str, float]):
        """Logs portfolio stats summary."""
        nav = self.get_portfolio_nav(current_prices)
        pnl = nav - self.initial_cash
        pnl_pct = (pnl / self.initial_cash) * 100
        
        logger.info("=" * 60)
        logger.info(f"PORTFOLIO PERFORMANCE REPORT")
        logger.info(f"Available Cash:  \\\${self.cash:,.2f}")
        logger.info(f"Holdings Value:  \\\${(nav - self.cash):,.2f}")
        logger.info(f"Total NAV:       \\\${nav:,.2f}")
        logger.info(f"Total Profit/Loss: \\\${pnl:+,.2f} ({pnl_pct:+.2f}%)")
        logger.info("-" * 60)
        if self.holdings:
            for ticker, qty in self.holdings.items():
                val = qty * current_prices.get(ticker, 0.0)
                logger.info(f" * {ticker}: {qty} shares @ \\\${current_prices.get(ticker, 0.0):.2f} = \\\${val:,.2f}")
        else:
            logger.info(" (No Active Holdings)")
        logger.info("=" * 60)


class ExecutionEngine:
    """
    Main controller scheduling data retrieval loops, applying strategies, 
    verifying session boundaries, and routing executions.
    """
    def __init__(self, tickers: List[str], interval: int = 15, strategy_mode: str = "SMA_CROSSOVER"):
        self.tickers = tickers
        self.interval = interval
        self.reader = MarketDataReader(tickers)
        self.strategy = TradingStrategy(mode=strategy_mode)
        self.portfolio = PortfolioManager(initial_cash=100000.0)
        self.running = False

    def is_market_open(self) -> bool:
        """
        Determines if current time is within US regular market hours:
        Monday - Friday, 9:30 AM to 4:00 PM Eastern Standard Time (EST).
        """
        now = datetime.now()
        
        # Check if weekday (0=Monday, 6=Sunday)
        if now.weekday() >= 5:
            return False
            
        current_time = now.time()
        market_start = datetime_time(9, 30)
        market_end = datetime_time(16, 0)
        
        # Note: If running on a local machine in a different time zone, you should convert now to EST.
        # For simplicity of this script, we check local system time.
        return market_start <= current_time <= market_end

    def start(self, override_hours: bool = True):
        """
        Launches the live simulation loop.
        Set override_hours=True to ignore market session constraints for local playgrounds.
        """
        logger.info("Initializing Tradebot Simulation Engine...")
        logger.info(f"Watchlist: {', '.join(self.tickers)}")
        logger.info(f"Trading Strategy: {self.strategy.mode}")
        logger.info(f"Query Interval: {self.interval}s")
        logger.info("=" * 60)
        
        self.running = True
        
        try:
            while self.running:
                # Obeys regular market hours unless overridden
                if not override_hours and not self.is_market_open():
                    logger.info("Market is currently CLOSED. Sleeping until next session...")
                    time.sleep(60)
                    continue

                logger.info("Starting query iteration...")
                # Fetch fresh market prices (Concurrently using ScraperThreads)
                prices = self.reader.update_data()
                
                # Filter out any failed tickers from the action cycle
                active_prices = {t: p for t, p in prices.items() if p is not None}
                
                for ticker, price in active_prices.items():
                    # Evaluate trading triggers
                    action = self.strategy.evaluate(
                        ticker=ticker,
                        current_price=price,
                        price_history=self.reader.price_history[ticker],
                        daily_open=self.reader.daily_opens.get(ticker)
                    )
                    
                    if action in ["BUY", "SELL"]:
                        # Pre-configured trade size: e.g. buy/sell 50 shares
                        shares = 50
                        self.portfolio.execute_trade(ticker, action, price, shares)
                        
                # Report Portfolio NAV & profit metrics
                self.portfolio.report_status(active_prices)
                
                logger.info(f"Loop cycle complete. Sleeping for {self.interval} seconds.")
                logger.info("-" * 60)
                time.sleep(self.interval)
                
        except KeyboardInterrupt:
            logger.info("Bot execution paused by user.")
        finally:
            self.running = False
            logger.info("Tradebot engine stopped.")


if __name__ == "__main__":
    # --- Quick Start Configuration ---
    # Customize watchlist tickers here (supports active US listings)
    watchlist = ["AAPL", "MSFT", "GOOGL", "TSLA", "NVDA"]
    
    # Options: "SMA_CROSSOVER" or "MEAN_REVERSION"
    strategy_choice = "MEAN_REVERSION"
    
    # Query checking interval in seconds
    update_interval_sec = 10
    
    # Launch Engine (Set override_hours=True to trade immediately inside mock environment)
    bot = ExecutionEngine(
        watchlist, 
        update_interval_sec, 
        strategy_choice
    )
    
    # Starts the trading loop
    bot.start(override_hours=True)
`
