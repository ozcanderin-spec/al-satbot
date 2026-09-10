export interface MarketScan {
  id?: string;
  user_id?: string;
  symbol: string;
  price: number;
  volume_24h_try: number;
  change_24h_percent: number;
  ai_score: number;
  signal_type: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL';
  scan_reason: string;
  created_at?: string;

  // Peak, Trend & Volume analysis
  high_24h?: number;
  low_24h?: number;
  is_at_peak?: boolean;
  change_15m?: number;
  trend_15m?: 'UP' | 'DOWN';
  change_1h?: number;
  trend_1h?: 'UP' | 'DOWN';
  volume_dropping_15m?: boolean;
}

export interface BotConfig {
  id?: string;
  user_id?: string;
  mode: 'VIRTUAL' | 'LIVE';
  emergency_stop: boolean;
  max_open_positions: number;
  risk_per_trade_percent: number;
  min_ai_score_to_buy: number;
  stop_loss_percent: number;
  take_profit_percent: number;
  updated_at?: string;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  status: 'FILLED' | 'NEW' | 'CANCELLED';
  price: number;
  quantity: number;
  cost_try: number;
  mode: 'VIRTUAL' | 'LIVE';
  realized_pnl: number;
  created_at: string;
}

export interface Trade {
  id: string;
  symbol: string;
  entry_price: number;
  current_price: number;
  quantity: number;
  total_amount: number;
  current_value: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
  is_active: boolean;
  scan_reason?: string;
  created_at: string;
  highest_price?: number;
  is_volume_dropping?: boolean;
  change_15m?: number;
  change_1h?: number;
  trend_15m?: 'UP' | 'DOWN';
  trend_1h?: 'UP' | 'DOWN';
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  invested_try: number;
  exit_try: number;
  realized_pnl: number;
  realized_pnl_percent: number;
  exit_reason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'MANUAL' | 'EMERGENCY_STOP';
  closed_at: string;
  fee_try?: number;
}

export interface WalletState {
  cash_balance: number;
  total_portfolio_value: number;
  invested_amount: number;
  positions_market_value: number;
  total_unrealized_pnl: number;
  total_unrealized_pnl_percent: number;
  total_realized_pnl: number;
}
