"""
==============================================================================
PUMP SİNYALİ DOĞRULAMA (Taban Oran Karşılaştırmalı)
==============================================================================
Önceki analiz (pump_pattern_analysis.py) sadece "pump'lardan ÖNCE göstergeler
nasıldı" diye baktı — ama "o gösterge zaten her zaman mı yaygındı" sorusuna
cevap vermiyordu. Bu script, HER günü (sadece pump öncesi günleri değil)
inceleyip, her gösterge durumu için:

  - O durumda gerçekten pump gelme oranı (koşullu olasılık)
  - TÜM günlerdeki genel pump gelme oranı (taban oran / baseline)
  - "Lift" = koşullu oran / taban oran (1'den büyükse gösterge gerçekten
    öngörücü demektir, 1'e yakınsa tesadüfi demektir)

hesaplar. Bu, "gerçek sinyal mi şans mı" sorusuna istatistiksel olarak
doğru cevap verir.

Çalıştırma: python pump_signal_validation.py
Gereksinimler: pip install requests pandas
==============================================================================
"""

import requests
import pandas as pd
import numpy as np
from typing import List

BINANCE_URLS = ["https://data-api.binance.vision", "https://api.binance.com"]
DAYS_OF_HISTORY = 200
PUMP_DAILY_THRESHOLD_PCT = 15.0
PUMP_WEEKLY_THRESHOLD_PCT = 40.0
FUTURE_WINDOW_DAYS = 7          # "Önümüzdeki 7 gün içinde pump olur mu?"
MIN_HISTORY_BEFORE = 35


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
    return []


def fetch_daily_klines(symbol: str, limit: int) -> pd.DataFrame:
    for base_url in BINANCE_URLS:
        try:
            resp = requests.get(
                f"{base_url}/api/v3/klines",
                params={"symbol": symbol, "interval": "1d", "limit": limit}, timeout=15,
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
    return pd.DataFrame()


def compute_rsi_series(closes: pd.Series, period: int = 14) -> pd.Series:
    delta = closes.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()
    rs = avg_gain / avg_loss.replace(0, 1e-9)
    return 100 - (100 / (1 + rs))


def bucket_rsi(rsi: float) -> str:
    if pd.isna(rsi):
        return "bilinmiyor"
    if rsi < 30:
        return "RSI<30"
    if rsi < 40:
        return "RSI 30-40"
    if rsi < 60:
        return "RSI 40-60"
    if rsi < 70:
        return "RSI 60-70"
    return "RSI>70"


def bucket_volume(ratio: float) -> str:
    if pd.isna(ratio):
        return "bilinmiyor"
    if ratio < 0.7:
        return "Hacim<0.7x"
    if ratio < 1.0:
        return "Hacim 0.7-1.0x"
    if ratio < 1.5:
        return "Hacim 1.0-1.5x"
    return "Hacim>1.5x"


def bucket_peak(pct: float) -> str:
    if pd.isna(pct):
        return "bilinmiyor"
    if pct < 3:
        return "Zirveye<%3"
    if pct < 10:
        return "Zirveye %3-10"
    if pct < 25:
        return "Zirveye %10-25"
    return "Zirveden>%25 uzak"


def analyze_symbol(symbol: str) -> pd.DataFrame:
    df = fetch_daily_klines(symbol, DAYS_OF_HISTORY)
    if df.empty or len(df) < MIN_HISTORY_BEFORE + FUTURE_WINDOW_DAYS + 10:
        return pd.DataFrame()

    closes = df["close"]
    volumes = df["volume"]
    highs = df["high"]

    rsi_series = compute_rsi_series(closes, 14)
    ema20_series = closes.ewm(span=20, adjust=False).mean()
    ema50_series = closes.ewm(span=50, adjust=False).mean()
    avg_vol_20 = volumes.rolling(window=20).mean().shift(1)  # bugünü hariç tut (ileri bakma yok)
    volume_ratio_series = volumes / avg_vol_20
    high_30d = highs.rolling(window=30).max()
    pct_from_high_series = ((high_30d - closes) / high_30d) * 100

    daily_change = closes.pct_change() * 100
    weekly_change = closes.pct_change(periods=7) * 100
    is_pump_day = (daily_change >= PUMP_DAILY_THRESHOLD_PCT) | (weekly_change >= PUMP_WEEKLY_THRESHOLD_PCT)

    trend = pd.Series("DÜŞÜŞ", index=df.index)
    trend[(closes > ema20_series) & (ema20_series > ema50_series)] = "GÜÇLÜ_YÜKSELİŞ"
    trend[(closes > ema20_series) & ~((ema20_series > ema50_series))] = "YÜKSELİŞ"
    trend[(closes < ema20_series) & (ema20_series < ema50_series)] = "GÜÇLÜ_DÜŞÜŞ"

    rows = []
    n = len(df)
    for i in range(MIN_HISTORY_BEFORE, n - FUTURE_WINDOW_DAYS):
        future_pump = bool(is_pump_day.iloc[i + 1: i + 1 + FUTURE_WINDOW_DAYS].any())
        rows.append({
            "symbol": symbol,
            "rsi_bucket": bucket_rsi(rsi_series.iloc[i]),
            "volume_bucket": bucket_volume(volume_ratio_series.iloc[i]),
            "peak_bucket": bucket_peak(pct_from_high_series.iloc[i]),
            "trend": trend.iloc[i],
            "future_pump": future_pump,
        })

    return pd.DataFrame(rows)


def print_lift_table(df: pd.DataFrame, column: str, base_rate: float):
    print(f"\n--- {column.upper()} bazında pump oranı (taban oran: %{base_rate*100:.2f}) ---")
    grouped = df.groupby(column)["future_pump"].agg(["mean", "count"])
    grouped["lift"] = grouped["mean"] / base_rate
    grouped = grouped.sort_values("lift", ascending=False)
    for idx, row in grouped.iterrows():
        print(f"  {idx:<20} pump oranı: %{row['mean']*100:5.2f}  |  gözlem: {int(row['count']):6d}  |  LIFT: {row['lift']:.2f}x")


def main():
    print("=" * 70)
    print("PUMP SİNYALİ DOĞRULAMA (Taban Oran Karşılaştırmalı)")
    print(f"'Pump' tanımı: sonraki {FUTURE_WINDOW_DAYS} gün içinde günde >=%{PUMP_DAILY_THRESHOLD_PCT}")
    print(f"veya 7 günde >=%{PUMP_WEEKLY_THRESHOLD_PCT} artış")
    print("=" * 70)

    symbols = fetch_try_symbols()
    if not symbols:
        print("Sembol listesi alınamadı, çıkılıyor.")
        return

    all_rows = []
    for symbol in symbols:
        df_sym = analyze_symbol(symbol)
        if not df_sym.empty:
            all_rows.append(df_sym)

    if not all_rows:
        print("Hiç veri üretilemedi.")
        return

    df_all = pd.concat(all_rows, ignore_index=True)
    base_rate = df_all["future_pump"].mean()

    print(f"\nToplam gün-gözlemi: {len(df_all)}  |  Genel (taban) pump oranı: %{base_rate*100:.2f}")
    print("(LIFT > 1.3x anlamlı bir sinyal olabilir, ~1.0x tesadüfi demektir, <0.8x ise tam tersi bir sinyal demektir)")

    print_lift_table(df_all, "trend", base_rate)
    print_lift_table(df_all, "rsi_bucket", base_rate)
    print_lift_table(df_all, "volume_bucket", base_rate)
    print_lift_table(df_all, "peak_bucket", base_rate)

    print("\n" + "=" * 70)
    print("YORUMLAMA REHBERİ")
    print("=" * 70)
    print("LIFT 1.0x  = Bu durumun pump ihtimaline hiç etkisi yok (tesadüfi)")
    print("LIFT 1.5x  = Bu durumdayken pump ihtimali %50 daha fazla")
    print("LIFT 0.5x  = Bu durumdayken pump ihtimali %50 daha AZ")
    print("Gözlem sayısı (count) düşükse (örn. <200) o satıra çok güvenme.")


if __name__ == "__main__":
    main()
