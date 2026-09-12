"""
==============================================================================
GERİYE DÖNÜK TEST (BACKTEST) ARACI
==============================================================================
Bu script, trading_bot.py'deki puanlama KURALLARINI (RSI/EMA/hacim tabanlı),
Gemini'yi hiç çağırmadan, gerçek geçmiş Binance verisi üzerinde simüle eder.
Amaç: "Bu kurallar geçmişte kazandırır mıydı?" sorusuna veriyle cevap vermek.

Not: Bu bir garanti değildir — geçmişte işe yaramış olması gelecekte de işe
yarayacağı anlamına gelmez. Sadece stratejinin rastgele mi yoksa tutarlı bir
kenarı mı olduğuna dair bir fikir verir.

Çalıştırma:
python backtest.py

Gereksinimler:
pip install requests pandas
(Gemini/Supabase gerekmez, tamamen bağımsız çalışır.)
==============================================================================
"""

import requests
import pandas as pd
from typing import Dict, Any, List

# ------------------------------------------------------------------------------
# AYARLAR (trading_bot.py ile aynı tutulmuştur)
# ------------------------------------------------------------------------------
SYMBOLS_TO_TEST = [
    "BTCTRY", "ETHTRY", "SOLTRY", "AVAXTRY", "BNBTRY",
    "XRPTRY", "ADATRY", "DOGETRY", "TRXTRY", "DOTTRY",
]
INTERVAL = "1h"
CANDLE_LIMIT = 1000          # Binance'in tek istekte verdiği maksimuma yakın (~41 gün, 1 saatlik mumlarla)
MIN_AI_SCORE_TO_BUY = 75
STOP_LOSS_PERCENT = 1.2
TAKE_PROFIT_PERCENT = 5.0
TRAILING_ACTIVATION_PCT = 2.8
FEE_RATE = 0.001
TRADE_AMOUNT_TRY = 1500.0

BINANCE_URLS = ["https://data-api.binance.vision", "https://api.binance.com"]


def fetch_klines(symbol: str, interval: str, limit: int) -> pd.DataFrame:
    for base_url in BINANCE_URLS:
        try:
            resp = requests.get(
                f"{base_url}/api/v3/klines",
                params={"symbol": symbol, "interval": interval, "limit": limit},
                timeout=15,
            )
            resp.raise_for_status()
            raw = resp.json()
            df = pd.DataFrame(raw, columns=[
                "open_time", "open", "high", "low", "close", "volume",
                "close_time", "quote_volume", "trades", "taker_base", "taker_quote", "ignore"
            ])
            for col in ["open", "high", "low", "close", "volume"]:
                df[col] = pd.to_numeric(df[col], errors="coerce")
            return df
        except Exception as e:
            print(f"[UYARI] {symbol} çekilemedi ({base_url}): {e}")
            continue
    return pd.DataFrame()


def compute_rsi_series(closes: pd.Series, period: int = 14) -> pd.Series:
    delta = closes.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()
    rs = avg_gain / avg_loss.replace(0, 1e-9)
    return 100 - (100 / (1 + rs))


def score_at_index(df: pd.DataFrame, i: int) -> int:
    """trading_bot.py'deki kural setinin birebir aynısı (Gemini yerine deterministik uygulanır)."""
    if i < 50:
        return 50

    closes = df["close"].iloc[: i + 1]
    volumes = df["volume"].iloc[: i + 1]

    rsi = df["rsi"].iloc[i]
    ema20 = closes.ewm(span=20, adjust=False).mean().iloc[-1]
    ema50 = closes.ewm(span=50, adjust=False).mean().iloc[-1]
    last_close = closes.iloc[-1]

    score = 50
    if rsi < 30:
        score += 15
    elif rsi > 70:
        score -= 15

    if last_close > ema20 > ema50:
        score += 20
    elif last_close > ema20:
        score += 10
    elif last_close < ema20 < ema50:
        score -= 20
    else:
        score -= 10

    recent_volume = volumes.iloc[-1]
    avg_volume = volumes.iloc[-21:-1].mean() if len(volumes) >= 21 else volumes.mean()
    volume_ratio = recent_volume / avg_volume if avg_volume else 1.0
    if volume_ratio > 1.5:
        score += 10
    elif volume_ratio < 0.7:
        score -= 10

    change_24h = ((last_close - closes.iloc[-25]) / closes.iloc[-25] * 100) if len(closes) >= 25 else 0
    if change_24h > 15:
        score -= 10

    return max(0, min(100, score))


def simulate_symbol(symbol: str) -> List[Dict[str, Any]]:
    df = fetch_klines(symbol, INTERVAL, CANDLE_LIMIT)
    if df.empty or len(df) < 60:
        print(f"[ATLA] {symbol}: yeterli veri yok.")
        return []

    df["rsi"] = compute_rsi_series(df["close"], 14)

    trades = []
    position = None  # {"entry_price", "highest_price", "quantity"}

    for i in range(60, len(df)):
        price = df["close"].iloc[i]

        if position is None:
            score = score_at_index(df, i)
            if score >= MIN_AI_SCORE_TO_BUY:
                net_investment = TRADE_AMOUNT_TRY * (1 - FEE_RATE)
                quantity = net_investment / price
                position = {"entry_price": price, "highest_price": price, "quantity": quantity, "entry_index": i}
        else:
            position["highest_price"] = max(position["highest_price"], price)
            gross_value = position["quantity"] * price
            net_value = gross_value * (1 - FEE_RATE)
            pnl_pct = ((net_value - TRADE_AMOUNT_TRY) / TRADE_AMOUNT_TRY) * 100

            gross_peak = position["quantity"] * position["highest_price"]
            net_peak = gross_peak * (1 - FEE_RATE)
            peak_profit_pct = ((net_peak - TRADE_AMOUNT_TRY) / TRADE_AMOUNT_TRY) * 100
            is_trailing_active = peak_profit_pct >= TRAILING_ACTIVATION_PCT
            drawdown_pct = ((net_peak - net_value) / net_peak) * 100 if net_peak else 0

            should_close = False
            reason = ""
            if is_trailing_active and drawdown_pct >= STOP_LOSS_PERCENT:
                should_close, reason = True, "TRAILING_STOP"
            elif (not is_trailing_active) and pnl_pct <= -STOP_LOSS_PERCENT:
                should_close, reason = True, "STOP_LOSS"
            elif pnl_pct >= TAKE_PROFIT_PERCENT:
                should_close, reason = True, "TAKE_PROFIT"

            if should_close:
                pnl_try = net_value - TRADE_AMOUNT_TRY
                trades.append({
                    "symbol": symbol,
                    "entry_index": position["entry_index"],
                    "exit_index": i,
                    "pnl_try": round(pnl_try, 2),
                    "pnl_pct": round(pnl_pct, 2),
                    "reason": reason,
                    "holding_hours": i - position["entry_index"],
                })
                position = None

    return trades


def main():
    print("=" * 70)
    print("GERİYE DÖNÜK TEST BAŞLIYOR")
    print(f"Semboller: {SYMBOLS_TO_TEST}")
    print(f"Periyot: {INTERVAL}, ~{CANDLE_LIMIT} mum")
    print(f"Kurallar: min_score={MIN_AI_SCORE_TO_BUY}, SL={STOP_LOSS_PERCENT}%, TP={TAKE_PROFIT_PERCENT}%")
    print("=" * 70)

    all_trades = []
    for symbol in SYMBOLS_TO_TEST:
        trades = simulate_symbol(symbol)
        print(f"{symbol}: {len(trades)} işlem simüle edildi.")
        all_trades.extend(trades)

    if not all_trades:
        print("\nHiç işlem üretilmedi (eşik çok yüksek olabilir, ya da veri çekilemedi).")
        return

    df_trades = pd.DataFrame(all_trades)
    total_trades = len(df_trades)
    wins = df_trades[df_trades["pnl_try"] > 0]
    losses = df_trades[df_trades["pnl_try"] <= 0]
    win_rate = len(wins) / total_trades * 100
    total_pnl = df_trades["pnl_try"].sum()
    avg_pnl = df_trades["pnl_try"].mean()
    avg_win = wins["pnl_try"].mean() if not wins.empty else 0
    avg_loss = losses["pnl_try"].mean() if not losses.empty else 0
    avg_holding = df_trades["holding_hours"].mean()

    print("\n" + "=" * 70)
    print("SONUÇLAR")
    print("=" * 70)
    print(f"Toplam işlem sayısı     : {total_trades}")
    print(f"Kazanma oranı           : %{win_rate:.1f}  ({len(wins)} kazanan / {len(losses)} kaybeden)")
    print(f"Toplam PnL              : ₺{total_pnl:.2f}")
    print(f"Ortalama işlem PnL      : ₺{avg_pnl:.2f}")
    print(f"Ortalama kazanç         : ₺{avg_win:.2f}")
    print(f"Ortalama kayıp          : ₺{avg_loss:.2f}")
    print(f"Ortalama tutma süresi   : {avg_holding:.1f} saat")
    print(f"Sebep dağılımı:\n{df_trades['reason'].value_counts().to_string()}")
    print(f"Sembol bazlı PnL:\n{df_trades.groupby('symbol')['pnl_try'].sum().sort_values(ascending=False).to_string()}")
    print("=" * 70)
    print("NOT: Bu sonuçlar geçmiş veriye dayanır, gelecekteki performansı garanti etmez.")
    print("Sadece binance.com/data-api.binance.vision'ın verdiği kadar geriye gidebilir")
    print("(yaklaşık son 40 gün, 1 saatlik mumlarla). Daha uzun dönem için CANDLE_LIMIT")
    print("artırılamaz (Binance limiti); onun yerine 4h veya 1d interval denenebilir.")


if __name__ == "__main__":
    main()
