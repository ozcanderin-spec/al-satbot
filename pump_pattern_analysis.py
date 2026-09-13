"""
==============================================================================
PUMP ÖRÜNTÜ ANALİZİ (Geriye Dönük, ~6 Aylık)
==============================================================================
Amaç: "Büyük yükselişlerden (pump) ÖNCE ortak bir sinyal var mıydı?" sorusuna
gerçek geçmiş veriyle cevap aramak. Bulunan örüntüler, trading_bot.py'deki
puanlama ağırlıklarını daha bilinçli ayarlamak için kullanılabilir.

ÖNEMLİ SINIRLAMALAR (dürüstçe belirtilmeli):
- Hayatta kalma yanlılığı (survivorship bias): Şu an Binance'te listeli olan
  coinler taranıyor; 6 ay içinde listeden kaldırılmış coinler dahil değil.
  Bu, sonuçları gerçekte olduğundan biraz daha "iyimser" gösterebilir.
- Küçük örneklem: Bazı coinlerde çok az "pump" olayı olabilir, istatistik
  güvenilirliği düşük olabilir.
- Korelasyon, nedensellik değildir. "RSI düşükken pump olmuş" demek,
  "RSI düşük olursa pump olur" demek değildir.

Çalıştırma: python pump_pattern_analysis.py
Gereksinimler: pip install requests pandas
==============================================================================
"""

import requests
import pandas as pd
from typing import Dict, Any, List

BINANCE_URLS = ["https://data-api.binance.vision", "https://api.binance.com"]
DAYS_OF_HISTORY = 200          # ~6.5 ay (1 günlük mumlarla)
PUMP_DAILY_THRESHOLD_PCT = 15.0   # Bir günde bu kadar artış = pump
PUMP_WEEKLY_THRESHOLD_PCT = 40.0  # 7 günde bu kadar artış = pump
LOOKBACK_POINTS = [1, 3, 7]        # Pump'tan kaç gün ÖNCESİNE bakılacak
MIN_HISTORY_BEFORE_EVENT = 35       # Göstergeleri hesaplamak için gereken minimum geçmiş gün


def fetch_try_symbols() -> List[str]:
    for base_url in BINANCE_URLS:
        try:
            resp = requests.get(f"{base_url}/api/v3/ticker/24hr", timeout=15)
            resp.raise_for_status()
            data = resp.json()
            symbols = [d["symbol"] for d in data if d["symbol"].endswith("TRY")
                       and float(d.get("quoteVolume", 0) or 0) > 200000]
            print(f"{len(symbols)} adet likit TRY paritesi bulundu.")
            return symbols
        except Exception as e:
            print(f"[UYARI] {base_url} başarısız: {e}")
            continue
    return []


def fetch_daily_klines(symbol: str, limit: int) -> pd.DataFrame:
    for base_url in BINANCE_URLS:
        try:
            resp = requests.get(
                f"{base_url}/api/v3/klines",
                params={"symbol": symbol, "interval": "1d", "limit": limit},
                timeout=15,
            )
            resp.raise_for_status()
            raw = resp.json()
            df = pd.DataFrame(raw, columns=[
                "open_time", "open", "high", "low", "close", "volume", "close_time",
                "quote_volume", "trades", "taker_base", "taker_quote", "ignore"
            ])
            for col in ["close", "high", "low", "volume"]:
                df[col] = pd.to_numeric(df[col], errors="coerce")
            return df
        except Exception as e:
            print(f"[UYARI] {symbol} çekilemedi ({base_url}): {e}")
            continue
    return pd.DataFrame()


def compute_rsi(closes: pd.Series, period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    delta = closes.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window=period).mean().iloc[-1]
    avg_loss = loss.rolling(window=period).mean().iloc[-1]
    if avg_loss == 0:
        return 100.0
    return round(100 - (100 / (1 + (avg_gain / avg_loss))), 2)


def indicators_at_index(df: pd.DataFrame, i: int) -> Dict[str, Any]:
    """i indeksine kadar olan veriyle (ileri bakmadan) göstergeleri hesaplar."""
    closes = df["close"].iloc[: i + 1]
    volumes = df["volume"].iloc[: i + 1]
    highs = df["high"].iloc[: i + 1]

    rsi = compute_rsi(closes, 14)
    ema20 = closes.ewm(span=20, adjust=False).mean().iloc[-1]
    ema50 = closes.ewm(span=50, adjust=False).mean().iloc[-1] if len(closes) >= 50 else closes.mean()
    last_close = closes.iloc[-1]

    if last_close > ema20 > ema50:
        trend = "GÜÇLÜ_YÜKSELİŞ"
    elif last_close > ema20:
        trend = "YÜKSELİŞ"
    elif last_close < ema20 < ema50:
        trend = "GÜÇLÜ_DÜŞÜŞ"
    else:
        trend = "DÜŞÜŞ"

    recent_vol = volumes.iloc[-1]
    avg_vol = volumes.iloc[-21:-1].mean() if len(volumes) >= 21 else volumes.mean()
    volume_ratio = recent_vol / avg_vol if avg_vol else 1.0

    high_30d = highs.iloc[-30:].max() if len(highs) >= 30 else highs.max()
    pct_from_high = ((high_30d - last_close) / high_30d * 100) if high_30d else 0.0

    return {"rsi": rsi, "trend": trend, "volume_ratio": round(volume_ratio, 2), "pct_from_30d_high": round(pct_from_high, 2)}


def find_pump_events(df: pd.DataFrame, symbol: str) -> List[Dict[str, Any]]:
    events = []
    closes = df["close"]
    for i in range(MIN_HISTORY_BEFORE_EVENT, len(closes)):
        daily_change = ((closes.iloc[i] - closes.iloc[i - 1]) / closes.iloc[i - 1]) * 100 if closes.iloc[i - 1] else 0
        weekly_change = ((closes.iloc[i] - closes.iloc[i - 7]) / closes.iloc[i - 7]) * 100 if i >= 7 and closes.iloc[i - 7] else 0

        if daily_change >= PUMP_DAILY_THRESHOLD_PCT or weekly_change >= PUMP_WEEKLY_THRESHOLD_PCT:
            events.append({"symbol": symbol, "index": i, "daily_change": round(daily_change, 1), "weekly_change": round(weekly_change, 1)})

    # Aynı pump'ı birden fazla gün art arda saymamak için: 5 günden yakın olayları birleştir
    deduped = []
    last_index = -99
    for e in events:
        if e["index"] - last_index > 5:
            deduped.append(e)
        last_index = e["index"]
    return deduped


def main():
    print("=" * 70)
    print("PUMP ÖRÜNTÜ ANALİZİ BAŞLIYOR (~6 aylık geçmiş veri)")
    print(f"Pump tanımı: günde >=%{PUMP_DAILY_THRESHOLD_PCT} veya 7 günde >=%{PUMP_WEEKLY_THRESHOLD_PCT}")
    print("=" * 70)

    symbols = fetch_try_symbols()
    if not symbols:
        print("Sembol listesi alınamadı, çıkılıyor.")
        return

    all_events = []
    pre_event_indicators = {lb: [] for lb in LOOKBACK_POINTS}

    for symbol in symbols:
        df = fetch_daily_klines(symbol, DAYS_OF_HISTORY)
        if df.empty or len(df) < MIN_HISTORY_BEFORE_EVENT + 10:
            continue

        events = find_pump_events(df, symbol)
        if not events:
            continue

        all_events.extend(events)
        for event in events:
            idx = event["index"]
            for lb in LOOKBACK_POINTS:
                pre_idx = idx - lb
                if pre_idx < MIN_HISTORY_BEFORE_EVENT:
                    continue
                ind = indicators_at_index(df, pre_idx)
                ind["symbol"] = symbol
                ind["event_daily_change"] = event["daily_change"]
                ind["event_weekly_change"] = event["weekly_change"]
                pre_event_indicators[lb].append(ind)

        print(f"{symbol}: {len(events)} pump olayı bulundu.")

    if not all_events:
        print("\nHiç pump olayı tespit edilmedi (eşikler çok yüksek olabilir).")
        return

    print("\n" + "=" * 70)
    print(f"TOPLAM {len(all_events)} PUMP OLAYI BULUNDU ({len(symbols)} coin arasında)")
    print("=" * 70)

    for lb in LOOKBACK_POINTS:
        rows = pre_event_indicators[lb]
        if not rows:
            continue
        df_ind = pd.DataFrame(rows)
        n = len(df_ind)

        print(f"\n--- PUMP'TAN {lb} GÜN ÖNCE (örneklem: {n} olay) ---")
        print(f"Ortalama RSI: {df_ind['rsi'].mean():.1f}  (medyan: {df_ind['rsi'].median():.1f})")
        print(f"RSI < 30 (aşırı satım) olan olay oranı: %{(df_ind['rsi'] < 30).mean() * 100:.1f}")
        print(f"RSI < 40 olan olay oranı: %{(df_ind['rsi'] < 40).mean() * 100:.1f}")
        print(f"RSI > 60 olan olay oranı: %{(df_ind['rsi'] > 60).mean() * 100:.1f}")
        print(f"Hacim ortalamanın 1.5 katından fazla olan oran: %{(df_ind['volume_ratio'] > 1.5).mean() * 100:.1f}")
        print(f"Hacim ortalamanın altında olan oran: %{(df_ind['volume_ratio'] < 1.0).mean() * 100:.1f}")
        print(f"Trend dağılımı:\n{df_ind['trend'].value_counts(normalize=True).mul(100).round(1).to_string()}")
        print(f"30 günlük zirveden ortalama uzaklık: %{df_ind['pct_from_30d_high'].mean():.1f}")
        print(f"Zirveye %10'dan yakın olan oran: %{(df_ind['pct_from_30d_high'] < 10).mean() * 100:.1f}")
        print(f"Zirveden %25'ten uzak olan oran: %{(df_ind['pct_from_30d_high'] > 25).mean() * 100:.1f}")

    print("\n" + "=" * 70)
    print("EN ÇOK PUMP YAPAN COINLER")
    print("=" * 70)
    df_events = pd.DataFrame(all_events)
    print(df_events.groupby("symbol").size().sort_values(ascending=False).head(15).to_string())

    print("\n" + "=" * 70)
    print("NOT: Bu bulgular korelasyoneldir, garanti değildir. Hayatta kalma")
    print("yanlılığı (şu an listede olmayan coinler dahil değil) ve küçük")
    print("örneklem etkisi olabilir. Puanlama ağırlıklarını buna göre GÜNCELLEMEDEN")
    print("önce birlikte değerlendirelim.")


if __name__ == "__main__":
    main()
