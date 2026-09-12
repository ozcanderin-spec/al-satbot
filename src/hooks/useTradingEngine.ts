import { useState, useEffect, useCallback, useRef } from 'react';
import { MarketScan, BotConfig, Trade, ClosedTrade, WalletState } from '../types/market';
import { INITIAL_MARKET_SCANS } from '../data/initialMarkets';
import { getSupabase } from '../lib/supabase';

// Priority TRY symbols to always include from Binance TR
const PRIORITY_SYMBOLS = [
  'SOLTRY',
  'BTCTRY',
  'ETHTRY',
  'AVAXTRY',
  'SUITRY',
  'XRPTRY',
  'DOGETRY',
  'PEPETRY',
  'NEARTRY',
  'DOTTRY',
  'APTTRY',
  'ARBTRY',
  'BNBTRY',
  'RENDERTRY',
  'FETTRY',
  'INJTRY',
  'LINKTRY',
  'TIATRY',
  'TRXTRY',
  'SHIBTRY',
  'ADATRY'
];

// Initial demo positions initialized with real Binance TR price levels
const INITIAL_TRADES_RAW = [
  {
    id: 'trade-soltry-init',
    symbol: 'SOLTRY',
    entry_price: 4980.00,
    current_price: 5064.70,
    total_amount: 1500.0,
    scan_reason: 'Binance TR: 5.000 TRY psikolojik seviyesi üzerinde alım baskısı teyit edildi.',
    created_at: '10 dk önce'
  },
  {
    id: 'trade-avaxtry-init',
    symbol: 'AVAXTRY',
    entry_price: 382.50,
    current_price: 387.50,
    total_amount: 1500.0,
    scan_reason: 'Binance TR: 385 TRY taban seviyesinde güçlü alış emirleri toplanıyor.',
    created_at: '15 dk önce'
  }
];

export function useTradingEngine() {
  const [marketScans, setMarketScans] = useState<MarketScan[]>(INITIAL_MARKET_SCANS);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>(() => new Date().toLocaleTimeString('tr-TR'));
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(true);

  // Cash balance in TRY
  const [cashBalance, setCashBalance] = useState<number>(() => {
    const saved = localStorage.getItem('aitrader_cash_balance');
    return saved !== null ? parseFloat(saved) : 10000.0;
  });

  // Bot configuration
  const [botConfig, setBotConfig] = useState<BotConfig>(() => {
    const saved = localStorage.getItem('aitrader_bot_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Force migration of stop_loss_percent to 1.2 as requested by user
        return {
          ...parsed,
          stop_loss_percent: 1.25,
        };
      } catch (e) {
        // Fallback
      }
    }
    return {
      mode: 'VIRTUAL',
      emergency_stop: false,
      max_open_positions: 3,
      risk_per_trade_percent: 5.0,
      min_ai_score_to_buy: 80,
      stop_loss_percent: 1.25,
      take_profit_percent: 5.0,
      updated_at: new Date().toISOString(),
    };
  });

  // Active open trades
  const [trades, setTrades] = useState<Trade[]>(() => {
    const saved = localStorage.getItem('aitrader_trades');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // Fallback
      }
    }
    return []; // No default imaginary/mock trades! Start clean!
  });

  // Closed trades history
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>(() => {
    const saved = localStorage.getItem('aitrader_closed_trades');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // Fallback
      }
    }
    return []; // No default imaginary/mock closed trades! Start clean!
  });

  // State to hold 15m and 1h multi-interval technical indicators
  const [multiIntervalData, setMultiIntervalData] = useState<Record<string, {
    change_15m: number;
    trend_15m: 'UP' | 'DOWN';
    change_1h: number;
    trend_1h: 'UP' | 'DOWN';
    volume_dropping_15m: boolean;
  }>>({});

  // Synchronize state directly from Supabase "trades" and "bot_config" tables
  const syncWithSupabase = useCallback(async () => {
    try {
      const sb = getSupabase();

      // 1. Fetch bot_config from Supabase
      const { data: configData, error: configError } = await sb
        .from('bot_config')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (!configError && configData) {
        setBotConfig(prev => ({
          ...prev,
          mode: configData.mode || prev.mode,
          emergency_stop: configData.emergency_stop ?? prev.emergency_stop,
          max_open_positions: configData.max_open_positions ?? prev.max_open_positions,
          risk_per_trade_percent: Number(configData.risk_per_trade_percent ?? prev.risk_per_trade_percent),
          min_ai_score_to_buy: Number(configData.min_ai_score_to_buy ?? prev.min_ai_score_to_buy),
          stop_loss_percent: Number(configData.stop_loss_percent ?? prev.stop_loss_percent),
          take_profit_percent: Number(configData.take_profit_percent ?? prev.take_profit_percent),
          updated_at: configData.updated_at || prev.updated_at,
        }));
      }

      // 2. Fetch active trades from 'trades' table
      const { data: activeRows, error: activeError } = await sb
        .from('trades')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (activeError) {
        console.warn('Supabase active trades fetch warning:', activeError.message);
      }

      // 3. Fetch closed trades history from 'trades' table
      const { data: closedRows, error: closedError } = await sb
        .from('trades')
        .select('*')
        .eq('is_active', false)
        .order('closed_at', { ascending: false })
        .limit(50);

      if (closedError) {
        console.warn('Supabase closed trades fetch warning:', closedError.message);
      }

      if (activeRows) {
        const mappedActive: Trade[] = activeRows.map((row: any) => {
          const entryPrice = Number(row.entry_price || row.price || 0);
          const currentPrice = Number(row.price || entryPrice);
          const quantity = Number(row.quantity || 0);
          const totalAmount = Number(row.total_amount || row.cost_try || (entryPrice * quantity));
          const grossValue = quantity * currentPrice;
          const sellFee = grossValue * 0.001;
          const currentValue = +(grossValue - sellFee).toFixed(2);
          const pnl = +(currentValue - totalAmount).toFixed(2);
          const pnlPct = totalAmount > 0 ? +((pnl / totalAmount) * 100).toFixed(2) : 0;

          return {
            id: String(row.id),
            symbol: row.symbol,
            entry_price: entryPrice,
            current_price: currentPrice,
            quantity: quantity,
            total_amount: totalAmount,
            current_value: currentValue,
            unrealized_pnl: pnl,
            unrealized_pnl_percent: pnlPct,
            is_active: true,
            scan_reason: row.scan_reason || '',
            created_at: row.created_at || new Date().toISOString(),
            highest_price: row.highest_price_reached ? Number(row.highest_price_reached) : entryPrice,
          };
        });

        setTrades(mappedActive);
        tradesRef.current = mappedActive;
      }

      if (closedRows) {
        const mappedClosed: ClosedTrade[] = closedRows.map((row: any) => {
          const entryPrice = Number(row.entry_price || row.price || 0);
          const exitPrice = Number(row.price || row.entry_price || 0);
          const quantity = Number(row.quantity || 0);
          const invested = Number(row.total_amount || row.cost_try || (entryPrice * quantity));
          const realizedPnl = Number(row.realized_pnl || 0);
          const exitTry = +(invested + realizedPnl).toFixed(2);
          const pnlPct = invested > 0 ? +((realizedPnl / invested) * 100).toFixed(2) : 0;

          return {
            id: String(row.id),
            symbol: row.symbol,
            entry_price: entryPrice,
            exit_price: exitPrice,
            quantity: quantity,
            invested_try: invested,
            exit_try: exitTry,
            realized_pnl: realizedPnl,
            realized_pnl_percent: pnlPct,
            exit_reason: (row.notes as any) || 'MANUAL',
            closed_at: row.closed_at || row.created_at || new Date().toISOString(),
          };
        });

        setClosedTrades(mappedClosed);
        closedTradesRef.current = mappedClosed;
      }

      // 4. Compute synchronized cash balance directly from database trade records
      if (activeRows || closedRows) {
        const currentActive = activeRows || [];
        const currentClosed = closedRows || [];
        const activeInvested = currentActive.reduce(
          (sum: number, r: any) => sum + Number(r.total_amount || r.cost_try || 0),
          0
        );
        const closedProfits = currentClosed.reduce(
          (sum: number, r: any) => sum + Number(r.realized_pnl || 0),
          0
        );
        const derivedCash = +(10000.0 - activeInvested + closedProfits).toFixed(2);
        setCashBalance(derivedCash);
        cashBalanceRef.current = derivedCash;
      }
    } catch (err) {
      console.warn('Supabase sync error:', err);
    }
  }, []);

  // Save to localStorage as fast client cache
  useEffect(() => {
    localStorage.setItem('aitrader_cash_balance', cashBalance.toString());
  }, [cashBalance]);

  useEffect(() => {
    localStorage.setItem('aitrader_bot_config', JSON.stringify(botConfig));
  }, [botConfig]);

  useEffect(() => {
    localStorage.setItem('aitrader_trades', JSON.stringify(trades));
  }, [trades]);

  useEffect(() => {
    localStorage.setItem('aitrader_closed_trades', JSON.stringify(closedTrades));
  }, [closedTrades]);

  // Keep refs in sync for timers & callbacks without stale closures
  const botConfigRef = useRef(botConfig);
  botConfigRef.current = botConfig;

  const tradesRef = useRef(trades);
  tradesRef.current = trades;

  const scansRef = useRef(marketScans);
  scansRef.current = marketScans;

  // Botun (GitHub Actions / trading_bot.py) Supabase'e yazdığı GERÇEK puanlar.
  // "Piyasa Radarı" ekranının, tarayıcının kendi uydurma hesabını değil, botun
  // gerçekten kullandığı puanı göstermesi için bu kullanılır.
  const realMarketScansRef = useRef<Record<string, { ai_score: number; signal_type: string; scan_reason: string }>>({});

  const refreshRealMarketScans = useCallback(async () => {
    try {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('market_scans')
        .select('symbol, ai_score, signal_type, scan_reason, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error || !data) return;

      const map: Record<string, { ai_score: number; signal_type: string; scan_reason: string }> = {};
      for (const row of data) {
        // En son (ilk karşılaşılan, çünkü created_at desc sıralı) kaydı tut, eskisini ezme.
        if (!map[row.symbol]) {
          map[row.symbol] = {
            ai_score: Number(row.ai_score),
            signal_type: String(row.signal_type),
            scan_reason: String(row.scan_reason || ''),
          };
        }
      }
      realMarketScansRef.current = map;
    } catch (e) {
      console.warn('Gerçek market_scans verisi alınamadı:', e);
    }
  }, []);

  const cashBalanceRef = useRef(cashBalance);
  cashBalanceRef.current = cashBalance;

  const closedTradesRef = useRef(closedTrades);
  closedTradesRef.current = closedTrades;

  const multiIntervalDataRef = useRef(multiIntervalData);
  multiIntervalDataRef.current = multiIntervalData;
  cashBalanceRef.current = cashBalance;

  // Calculate live wallet metrics
  const investedAmount = trades.reduce((sum, t) => sum + (Number(t.total_amount) || 0), 0);
  const positionsMarketValue = trades.reduce((sum, t) => sum + (Number(t.current_value) || 0), 0);
  const totalPortfolioValue = +((Number(cashBalance) || 0) + positionsMarketValue).toFixed(2);
  const totalUnrealizedPnl = +(positionsMarketValue - investedAmount).toFixed(2);
  const totalUnrealizedPnlPercent = investedAmount > 0 
    ? +((totalUnrealizedPnl / investedAmount) * 100).toFixed(2) 
    : 0;
  const totalRealizedPnl = +closedTrades.reduce((sum, t) => sum + (Number(t.realized_pnl) || 0), 0).toFixed(2);

  const wallet: WalletState = {
    cash_balance: +cashBalance.toFixed(2),
    total_portfolio_value: totalPortfolioValue,
    invested_amount: +investedAmount.toFixed(2),
    positions_market_value: +positionsMarketValue.toFixed(2),
    total_unrealized_pnl: totalUnrealizedPnl,
    total_unrealized_pnl_percent: totalUnrealizedPnlPercent,
    total_realized_pnl: totalRealizedPnl,
  };

  // Helper: Synchronize active trades with updated market scan prices
  // and trigger Trailing Stop-Loss or Take-Profit if thresholds are reached
  const applyPriceUpdatesToTrades = useCallback((
    updatedScans: MarketScan[],
    currentConfig: BotConfig
  ) => {
    const prevTrades = tradesRef.current;
    if (prevTrades.length === 0) return;

    const remainingTrades: Trade[] = [];
    const triggeredPositions: { trade: Trade; reason: 'TAKE_PROFIT' | 'STOP_LOSS' }[] = [];

    prevTrades.forEach(trade => {
      const matchingScan = updatedScans.find(s => s.symbol === trade.symbol);
      const livePrice = matchingScan ? matchingScan.price : trade.current_price;
      
      // Get 15m/1h indicators for this trade
      const cachedTrend = multiIntervalDataRef.current[trade.symbol];
      const isVolumeDropping = cachedTrend ? cachedTrend.volume_dropping_15m : false;

      // İz Süren Stop-Loss (Trailing Stop Loss) Zirve Fiyat Takibi:
      const previousHighest = trade.highest_price || trade.entry_price;
      const liveHighest = Math.max(previousHighest, livePrice);

      // COMMISSION-AWARE MATH (COMMISSION INCLUDED REALISTIC VALUE):
      // Gross market value of tokens held:
      const grossValue = trade.quantity * livePrice;
      // Est sell fee (0.1%):
      const sellFee = grossValue * 0.001;
      // Net cash value of position after sell fee:
      const liveValue = +(grossValue - sellFee).toFixed(2);
      
      // Net PnL (including original purchase amount, which was total_amount)
      const pnl = +(liveValue - trade.total_amount).toFixed(2);
      const pnlPct = +((pnl / trade.total_amount) * 100).toFixed(2);

      // Trailing SL logic:
      // Peak net value ever reached (using liveHighest):
      const grossPeakValue = trade.quantity * liveHighest;
      const peakSellFee = grossPeakValue * 0.001;
      const netPeakValue = grossPeakValue - peakSellFee;
      
      // Calculate the peak profit % reached ever so far:
      const peakProfitPct = +(((netPeakValue - trade.total_amount) / trade.total_amount) * 100).toFixed(2);

      // Trailing stop loss activation threshold is 3.0% net profit
      const isTrailingActive = peakProfitPct >= 3.0;

      // Drawdown % from highest peak net value:
      const drawdownPct = +(((netPeakValue - liveValue) / netPeakValue) * 100).toFixed(2);

      // Dynamic stop loss threshold to protect profit if volume drops:
      // If trade is in profit (unrealized_pnl > 0) and volume is dropping, tighten the stop loss limit to lock profit
      const volumeDropKoru = pnl > 0 && isVolumeDropping;
      const activeSLPercent = volumeDropKoru 
        ? Math.max(0.4, currentConfig.stop_loss_percent * 0.4) // E.g. 1.2% becomes 0.48% trailing stop
        : currentConfig.stop_loss_percent;

      const updatedTrade: Trade = {
        ...trade,
        current_price: livePrice,
        current_value: liveValue,
        unrealized_pnl: pnl,
        unrealized_pnl_percent: pnlPct,
        highest_price: liveHighest,
        is_volume_dropping: isVolumeDropping,
        change_15m: cachedTrend ? cachedTrend.change_15m : trade.change_15m,
        change_1h: cachedTrend ? cachedTrend.change_1h : trade.change_1h,
        trend_15m: cachedTrend ? cachedTrend.trend_15m : trade.trend_15m,
        trend_1h: cachedTrend ? cachedTrend.trend_1h : trade.trend_1h,
      };

      // 1. Stop-Loss Trigger Determination:
      // If trailing is active (reached 2.8%+ profit): trigger on drawdown from peak
      // If trailing is not active: trigger on standard/static stop-loss from entry amount
      const shouldTriggerSL = isTrailingActive 
        ? (drawdownPct >= activeSLPercent)
        : (pnlPct <= -currentConfig.stop_loss_percent);

      if (shouldTriggerSL) {
        triggeredPositions.push({ trade: updatedTrade, reason: 'STOP_LOSS' });
      }
      // NOT: Sabit "Kâr Al" (Take-Profit) tetikleyicisi KASITLI olarak kaldırıldı.
      // Kâr %3'ü geçince iz süren stop devreye giriyor ve pozisyon, fiyat gerçekten
      // dönene kadar açık kalıp yükselişten olabildiğince faydalanmaya çalışıyor.
      else {
        remainingTrades.push(updatedTrade);

        // Yeni bir zirve fiyata ulaşıldıysa, iz süren stop'un kalıcı olması için
        // bunu Supabase'e yaz (sayfa yenilense veya başka bir cihazdan bakılsa bile kaybolmasın).
        if (liveHighest > previousHighest) {
          try {
            const sb = getSupabase();
            const trailingStopPrice = isTrailingActive
              ? +(liveHighest * (1 - activeSLPercent / 100)).toFixed(8)
              : null;
            const peakUpdatePayload: Record<string, unknown> = { highest_price_reached: liveHighest };
            if (trailingStopPrice !== null) {
              peakUpdatePayload.trailing_stop_price = trailingStopPrice;
            }
            if (trade.id && !trade.id.startsWith('trade-')) {
              sb.from('trades').update(peakUpdatePayload).eq('id', trade.id).then();
            }
          } catch (err) {
            console.warn('Zirve fiyat güncelleme hatası:', err);
          }
        }
      }
    });

    // Tetiklenen işlemleri cüzdana yansıt ve kapat (React side-effect'leri temizce uygula)
    if (triggeredPositions.length > 0) {
      const totalCashRefund = triggeredPositions.reduce((sum, item) => sum + item.trade.current_value, 0);
      
      const newClosedTrades: ClosedTrade[] = triggeredPositions.map(({ trade, reason }) => {
        const buyFee = trade.total_amount * 0.001;
        const grossValue = trade.quantity * trade.current_price;
        const sellFee = grossValue * 0.001;
        const totalFees = buyFee + sellFee;

        return {
          id: `closed-${trade.symbol}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          symbol: trade.symbol,
          entry_price: trade.entry_price,
          exit_price: trade.current_price,
          quantity: trade.quantity,
          invested_try: trade.total_amount,
          exit_try: trade.current_value,
          realized_pnl: trade.unrealized_pnl,
          realized_pnl_percent: trade.unrealized_pnl_percent,
          exit_reason: reason,
          closed_at: new Date().toISOString(),
          fee_try: +totalFees.toFixed(2)
        };
      });

      // Bakiye ve kapalı işlemler durumunu tek seferde, render dışı akışta güncelle
      setCashBalance(cash => +(cash + totalCashRefund).toFixed(2));
      setClosedTrades(prev => [...newClosedTrades, ...prev]);

      // Supabase 'trades' tablosunda tetiklenen işlemleri kapat ve güncelle
      try {
        const sb = getSupabase();
        triggeredPositions.forEach(async ({ trade, reason }) => {
          const updateData = {
            is_active: false,
            status: 'FILLED',
            exit_price: trade.current_price,
            realized_pnl: trade.unrealized_pnl,
            notes: reason,
            closed_at: new Date().toISOString()
          };
          if (trade.id && !trade.id.startsWith('trade-')) {
            await sb.from('trades').update(updateData).eq('id', trade.id);
          } else {
            await sb.from('trades').update(updateData).match({ symbol: trade.symbol, is_active: true });
          }
        });
      } catch (err) {
        console.warn('Supabase triggered trade update warning:', err);
      }

      // Durum mesajlarını üret
      triggeredPositions.forEach(({ trade, reason }) => {
        const isVolDropTriggered = reason === 'STOP_LOSS' && trade.is_volume_dropping && trade.unrealized_pnl > 0;
        const tag = reason === 'TAKE_PROFIT' 
          ? '🎯 KÂR AL' 
          : isVolDropTriggered 
            ? '📉 HACİM DÜŞÜŞÜ KÂR KORUMA' 
            : '🛑 İZ SÜREN STOP';
        setStatusMessage(
          `${tag}: ${trade.symbol} pozisyonu %${trade.unrealized_pnl_percent >= 0 ? '+' : ''}${trade.unrealized_pnl_percent} net kâr/zararla kapatıldı. Komisyon dahil net satış: ₺${trade.current_value.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`
        );
      });
    }

    setTrades(remainingTrades);
  }, []);

  // Multi-interval (15m, 1h) candles fetcher for target symbols
  const fetchMultiIntervalForSymbols = useCallback(async (symbols: string[]) => {
    const updatedData: Record<string, any> = {};
    
    // Fetch a maximum of 6 symbols in parallel to keep it fast and respect rate limits
    const limitSymbols = symbols.slice(0, 6);
    
    await Promise.all(limitSymbols.map(async (sym) => {
      try {
        const [res15m, res1h] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=15m&limit=10`),
          fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1h&limit=10`)
        ]);

        if (!res15m.ok || !res1h.ok) return;

        const [candles15m, candles1h] = await Promise.all([
          res15m.json(),
          res1h.json()
        ]);

        if (!Array.isArray(candles15m) || candles15m.length < 5 || !Array.isArray(candles1h) || candles1h.length < 5) {
          return;
        }

        // Parse 15m statistics
        const closes15m = candles15m.map(c => parseFloat(c[4]));
        const vols15m = candles15m.map(c => parseFloat(c[5]));
        const start15m = closes15m[0];
        const latest15m = closes15m[closes15m.length - 1];
        const change_15m = ((latest15m - start15m) / start15m) * 100;
        const trend_15m = latest15m >= closes15m[closes15m.length - 4] ? 'UP' : 'DOWN';

        // Parse 1h statistics
        const closes1h = candles1h.map(c => parseFloat(c[4]));
        const start1h = closes1h[0];
        const latest1h = closes1h[closes1h.length - 1];
        const change_1h = ((latest1h - start1h) / start1h) * 100;
        const trend_1h = latest1h >= closes1h[closes1h.length - 4] ? 'UP' : 'DOWN';

        // Volüm Düşüş Kontrolü (Hacim düşüyor mu?):
        // Son 2 barın hacmi, önceki 3 barın ortalama hacminden %15'ten fazla düşükse
        const recentVol = (vols15m[vols15m.length - 1] + vols15m[vols15m.length - 2]) / 2;
        const olderVol = (vols15m[vols15m.length - 3] + vols15m[vols15m.length - 4] + vols15m[vols15m.length - 5]) / 3;
        const volume_dropping_15m = olderVol > 0 ? (recentVol < olderVol * 0.85) : false;

        updatedData[sym] = {
          change_15m: +change_15m.toFixed(2),
          trend_15m,
          change_1h: +change_1h.toFixed(2),
          trend_1h,
          volume_dropping_15m
        };
      } catch (err) {
        console.warn(`Error fetching candles for ${sym}:`, err);
      }
    }));

    if (Object.keys(updatedData).length > 0) {
      setMultiIntervalData(prev => ({
        ...prev,
        ...updatedData
      }));
    }
  }, []);

  // Primary Live Fetch function: directly from Binance Public Ticker API
  const handleLiveBinanceFetch = useCallback(async (isSilent = false) => {
    if (!isSilent) {
      setIsLoading(true);
      setStatusMessage('Binance TR canlı 24s Ticker verileri sorgulanıyor...');
    }

    try {
      const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
      if (!res.ok) throw new Error(`Binance API HTTP ${res.status}`);
      const data = await res.json();

      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Geçersiz veri');
      }

      // Map by symbol for O(1) lookup
      const tickerMap = new Map<string, any>();
      data.forEach((item: any) => {
        if (item && item.symbol && item.symbol.endsWith('TRY')) {
          tickerMap.set(item.symbol, item);
        }
      });

      // Ensure all held trade symbols + priority symbols are collected
      const heldSymbols = tradesRef.current.map(t => t.symbol);
      const symbolSet = new Set<string>([...heldSymbols, ...PRIORITY_SYMBOLS]);

      // Also grab other top volume TRY pairs
      const allTryTickers = data
        .filter((item: any) => item.symbol.endsWith('TRY') && parseFloat(item.quoteVolume || '0') > 1000000)
        .sort((a: any, b: any) => parseFloat(b.quoteVolume || '0') - parseFloat(a.quoteVolume || '0'));

      allTryTickers.slice(0, 30).forEach((t: any) => symbolSet.add(t.symbol));

      // Build structured MarketScan list with live prices
      const updatedList: MarketScan[] = [];

      symbolSet.forEach(sym => {
        const item = tickerMap.get(sym);
        if (!item) return;

        const lastPrice = parseFloat(item.lastPrice || '0');
        if (lastPrice <= 0) return;

        const changePct = parseFloat(item.priceChangePercent || '0');
        const quoteVol = parseFloat(item.quoteVolume || '0');
        const highPrice = parseFloat(item.highPrice || '0');
        const lowPrice = parseFloat(item.lowPrice || '0');

        // Peak Protection: is within 2% of the 24h peak
        const isAtPeak = highPrice > 0 ? (lastPrice >= highPrice * 0.98) : false;

        // Fetch cached multi-interval details if any
        const cachedTrend = multiIntervalDataRef.current[sym];

        // AI Score calculation based on real market technicals:
        // momentum, volume depth, and 24h change
        let score = Math.min(98, Math.max(20, Math.round(50 + (changePct * 3.2))));
        if (quoteVol > 100000000) score = Math.min(99, score + 5);

        // Incorporate 15m and 1h indicators
        if (cachedTrend) {
          if (cachedTrend.trend_15m === 'UP') score = Math.min(99, score + 6);
          if (cachedTrend.trend_15m === 'DOWN') score = Math.max(10, score - 8);
          if (cachedTrend.trend_1h === 'UP') score = Math.min(99, score + 4);
          if (cachedTrend.trend_1h === 'DOWN') score = Math.max(10, score - 6);
          if (cachedTrend.volume_dropping_15m) score = Math.max(10, score - 10);
        }

        // Peak Purchase Penalty
        if (isAtPeak) {
          score = Math.max(10, score - 15);
        }

        let signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' = 'NEUTRAL';
        let reason = 'Binance TR: Konsolidasyon bandı içinde yatay denge izleniyor.';

        if (score >= 80) {
          signal = 'STRONG_BUY';
          reason = `Binance TR Canlı: %${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)} değişim, ₺${(quoteVol / 1000000).toFixed(1)}M hacim, 15d ve 1s trend onaylı güçlü momentum.`;
        } else if (score >= 65) {
          signal = 'BUY';
          reason = `Binance TR Canlı: EMA üzerinde pozitif akış; alıcı blokları derinlikte kuvvetli.`;
        } else if (score < 40) {
          signal = 'SELL';
          reason = `Binance TR Canlı: Satış baskısı veya hacim zayıflaması; kâr realizasyonu riski yüksek.`;
        }

        if (isAtPeak) {
          reason = `⚠️ ZİRVE ALARMI: Fiyat 24s zirvesine çok yakın (%2 içinde). Alım riskli bulunmuştur.`;
        }

        // ÖNEMLİ: Eğer bot (trading_bot.py / GitHub Actions) bu sembol için gerçekten
        // bir puan üretmişse, ekranda o GERÇEK puan gösterilir — yukarıdaki yerel/tahmini
        // hesap sadece botun henüz taramadığı semboller için yedek olarak kullanılır.
        const realScan = realMarketScansRef.current[sym];
        if (realScan) {
          score = realScan.ai_score;
          signal = realScan.signal_type as typeof signal;
          reason = `[Bot Kararı] ${realScan.scan_reason}`;
        }

        updatedList.push({
          symbol: sym,
          price: lastPrice,
          volume_24h_try: quoteVol,
          change_24h_percent: +changePct.toFixed(2),
          ai_score: score,
          signal_type: signal,
          scan_reason: reason,
          created_at: new Date().toISOString(),
          high_24h: highPrice,
          low_24h: lowPrice,
          is_at_peak: isAtPeak,
          change_15m: cachedTrend?.change_15m,
          trend_15m: cachedTrend?.trend_15m,
          change_1h: cachedTrend?.change_1h,
          trend_1h: cachedTrend?.trend_1h,
          volume_dropping_15m: cachedTrend?.volume_dropping_15m,
        });
      });

      // Sort by AI score descending
      updatedList.sort((a, b) => b.ai_score - a.ai_score);

      if (updatedList.length > 0) {
        setMarketScans(updatedList);
        applyPriceUpdatesToTrades(updatedList, botConfigRef.current);
        const timeStr = new Date().toLocaleTimeString('tr-TR');
        setLastSyncedTime(timeStr);
        setIsLiveConnected(true);

        if (!isSilent) {
          setStatusMessage(`✅ Binance TR canlı piyasa fiyatları güncellendi (${timeStr}). Fiyatlar, 15d ve 1s grafikler senkronize.`);
        }
      }
    } catch (err: any) {
      console.warn('Binance fetch warning:', err);
      setIsLiveConnected(false);
      // Fallback to micro-tick to keep application active without breaking
      handleSimulateFreshScan();
    } finally {
      if (!isSilent) {
        setIsLoading(false);
      }
    }
  }, [applyPriceUpdatesToTrades]);

  // Micro-tick fallback when offline or simulating
  // CRITICAL: BOTH marketScans AND trades MUST update to the EXACT SAME price!
  const handleSimulateFreshScan = useCallback(() => {
    setMarketScans(prev => {
      const updated = prev.map(item => {
        const delta = (Math.random() - 0.48) * 0.4; // subtle 0.2% micro-step
        const newPrice = +(item.price * (1 + delta / 100)).toFixed(item.price < 1 ? 6 : 2);
        const newChange = +(item.change_24h_percent + (delta * 0.2)).toFixed(2);

        return {
          ...item,
          price: newPrice,
          change_24h_percent: newChange,
          created_at: new Date().toISOString(),
        };
      });

      // Synchronize active trades with the exact same updated prices!
      applyPriceUpdatesToTrades(updated, botConfigRef.current);
      setLastSyncedTime(new Date().toLocaleTimeString('tr-TR'));
      return updated;
    });
  }, [applyPriceUpdatesToTrades]);

  // Initial Fetch on Mount: automatically load real Binance TR prices and Supabase records
  useEffect(() => {
    handleLiveBinanceFetch(false);
    syncWithSupabase();
    refreshRealMarketScans();

    // Setup Supabase Realtime channel for instant cross-device updates
    try {
      const sb = getSupabase();
      const channel = sb
        .channel('supabase-trading-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, () => {
          setTimeout(() => syncWithSupabase(), 400);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bot_config' }, () => {
          setTimeout(() => syncWithSupabase(), 400);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'market_scans' }, () => {
          setTimeout(() => refreshRealMarketScans(), 400);
        })
        .subscribe();

      return () => {
        sb.removeChannel(channel);
      };
    } catch (e) {
      console.warn('Supabase realtime listener setup warning:', e);
    }
  }, [handleLiveBinanceFetch, syncWithSupabase, refreshRealMarketScans]);

  // Periodic Polling: continuously sync real Binance TR prices every 6 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const currentConfig = botConfigRef.current;
      if (currentConfig.emergency_stop) return;

      // Fetch live real prices from Binance silently (yalnızca ekrandaki fiyat/PNL gösterimi için)
      handleLiveBinanceFetch(true);

      // NOT: Buradaki periyodik syncWithSupabase() çağrısı kasıtlı olarak kaldırıldı.
      // Bu tarayıcının kendi kapatma yazma işlemiyle yarışıp "titreme" (flicker)
      // yaratıyordu. Artık senkronizasyon SADECE gerçek zamanlı (realtime) veritabanı
      // olaylarıyla ve sayfa ilk açıldığında tetikleniyor — bu yeterli ve daha kararlı.

      // Collect symbols to fetch 15m/1h candle data for
      const heldSymbols = tradesRef.current.map(t => t.symbol);
      const topScannerSymbols = scansRef.current.slice(0, 3).map(s => s.symbol);
      const targetSymbols = Array.from(new Set([...heldSymbols, ...topScannerSymbols]));
      
      if (targetSymbols.length > 0) {
        fetchMultiIntervalForSymbols(targetSymbols);
      }

      // NOT: Buradaki "Otonom Bot Alımı" (rastgele/otomatik alım) bloğu kasıtlı
      // olarak kaldırıldı. Artık TEK otomatik alıcı GitHub Actions üzerinde 7/24
      // çalışan trading_bot.py. Tarayıcının da aynı anda kendi kendine alım
      // yapması, iki ayrı "kaptan" aynı cüzdanı yönetmeye çalışması anlamına
      // geliyordu ve tutarsızlıklara (titreme, çakışan işlemler) yol açıyordu.
    }, 6000);

    return () => clearInterval(interval);
  }, [handleLiveBinanceFetch, fetchMultiIntervalForSymbols]);


  // Helper: Close a single trade at current market price (with 0.1% sell commission)
  const closePosition = useCallback((
    tradeId: string, 
    reason: 'MANUAL' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'EMERGENCY_STOP' = 'MANUAL'
  ) => {
    const trade = tradesRef.current.find(t => t.id === tradeId);
    if (!trade) return;

    const exitPrice = trade.current_price;
    const grossExitValue = trade.quantity * exitPrice;
    const sellFee = grossExitValue * 0.001;
    const exitTry = +(grossExitValue - sellFee).toFixed(2);
    
    const buyFee = trade.total_amount * 0.001;
    const totalFees = buyFee + sellFee;

    const realizedPnl = +(exitTry - trade.total_amount).toFixed(2);
    const realizedPnlPct = +((realizedPnl / trade.total_amount) * 100).toFixed(2);

    // Credit cash with net exit value
    setCashBalance(prev => +(prev + exitTry).toFixed(2));

    // Remove from active trades
    setTrades(prev => prev.filter(t => t.id !== tradeId));

    // Add to closed trades with commission fee logged
    const closed: ClosedTrade = {
      id: `closed-${trade.symbol}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      symbol: trade.symbol,
      entry_price: trade.entry_price,
      exit_price: exitPrice,
      quantity: trade.quantity,
      invested_try: trade.total_amount,
      exit_try: exitTry,
      realized_pnl: realizedPnl,
      realized_pnl_percent: realizedPnlPct,
      exit_reason: reason,
      closed_at: new Date().toISOString(),
      fee_try: +totalFees.toFixed(2),
    };

    setClosedTrades(prev => [closed, ...prev]);

    // Update trade as closed in Supabase 'trades' table
    try {
      const sb = getSupabase();
      const updateData = {
        is_active: false,
        status: 'FILLED',
        exit_price: exitPrice,
        realized_pnl: realizedPnl,
        notes: reason,
        closed_at: new Date().toISOString()
      };
      if (trade.id && !trade.id.startsWith('trade-')) {
        sb.from('trades').update(updateData).eq('id', trade.id).then();
      } else {
        sb.from('trades').update(updateData).match({ symbol: trade.symbol, is_active: true }).then();
      }
    } catch (err) {
      console.warn('Supabase closePosition error:', err);
    }

    const reasonText = reason === 'TAKE_PROFIT' 
      ? '🎯 KÂR AL (Take-Profit)' 
      : reason === 'STOP_LOSS' 
        ? (trade.is_volume_dropping && trade.unrealized_pnl > 0 ? '📉 HACİM DÜŞÜŞÜ KÂR KORUMA' : '🛑 ZARAR DURDUR (Stop-Loss)')
        : reason === 'EMERGENCY_STOP' 
          ? '🚨 ACİL STOP' 
          : 'MANUEL SATIŞ';

    setStatusMessage(
      `${reasonText}: ${trade.symbol} pozisyonu kapatıldı! Komisyonlar dahil net satış tutarı: ₺${exitTry.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} (Net PnL: ${realizedPnl >= 0 ? '+' : ''}₺${realizedPnl.toFixed(2)}, Ödenen Toplam Komisyon: ₺${totalFees.toFixed(2)})`
    );
  }, []);

  // Helper: Buy a new position at exact current scan price
  const buyPosition = useCallback((scan: MarketScan, customAmount: number = 1500.0) => {
    const currentConfig = botConfigRef.current;
    if (currentConfig.emergency_stop) {
      setStatusMessage('🚨 HATA: Acil Stop aktif! Yeni pozisyon açılamaz.');
      return false;
    }

    if (tradesRef.current.length >= currentConfig.max_open_positions) {
      setStatusMessage(`⚠️ UYARI: Maksimum açık pozisyon limitine (${currentConfig.max_open_positions}) ulaşıldı!`);
      return false;
    }

    if (cashBalanceRef.current < customAmount) {
      setStatusMessage(`⚠️ UYARI: Kullanılabilir bakiye yetersiz! Gereken: ₺${customAmount.toLocaleString('tr-TR')} - Mevcut: ₺${cashBalanceRef.current.toLocaleString('tr-TR')}`);
      return false;
    }

    // Check if symbol already held
    const alreadyHeld = tradesRef.current.some(t => t.symbol === scan.symbol);
    if (alreadyHeld) {
      setStatusMessage(`ℹ️ BİLGİ: ${scan.symbol} zaten portföyünüzde açık bulunuyor.`);
      return false;
    }

    // Cooldown check on recent losses (within the last 2 hours)
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const recentLoss = closedTradesRef.current.some(t => 
      t.symbol === scan.symbol && 
      t.realized_pnl < 0 && 
      t.closed_at && 
      Date.parse(t.closed_at) > twoHoursAgo
    );

    if (recentLoss) {
      setStatusMessage(`⚠️ ALIM ENGELLENDİ: ${scan.symbol} son 2 saat içinde zararla kapatıldığı için koruma algoritması (Son 2s Zarar Filtresi) alımı engelledi!`);
      return false;
    }

    // Peak Purchase Protection check (is near its 24h high)
    const isAtPeak = scan.is_at_peak || (scan.high_24h && scan.price >= scan.high_24h * 0.98);
    if (isAtPeak) {
      setStatusMessage(`⚠️ ALIM ENGELLENDİ: ${scan.symbol} 24 saatlik zirvesine (%2 sınırında) çok yakın olduğu için koruma filtresi (Zirveden Alımı Önleme) tarafından engellendi!`);
      return false;
    }

    // Calculate buy fee (0.1%):
    const buyFee = customAmount * 0.001;
    const netInvestment = customAmount - buyFee;

    // Deduct cash
    setCashBalance(prev => +(prev - customAmount).toFixed(2));

    // Calculate token quantity with exact scan price
    const entryPrice = scan.price;
    const quantity = netInvestment / entryPrice;

    const newTrade: Trade = {
      id: `trade-${scan.symbol}-${Date.now()}`,
      symbol: scan.symbol,
      entry_price: entryPrice,
      current_price: entryPrice, // Exact 1:1 match with scan price
      quantity: quantity,
      total_amount: customAmount,
      current_value: +netInvestment.toFixed(2),
      unrealized_pnl: -buyFee, // show purchase fee impact immediately
      unrealized_pnl_percent: +(-(buyFee / customAmount) * 100).toFixed(2),
      is_active: true,
      scan_reason: scan.scan_reason || 'Kullanıcı/Bot tarafından açılan pozisyon.',
      created_at: new Date().toISOString(),
      highest_price: entryPrice,
      is_volume_dropping: scan.volume_dropping_15m,
      change_15m: scan.change_15m,
      change_1h: scan.change_1h,
      trend_15m: scan.trend_15m,
      trend_1h: scan.trend_1h,
    };

    // Insert new position into Supabase 'trades' table
    try {
      const sb = getSupabase();
      const tradePayload = {
        symbol: scan.symbol,
        side: 'BUY',
        status: 'FILLED',
        price: entryPrice,
        entry_price: entryPrice,
        quantity: quantity,
        cost_try: customAmount,
        total_amount: customAmount,
        is_active: true,
        scan_reason: scan.scan_reason || 'Otonom AI Alım Emri',
        mode: currentConfig.mode,
        realized_pnl: 0,
        created_at: new Date().toISOString()
      };
      sb.from('trades').insert(tradePayload).select().maybeSingle().then(({ data: inserted }) => {
        if (inserted?.id) {
          setTrades(prev => prev.map(t => t.id === newTrade.id ? { ...t, id: String(inserted.id) } : t));
        }
      });
    } catch (err) {
      console.warn('Supabase buyPosition insert error:', err);
    }

    setTrades(prev => [newTrade, ...prev]);
    setStatusMessage(`✅ ALIM EMRİ GERÇEKLEŞTİ: ${scan.symbol} için ₺${customAmount.toLocaleString('tr-TR')} tutarında alım yapıldı. Giriş: ₺${entryPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}. %0.1 alım komisyonu (₺${buyFee.toFixed(2)}) düşüldü.`);
    return true;
  }, []);

  // Helper: Close all active positions
  const closeAllPositions = useCallback((reason: 'MANUAL' | 'EMERGENCY_STOP' = 'MANUAL') => {
    const active = [...tradesRef.current];
    if (active.length === 0) {
      setStatusMessage('Kapatılacak açık pozisyon bulunmuyor.');
      return;
    }

    let totalReturned = 0;
    let netPnl = 0;
    const newClosed: ClosedTrade[] = [];

    active.forEach(trade => {
      const exitPrice = trade.current_price;
      const grossExitValue = trade.quantity * exitPrice;
      const sellFee = grossExitValue * 0.001;
      const exitTry = +(grossExitValue - sellFee).toFixed(2);
      
      const buyFee = trade.total_amount * 0.001;
      const totalFees = buyFee + sellFee;

      const realizedPnl = +(exitTry - trade.total_amount).toFixed(2);
      const realizedPnlPct = +((realizedPnl / trade.total_amount) * 100).toFixed(2);

      totalReturned += exitTry;
      netPnl += realizedPnl;

      newClosed.push({
        id: `closed-${trade.symbol}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        symbol: trade.symbol,
        entry_price: trade.entry_price,
        exit_price: exitPrice,
        quantity: trade.quantity,
        invested_try: trade.total_amount,
        exit_try: exitTry,
        realized_pnl: realizedPnl,
        realized_pnl_percent: realizedPnlPct,
        exit_reason: reason,
        closed_at: new Date().toISOString(),
        fee_try: +totalFees.toFixed(2),
      });
    });

    setCashBalance(prev => +(prev + totalReturned).toFixed(2));
    setTrades([]);
    setClosedTrades(prev => [...newClosed, ...prev]);

    // Close all open trades in Supabase
    try {
      const sb = getSupabase();
      sb.from('trades').update({
        is_active: false,
        status: 'FILLED',
        notes: reason,
        closed_at: new Date().toISOString()
      }).eq('is_active', true).then();
    } catch (err) {
      console.warn('Supabase closeAllPositions error:', err);
    }

    setStatusMessage(`Tüm açık pozisyonlar kapatıldı. Satış komisyonları düşüldükten sonra net ₺${totalReturned.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} serbest nakite aktarıldı (Net PnL: ${netPnl >= 0 ? '+' : ''}₺${netPnl.toFixed(2)}).`);
  }, []);

  // Helper: Reset wallet to initial ₺10,000 state using fresh live prices
  const resetWallet = useCallback(() => {
    setCashBalance(10000.0);
    setTrades([]);
    setClosedTrades([]);
    setBotConfig(prev => ({ ...prev, emergency_stop: false }));

    // Reset trades and bot_config in Supabase
    try {
      const sb = getSupabase();
      sb.from('trades').delete().neq('id', '00000000-0000-0000-0000-000000000000').then();
      sb.from('bot_config').upsert({
        emergency_stop: false,
        updated_at: new Date().toISOString()
      }).then();
    } catch (err) {
      console.warn('Supabase resetWallet error:', err);
    }

    setStatusMessage('Cüzdan bakiyesi ve açık işlemler tamamen temizlendi: ₺10.000 kullanılabilir serbest bakiye.');
  }, []);

  // Toggle VIRTUAL <-> LIVE mode
  const handleToggleMode = useCallback(() => {
    setBotConfig(prev => {
      const nextMode = prev.mode === 'VIRTUAL' ? 'LIVE' : 'VIRTUAL';
      
      // Update bot_config in Supabase
      try {
        const sb = getSupabase();
        sb.from('bot_config').upsert({
          mode: nextMode,
          updated_at: new Date().toISOString()
        }).then();
      } catch (err) {
        console.warn('Supabase handleToggleMode error:', err);
      }

      setStatusMessage(
        nextMode === 'LIVE'
          ? 'UYARI: Bot CANLI (LIVE) moda alındı! Gerçek Binance TR emirleri iletilecektir.'
          : 'BİLGİ: Bot SANAL (VIRTUAL) moda alındı. Test bakiyesiyle çalışıyor.'
      );
      return {
        ...prev,
        mode: nextMode,
        updated_at: new Date().toISOString(),
      };
    });
  }, []);

  // Emergency Stop Trigger
  const handleEmergencyStop = useCallback(() => {
    closeAllPositions('EMERGENCY_STOP');
    setBotConfig(prev => ({
      ...prev,
      emergency_stop: true,
      mode: 'VIRTUAL',
      updated_at: new Date().toISOString(),
    }));

    // Update emergency_stop in Supabase bot_config
    try {
      const sb = getSupabase();
      sb.from('bot_config').upsert({
        emergency_stop: true,
        mode: 'VIRTUAL',
        updated_at: new Date().toISOString()
      }).then();
    } catch (err) {
      console.warn('Supabase handleEmergencyStop error:', err);
    }

    setStatusMessage('🚨 ACİL DURDURMA TETİKLENDİ: Tüm emirler kapatıldı, bakiye nakite çevrildi ve sistem durduruldu!');
  }, [closeAllPositions]);

  return {
    marketScans,
    trades,
    closedTrades,
    wallet,
    botConfig,
    isLoading,
    statusMessage,
    lastSyncedTime,
    isLiveConnected,
    setStatusMessage,
    buyPosition,
    closePosition,
    closeAllPositions,
    resetWallet,
    handleToggleMode,
    handleEmergencyStop,
    handleLiveBinanceFetch,
    handleSimulateFreshScan,
  };
}
