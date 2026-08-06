export interface Stock {
  symbol: string;
  name: string;
  price: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  history: { time: string; price: number; smaShort?: number; smaLong?: number }[];
}

export type StrategyType = "SMA_CROSSOVER" | "MEAN_REVERSION";

export interface StrategyParams {
  type: StrategyType;
  smaShortWindow: number;
  smaLongWindow: number;
  reversionPercent: number; // e.g. Buy if drops 1.5% below open, Sell if rises 1.5% above
  orderSizeShares: number; // e.g. 50 shares
  checkInterval: number; // in seconds
  marketSessionOnly: boolean;
}

export interface Portfolio {
  cash: number;
  holdings: { [symbol: string]: number }; // symbol -> shares quantity
  initialCash: number;
}

export interface TradeLog {
  id: string;
  timestamp: string;
  type: 'BUY' | 'SELL' | 'SYSTEM' | 'STRATEGY' | 'ERROR';
  symbol?: string;
  price?: number;
  shares?: number;
  message: string;
}

export interface MarketSession {
  isLive: boolean; // Is it currently regular market hours (e.g., 9:30 AM - 4:00 PM EST)
  simulatedTime: string; // The running mock clock
}
