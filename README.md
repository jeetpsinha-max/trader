# 📈 Trader - AI Quantitative Trading & Market Intelligence Platform

[![CI/CD Pipeline](https://github.com/Avinashb722/trader/actions/workflows/ci.yml/badge.svg)](https://github.com/Avinashb722/trader/actions)
[![Powered by Gemini AI](https://img.shields.io/badge/Powered%20by-Gemini%202.5-4285F4?style=flat&logo=google&logoColor=white)](https://ai.google.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Trader** is an enterprise-grade AI quantitative trading platform and market intelligence suite powered by Google Gemini 2.5 Flash (`@google/genai`). Trader combines real-time technical analysis, sentiment scraping, trade signal generation, and local quantitative fallback algorithms for high-frequency strategy execution.

---

## 🏗 System Architecture

```mermaid
graph TD
    Client([Trader Terminal - React + Recharts]) -->|HTTPS API| Server[Express Backend Server]
    Server -->|CORS & Security| Middleware[Rate Limiting & Security Headers]
    Middleware -->|Router| Services{Trader Services}
    
    Services -->|Market Scraper| Scraper[Cheerio Market News Scraper]
    Services -->|Yahoo Finance API| QuoteEngine[Real-Time Quote Service]
    Services -->|AI Trade Decision| GeminiSDK[@google/genai SDK]
    
    GeminiSDK -->|API Request| Gemini25[Google Gemini 2.5 Flash API]
    Gemini25 -->|Trade Signals & Confidence| GeminiSDK
    GeminiSDK -->|JSON Schema Output| Services
    
    Services -->|Portfolio State| Client

    subgraph Local Quant Engine
        Server -.->|Rate Limit Cooldown / Key Missing| QuantFallback[Local High-Frequency Quant Engine]
        QuantFallback -.->|Momentum & Mean-Reversion Signals| Client
    end
```

---

## ⚡ Key Features

- 🧠 **Gemini 2.5 Flash Trade Signal Engine**: Structured trade decisions (BUY/SELL/HOLD with confidence scores) using `@google/genai`.
- ⚡ **Local Quant Fallback Engine**: High-frequency rule-based trade execution (Momentum, Value, Mean Reversion, Scalping) when API limits are reached.
- 📊 **Real-Time Market Data**: Scrapes live financial headlines and fetches market quotes via Yahoo Finance APIs.
- 🔒 **Security & Rate Protection**: Pre-configured CORS, rate-limiting headers (`X-RateLimit-*`), and 60-second cooldown protection.
- 🧪 **Vitest Test Suite**: Comprehensive integration testing validating financial calculations and endpoints.

---

## ⚙️ Environment Variables

Create a `.env` file in the project root:

```env
PORT=3000
NODE_ENV=development
GEMINI_API_KEY=your_google_gemini_api_key_here
```

---

## 🚀 Quick Setup & Installation

### Prerequisites
- **Node.js**: `v18.0.0` or higher
- **npm**: `v9.0.0` or higher
- **Python**: `3.10` or higher (optional, for standalone bot scripts)

### Steps

1. **Clone the Repository**
   ```bash
   git clone https://github.com/Avinashb722/trader.git
   cd trader
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment**
   ```bash
   cp .env.example .env
   # Add your GEMINI_API_KEY into .env
   ```

4. **Start Development Server**
   ```bash
   npm run server
   ```
   Server running at `http://localhost:3000`.

---

## 📡 API Reference

### Health Check
- **GET** `/api/health`
- **Response**:
  ```json
  {
    "status": "ok",
    "service": "trader-ai-api",
    "timestamp": "2026-08-12T12:00:00Z",
    "version": "1.0.0",
    "geminiConfigured": true
  }
  ```

### Ask Gemini AI Agent
- **POST** `/api/gemini/ask`
- **Body**:
  ```json
  {
    "prompt": "Explain the impact of fed interest rate changes on technology stocks.",
    "model": "gemini-2.5-flash"
  }
  ```

### Technical & Sentiment Analysis
- **POST** `/api/market/analysis`
- **Body**:
  ```json
  {
    "ticker": "AAPL",
    "marketData": { "price": 185.50, "prevClose": 182.00 }
  }
  ```

### Trade Signal Generation
- **POST** `/api/trade/signal`
- **Body**:
  ```json
  {
    "ticker": "NVDA",
    "marketData": { "price": 120.00 }
  }
  ```

---

## 🧪 Testing Guide

Run the Vitest integration suite:

```bash
# Execute unit & integration tests
npm test

# Run linter
npm run lint
```

---

## 📄 License

This project is open-source software licensed under the [MIT License](LICENSE).
