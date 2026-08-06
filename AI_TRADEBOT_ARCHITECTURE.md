# AI Tradebot Architecture

## Overview
This document describes the modular Python implementation of the AI-powered quantitative trading bot. The bot connects to a live market data feed, manages a virtual portfolio, and relies on a Google Gemini LLM as its core decision-making engine.

## Core Architecture

The system is split into four primary logical classes:

1. **`MarketReader` (Live Data Engine)**
   - Responsible for fetching real-time or delayed market data. 
   - While web scraping (e.g., Google Finance) can be used, this implementation uses `yfinance` to fetch reliable current prices, daily highs, lows, and volume.
   - Designed to run asynchronously to prevent blocking the main event loop during API calls.

2. **`PortfolioTracker` (Virtual Execution & State)**
   - Maintains the state of the virtual account, initializing with a default balance (e.g., $100,000).
   - Handles the execution logic: validates incoming orders from the AI, updates cash balances, and adjusts holdings.
   - Prevents over-leveraging and short-selling by enforcing strict boundaries before executing a simulated trade.

3. **`AILogicEngine` (AI Decision Brain)**
   - Acts as the core reasoning engine. It takes the structured market data and the current portfolio state, formatting them into a concise prompt context.
   - Calls the Google GenAI SDK (`gemini-2.5-flash`) utilizing `response_schema` to strictly enforce a JSON output format.
   - The AI acts as a disciplined risk manager, evaluating conditions and outputting an array of explicit `BUY`, `SELL`, or `HOLD` commands with associated quantities and reasoning.

4. **`TradingApp` (Live Session Loop)**
   - The central orchestrator that ties the components together.
   - Runs a continuous asynchronous loop, evaluating the market and executing AI decisions at a specified interval (e.g., every 60 seconds).

## Execution & Flow
1. **Fetch:** `TradingApp` triggers `MarketReader` to fetch the latest prices and volumes.
2. **Evaluate:** Data is passed to `AILogicEngine`. The LLM evaluates the context against the current `PortfolioTracker` state.
3. **Execute:** The LLM returns structured JSON orders. `TradingApp` iterates over these and dispatches them to `PortfolioTracker`.
4. **Sleep:** The loop waits for the next interval (handling rate-limits natively through spaced execution).

## Setup Instructions

1. Ensure you have Python 3.9+ installed.
2. Install the required dependencies:
   ```bash
   pip install google-genai yfinance
   ```
3. Set your Google Gemini API key as an environment variable:
   ```bash
   export GEMINI_API_KEY="your_api_key_here"
   ```
4. Run the bot:
   ```bash
   python ai_tradebot.py
   ```
