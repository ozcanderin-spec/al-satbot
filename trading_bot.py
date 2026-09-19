"""
================================================================================
Binance TR AI Algo-Trading Bot - 7/24 Otonom Tarama & Sanal Alım Motoru (v3.2)
================================================================================
GitHub Actions üzerinde periyodik çalıştırılmak üzere tasarlanmıştır.
Tek bir tarama+alım döngüsü çalıştırıp çıkar (scheduled cron ile tetiklenir).

ÖNEMLİ NOT:
- Bu dosya SADECE ALIM yapar.
- Pozisyon kapatma mantığı, bağımsız Supabase / SQL / pg_cron motoru
  run_virtual_sell_engine() tarafından yürütülür.
- Bu dosyada kendi close-position takibi yoktur; bu, iki sistem arasında
  çakışmayı önler.

v3.2 DEĞİŞİKLİKLERİ (strateji analizi sonrası):
1) get_market_regime() daha önce hesaplanıyordu ama sonucu Gemini'ye HİÇ
   iletilmiyordu — prompt sadece "rejime göre çarpan uygula" kuralını
   anlatıyor, ama Gemini'ye şu an hangi rejimde olduğumuzu söylemiyordu.
   Artık gerçek rejim değeri prompt'a açıkça ekleniyor.
2) Gerçek işlem verisi analizi, DÜŞÜŞ rejiminde kazanma oranının (%25)
   YÜKSELİŞ'e (%45.5) göre belirgin şekilde düşük olduğunu gösterdi.
   get_position_size_try artık market_regime parametresi alıyor ve
   DÜŞÜŞ rejiminde pozisyon yüzdelerini yarıya indiriyor (bot tamamen
   durmuyor ama kötü rejimde daha az sermaye riske atıyor).

Gereksinimler:
pip install requests pandas numpy yfinance google-genai

Ortam Değişkenleri:
- SUPABASE_URL
- SUPABASE_KEY   (Service Role Key)
- GEMINI_API_KEY
================================================================================
"""

import os
import json
import logging
from typing import List, Dict, Any, Set, Optional
from collections import Counter

import pandas as pd
import numpy as np
import requests
import yfinance as yf
from google import genai
from google.genai import types as genai_types

# ------------------------------------------------------------------------------
# 1. YAPILANDIRMA & ORTAM DEĞİŞKENLERİ
# ------------------------------------------------------------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

WATCHLIST = [
    "BTC-USD", "ETH-USD", "SOL-USD", "AVAX-USD", "BNB-USD",
    "XRP-USD", "ADA-USD", "DOGE-USD", "TRX-USD", "DOT-USD",
    "LINK-USD", "MATIC-USD", "LTC-USD", "SHIB-USD", "ATOM-USD"
]

MAJOR_SYMBOLS = {"BTCTRY", "ETHTRY", "BNBTRY", "SOLTRY", "XRPTRY", "ADATRY"}
STABLE_SYMBOLS = {"USDTTRY", "USDCTRY", "BUSDTRY", "DAITRY", "FDUSDTRY"}

BINANCE_TICKER_URLS = [
    "https://data-api.binance.vision/api/v3/ticker/24hr",
    "https://api.binance.com/api/v3/ticker/24hr",
]

# Bot config varsayılanları (Supabase üzerinde gerçek değerler varsa onlar kullanılır)
STOP_LOSS_PERCENT_DEFAULT = 1.5
TRAILING_ACTIVATION_PCT_DEFAULT = 2.25
TRAILING_DISTANCE_PCT_DEFAULT = 1.2
FEE_RATE = 0.001
MAX_UNIVERSE_SIZE = 250
MAX_DETAILED_ANALYSIS = 40
LOSS_COOLDOWN_HOURS = 3
MIN_TRADE_AMOUNT_TRY = 100.0
PEAK_PROXIMITY_PENALTY_PCT = 3.0
MAX_24H_CHANGE_FOR_BUY_PCT = 12.0
MAX_HOURLY_VOLATILITY_PCT = 6.0
DEFAULT_MIN_AI_SCORE_TO_BUY = 78

# Çeşitlendirme sınırı (talep edilen akış)
MAX_PER_CATEGORY = {"MAJOR": 3, "ALT": 10, "STABLE": 1}

# DÜŞÜŞ rejiminde pozisyon büyüklüğü çarpanı (v3.2) — gerçek işlem verisi
# DÜŞÜŞ rejiminde kazanma oranının belirgin şekilde düştüğünü gösterdi.
REGIME_POSITION_SIZE_MULTIPLIER = {
    "YÜKSELİŞ": 1.0,
    "NÖTR": 1.0,
    "DÜŞÜŞ": 0.5,
}

PRICE_FETCH_TIMEOUT_SECONDS = 12
PRICE_FETCH_RETRIES_PER_URL = 2

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger("BinanceAlgoBot")

if not SUPABASE_URL or not SUPABASE_KEY:
    logger.warning("SUPABASE_URL/SUPABASE_KEY bulunamadı; Supabase erişimi yok, script varsayılan ayarlarla çalışacak.")
if not GEMINI_API_KEY:
    logger.warning("GEMINI_API_KEY bulunamadı; yerel fallback skorlaması devreye alınacak.")

MODEL_NAME = "gemini-flash-lite-latest"
genai_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


def get_category(symbol: str) -> str:
    if symbol in STABLE_SYMBOLS:
        return "STABLE"
    if symbol in MAJOR_SYMBOLS:
        return "MAJOR"
    return "ALT"


class SupabaseRestClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "apikey": api_key,
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def get_bot_config(self) -> Dict[str, Any]:
        url = f"{self.base_url}/rest/v1/bot_config"
        default = {
            "active_mode": "VIRTUAL",
            "emergency_stop": False,
            "min_ai_score_to_buy": DEFAULT_MIN_AI_SCORE_TO_BUY,
            "virtual_balance": 10000.0,
            "max_balance_usage_pct": 70.0,
            "reserve_cash_pct": 30.0,
            "stop_loss_percent": STOP_LOSS_PERCENT_DEFAULT,
            "trailing_activation_pct": TRAILING_ACTIVATION_PCT_DEFAULT,
            "trailing_distance_pct": TRAILING_DISTANCE_PCT_DEFAULT,
        }
        if not self.base_url or not self.headers.get("apikey"):
            logger.warning("Supabase URL/key yok; varsayılan bot_config kullanılacak.")
            return default
        try:
            resp = requests.get(url, headers=self.headers, params={"select": "*", "limit": 1}, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            return data[0] if data else default
        except Exception as e:
            logger.warning(f"bot_config okunamadı, varsayılan ayarlar kullanılacak: {e}")
            return default

    def get_open_positions(self) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/rest/v1/trades"
        params = {
            "select": "id,symbol,entry_price,quantity,total_amount,highest_price_reached,created_at",
            "is_active": "eq.true",
        }
        if not self.base_url or not self.headers.get("apikey"):
            return []
        try:
            resp = requests.get(url, headers=self.headers, params=params, timeout=10)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning(f"Açık pozisyonlar okunamadı: {e}")
            return []

    def get_recent_losing_symbols(self, cooldown_hours: int) -> Set[str]:
        url = f"{self.base_url}/rest/v1/trades"
        params = {
            "select": "symbol,realized_pnl,closed_at",
            "is_active": "eq.false",
            "order": "closed_at.desc",
            "limit": "200",
        }
        if not self.base_url or not self.headers.get("apikey"):
            return set()
        try:
            resp = requests.get(url, headers=self.headers, params=params, timeout=10)
            resp.raise_for_status()
            rows = resp.json()
        except Exception as e:
            logger.warning(f"Soğuma süresi kontrolü için veri okunamadı: {e}")
            return set()

        cutoff = pd.Timestamp.now("UTC") - pd.Timedelta(hours=cooldown_hours)
        losing = set()
        for r in rows:
            try:
                pnl = float(r.get("realized_pnl") or 0)
                closed_at_raw = r.get("closed_at")
                if closed_at_raw is None:
                    continue
                closed_at = pd.Timestamp(closed_at_raw)
                if closed_at.tzinfo is None:
                    closed_at = closed_at.tz_localize("UTC")
                if pnl < 0 and closed_at >= cutoff:
                    losing.add(r["symbol"])
            except Exception:
                continue
        return losing

    def get_recent_closed_trades(self, limit: int = 50) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/rest/v1/trades"
        params = {
            "select": "symbol,realized_pnl,closed_at",
            "is_active": "eq.false",
            "order": "closed_at.desc",
            "limit": str(limit),
        }
        if not self.base_url or not self.headers.get("apikey"):
            return []
        try:
            resp = requests.get(url, headers=self.headers, params=params, timeout=10)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning(f"Kapanmış işlemler okunamadı: {e}")
            return []

    def update_trade_peak(self, trade_id: str, highest_price_reached: float, trailing_stop_price: Any = None) -> None:
        if not self.base_url or not self.headers.get("apikey"):
            return
        url = f"{self.base_url}/rest/v1/trades"
        payload: Dict[str, Any] = {"highest_price_reached": highest_price_reached}
        if trailing_stop_price is not None:
            payload["trailing_stop_price"] = trailing_stop_price
        try:
            requests.patch(url, headers=self.headers, params={"id": f"eq.{trade_id}"}, json=payload, timeout=10)
        except Exception as e:
            logger.warning(f"Zirve fiyat güncellenemedi ({trade_id}): {e}")

    def close_trade(self, trade_id: str, exit_price: float, realized_pnl: float, reason: str) -> bool:
        # Bu dosyada kapatma mantığı devre dışı bırakılmıştır.
        # Efektif kapanma, bağımsız run_virtual_sell_engine() tarafında yapılır.
        logger.info(f"close_trade() çağrıldı ama dosya mimarisi gereği devre dışı bırakıldı: {trade_id} / {reason}")
        return True

    def upsert_market_scans(self, records: List[Dict[str, Any]]) -> bool:
        if not records:
            return True
        url = f"{self.base_url}/rest/v1/market_scans"
        if not self.base_url or not self.headers.get("apikey"):
            logger.warning("Supabase bağlantısı yok; market_scans yazılamadı.")
            return False
        try:
            response = requests.post(url, headers=self.headers, json=records, timeout=20)
            if response.status_code in (200, 201):
                logger.info(f"Supabase'e {len(records)} adet piyasa tarama verisi yazıldı.")
                return True
            logger.error(f"market_scans yazma hatası ({response.status_code}): {response.text}")
            return False
        except Exception as e:
            logger.error(f"market_scans isteği başarısız: {e}")
            return False

    def insert_trade(self, record: Dict[str, Any], position_pct: float = 0) -> bool:
        url = f"{self.base_url}/rest/v1/trades"
        if not self.base_url or not self.headers.get("apikey"):
            logger.warning(f"Supabase bağlantısı yok; {record.get('symbol')} alımı yazılamadı.")
            return False
        try:
            response = requests.post(url, headers=self.headers, json=record, timeout=15)
            if response.status_code in (200, 201):
                logger.info(f"YENİ ALIM: {record['symbol']} - ₺{record['cost_try']:.2f} (%{position_pct:.1f})")
                return True
            logger.error(f"trades yazma hatası ({response.status_code}): {response.text}")
            return False
        except Exception as e:
            logger.error(f"trades isteği başarısız: {e}")
            return False


def fetch_all_try_data() -> pd.DataFrame:
    logger.info("Binance gerçek piyasa verisi çekiliyor...")
    raw_data = None
    last_error = None
    for url in BINANCE_TICKER_URLS:
        try:
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
            raw_data = resp.json()
            logger.info(f"Veri kaynağı: {url}")
            break
        except Exception as e:
            last_error = e
            logger.warning(f"{url} başarısız: {e}")
            continue

    if raw_data is None:
        logger.error(f"Hiçbir Binance kaynağına ulaşılamadı, Yahoo Finance'e geri dönülüyor: {last_error}")
        return fetch_try_pairs_yahoo_fallback()

    df = pd.DataFrame(raw_data)
    if df.empty:
        logger.warning("Binance ticker yanıtı boş döndü; boş dataframe döndürüldü.")
        return df

    if "symbol" in df.columns:
        df["symbol"] = df["symbol"].astype(str)

    numeric_cols = ["lastPrice", "priceChangePercent", "volume", "quoteVolume", "highPrice", "lowPrice"]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df_try = df[df["symbol"].str.endswith("TRY")].copy() if "symbol" in df.columns else pd.DataFrame()
    logger.info(f"Binance'ten toplam {len(df_try)} TRY paritesi çekildi.")
    return df_try


def fetch_live_price(symbol: str) -> Optional[float]:
    last_error = None
    for url in BINANCE_TICKER_URLS:
        for attempt in range(1, PRICE_FETCH_RETRIES_PER_URL + 1):
            try:
                resp = requests.get(url, params={"symbol": symbol}, timeout=PRICE_FETCH_TIMEOUT_SECONDS)
                status = resp.status_code
                if status == 451:
                    logger.error(f"{symbol}: {url} adresinden 451 (erişim engellendi) yanıtı alındı.")
                    last_error = f"HTTP 451 @ {url}"
                    break
                resp.raise_for_status()
                data = resp.json()
                price = float(data.get("lastPrice", 0))
                if price > 0:
                    return price
                last_error = f"geçersiz fiyat (0 veya eksik) @ {url}"
            except Exception as e:
                last_error = f"{e} @ {url} (deneme {attempt}/{PRICE_FETCH_RETRIES_PER_URL})"
                logger.warning(f"{symbol} anlık fiyatı alınamadı: {last_error}")
                continue

    logger.error(f"{symbol}: TÜM kaynaklardan canlı fiyat alınamadı. Son hata: {last_error}")
    return None


def fetch_try_pairs_yahoo_fallback() -> pd.DataFrame:
    logger.info("[YEDEK] Yahoo Finance üzerinden tahmini piyasa verisi çekiliyor...")
    try:
        usd_try_rate = float(yf.Ticker("USDTRY=X").history(period="1d")["Close"].iloc[-1])
    except Exception:
        usd_try_rate = 34.0

    rows = []
    for ticker_symbol in WATCHLIST:
        try:
            hist = yf.Ticker(ticker_symbol).history(period="2d")
            if hist.empty:
                continue
            last_close = float(hist["Close"].iloc[-1])
            prev_close = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else last_close
            volume = float(hist["Volume"].iloc[-1]) if "Volume" in hist else 0.0
            change_pct = ((last_close - prev_close) / prev_close * 100) if prev_close else 0.0
            base_symbol = ticker_symbol.replace("-USD", "")
            rows.append({
                "symbol": f"{base_symbol}TRY",
                "lastPrice": last_close * usd_try_rate,
                "priceChangePercent": change_pct,
                "volume": volume,
                "quoteVolume": volume * last_close * usd_try_rate,
                "highPrice": last_close * usd_try_rate * 1.01,
                "lowPrice": last_close * usd_try_rate * 0.99,
            })
        except Exception as e:
            logger.warning(f"{ticker_symbol} çekilemedi: {e}")
    return pd.DataFrame(rows)


def is_recently_active(symbol: str) -> bool:
    df = fetch_klines(symbol, interval="1h", limit=3)
    if df.empty:
        return False
    recent_volume_sum = df["volume"].sum()
    return recent_volume_sum > 0


def build_scan_universe(df_all: pd.DataFrame) -> pd.DataFrame:
    liquid = df_all[df_all["quoteVolume"] > 5_000_000].copy()
    if liquid.empty:
        liquid = df_all.copy()

    gainers = liquid.sort_values("priceChangePercent", ascending=False).head(100)
    losers = liquid.sort_values("priceChangePercent", ascending=True).head(75)
    by_volume = liquid.sort_values("quoteVolume", ascending=False).head(100)

    universe = pd.concat([gainers, losers, by_volume]).drop_duplicates(subset="symbol")
    universe = universe.head(MAX_UNIVERSE_SIZE).reset_index(drop=True)
    logger.info(f"Tarama evreni: {len(universe)} parite (yükselen+düşen+hacimli birleşimi).")
    return universe


def shortlist_for_detailed_analysis(universe: pd.DataFrame, excluded_symbols: Set[str]) -> pd.DataFrame:
    df = universe[~universe["symbol"].isin(excluded_symbols)].copy()
    df = df[df["symbol"].apply(lambda s: get_category(s) != "STABLE")]

    if df.empty:
        return df

    vol_norm = (df["quoteVolume"] / df["quoteVolume"].max()).fillna(0) if df["quoteVolume"].max() else 0
    positive_change = df["priceChangePercent"].clip(lower=0)
    change_norm = (positive_change / positive_change.max()).fillna(0) if positive_change.max() else 0
    df["quick_score"] = vol_norm * 0.5 + change_norm * 0.5

    shortlisted = df.sort_values("quick_score", ascending=False).head(MAX_DETAILED_ANALYSIS).reset_index(drop=True)
    logger.info(f"Detaylı analiz için kısa liste: {len(shortlisted)} parite.")
    return shortlisted


def fetch_klines(symbol: str, interval: str = "1h", limit: int = 60) -> pd.DataFrame:
    for base_url in ["https://data-api.binance.vision", "https://api.binance.com"]:
        try:
            resp = requests.get(
                f"{base_url}/api/v3/klines",
                params={"symbol": symbol, "interval": interval, "limit": limit},
                timeout=10,
            )
            resp.raise_for_status()
            raw = resp.json()
            df = pd.DataFrame(raw, columns=[
                "open_time", "open", "high", "low", "close", "volume", "close_time",
                "quote_volume", "trades", "taker_base", "taker_quote", "ignore"
            ])
            df["close"] = pd.to_numeric(df["close"], errors="coerce")
            df["high"] = pd.to_numeric(df["high"], errors="coerce")
            df["low"] = pd.to_numeric(df["low"], errors="coerce")
            df["volume"] = pd.to_numeric(df["volume"], errors="coerce")
            return df
        except Exception as e:
            logger.warning(f"{symbol} kline verisi çekilemedi ({base_url}): {e}")
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


def compute_indicators(symbol: str) -> Dict[str, Any]:
    df_1h = fetch_klines(symbol, interval="1h", limit=60)
    result = {
        "rsi": 50.0,
        "trend": "BİLİNMİYOR",
        "volume_ratio": 1.0,
        "pct_from_30d_high": 0.0,
        "avg_hourly_range_pct": 0.0,
    }

    if not df_1h.empty and len(df_1h) >= 21:
        closes = df_1h["close"]
        volumes = df_1h["volume"]
        highs = df_1h["high"]
        lows = df_1h["low"]
        result["rsi"] = compute_rsi(closes, 14)
        ema20 = closes.ewm(span=20, adjust=False).mean().iloc[-1]
        ema50 = closes.ewm(span=50, adjust=False).mean().iloc[-1] if len(closes) >= 50 else closes.mean()
        last_close = closes.iloc[-1]
        if last_close > ema20 > ema50:
            result["trend"] = "GÜÇLÜ_YÜKSELİŞ"
        elif last_close > ema20:
            result["trend"] = "YÜKSELİŞ"
        elif last_close < ema20 < ema50:
            result["trend"] = "GÜÇLÜ_DÜŞÜŞ"
        else:
            result["trend"] = "DÜŞÜŞ"
        recent_volume = volumes.iloc[-1]
        avg_volume = volumes.iloc[-21:-1].mean() if len(volumes) >= 21 else volumes.mean()
        result["volume_ratio"] = round(recent_volume / avg_volume, 2) if avg_volume else 1.0
        closes_safe = np.where(closes.to_numpy(dtype=float) == 0, np.nan, closes.to_numpy(dtype=float))
        ranges_raw = (highs.to_numpy(dtype=float) - lows.to_numpy(dtype=float)) / closes_safe
        recent_ranges_pct = pd.Series(ranges_raw).tail(20) * 100
        recent_ranges_pct = recent_ranges_pct.replace([np.inf, -np.inf], np.nan).dropna()
        result["avg_hourly_range_pct"] = round(float(recent_ranges_pct.mean()), 2) if not recent_ranges_pct.empty else 0.0

    df_1d = fetch_klines(symbol, interval="1d", limit=30)
    if not df_1d.empty:
        high_30d = df_1d["high"].max()
        last_close_1d = df_1d["close"].iloc[-1]
        if high_30d:
            result["pct_from_30d_high"] = round(((high_30d - last_close_1d) / high_30d) * 100, 2)

    return result


def get_market_regime() -> str:
    df = fetch_klines("BTCTRY", interval="4h", limit=60)
    if df.empty or len(df) < 50:
        logger.warning("Piyasa rejimi belirlenemedi (veri yetersiz), varsayılan NÖTR kabul ediliyor.")
        return "NÖTR"
    closes = df["close"]
    ema20 = closes.ewm(span=20, adjust=False).mean().iloc[-1]
    ema50 = closes.ewm(span=50, adjust=False).mean().iloc[-1]
    last_close = closes.iloc[-1]
    if last_close > ema20 > ema50:
        regime = "YÜKSELİŞ"
    elif last_close < ema20 < ema50:
        regime = "DÜŞÜŞ"
    else:
        regime = "NÖTR"
    logger.info(f"Genel piyasa rejimi (BTC 4h trend): {regime}")
    return regime


def _fallback_score_market(shortlist: pd.DataFrame, indicators_by_symbol: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    results = []
    for _, row in shortlist.iterrows():
        symbol = row["symbol"]
        indicators = indicators_by_symbol.get(symbol, {})
        rsi = float(indicators.get("rsi", 50.0))
        trend = str(indicators.get("trend", "BİLİNMİYOR"))
        volume_ratio = float(indicators.get("volume_ratio", 1.0))
        pct_from_30d_high = float(indicators.get("pct_from_30d_high", 100.0))
        change_24h = float(row.get("priceChangePercent", 0.0))

        score = 50
        if rsi > 70:
            score += 18
        elif 60 <= rsi <= 70:
            score += 5
        elif 30 <= rsi <= 40:
            score -= 8
        if trend == "GÜÇLÜ_YÜKSELİŞ":
            score += 20
        elif trend == "YÜKSELİŞ":
            score += 3
        elif trend == "GÜÇLÜ_DÜŞÜŞ":
            score -= 15
        elif trend == "DÜŞÜŞ":
            score -= 3
        if volume_ratio > 1.5:
            score += 15 if volume_ratio <= 2 else 22
        elif volume_ratio < 1.0:
            score -= 5
        if change_24h > 15:
            score -= 10
        if pct_from_30d_high < 3:
            score -= 15
        score = max(0, min(100, score))

        if score >= 80:
            signal_type = "STRONG_BUY"
        elif score >= 65:
            signal_type = "BUY"
        elif score >= 40:
            signal_type = "NEUTRAL"
        else:
            signal_type = "SELL"

        scan_reason = (
            f"RSI {rsi:.1f}, EMA/trend {trend} ve hacim oranı {volume_ratio:.2f} baz alınarak yerel fallback puanlama kullanıldı."
        )
        results.append({
            "symbol": symbol,
            "ai_score": int(score),
            "signal_type": signal_type,
            "scan_reason": scan_reason,
        })
    return results


def analyze_markets_with_gemini(shortlist: pd.DataFrame, market_regime: str):
    logger.info("Gemini Algo-Trading Karar Motoru çalıştırılıyor (teknik göstergelerle)...")

    market_summary = []
    indicators_by_symbol: Dict[str, Dict[str, Any]] = {}
    for _, row in shortlist.iterrows():
        symbol = row["symbol"]
        indicators = compute_indicators(symbol)
        indicators_by_symbol[symbol] = indicators
        market_summary.append({
            "symbol": symbol,
            "last_price": round(float(row["lastPrice"]), 6),
            "change_24h_percent": round(float(row["priceChangePercent"]), 2),
            "volume_try": round(float(row["quoteVolume"]), 0),
            "rsi_14": indicators["rsi"],
            "ema_trend": indicators["trend"],
            "volume_vs_avg_ratio": indicators["volume_ratio"],
            "pct_below_30d_high": indicators["pct_from_30d_high"],
            "avg_hourly_volatility_pct": indicators["avg_hourly_range_pct"],
        })

    if not genai_client or not GEMINI_API_KEY:
        logger.warning("Gemini client yok; yerel fallback puanlaması devreye alındı.")
        return _fallback_score_market(shortlist, indicators_by_symbol), indicators_by_symbol

    # v3.2 FIX: market_regime artık gerçekten prompt'a ekleniyor. Önceden bu
    # fonksiyon parametre olarak alıyordu ama hiçbir yerde kullanmıyordu —
    # Gemini'ye "rejime göre çarpan uygula" kuralı anlatılıyordu ama hangi
    # rejimde olduğumuz hiç söylenmiyordu, bu yüzden çarpan pratikte hiç
    # uygulanamıyordu.
    regime_multiplier = {"YÜKSELİŞ": "1.0", "NÖTR": "0.65", "DÜŞÜŞ": "0.35"}.get(market_regime, "0.65")

    prompt = f"""
Sen kural tabanlı çalışan bir Kripto Para Teknik Analiz Motorusun. Kendi sezgine göre TAHMİN ETME;
yalnızca aşağıda verilen GERÇEK, HESAPLANMIŞ göstergeleri belirtilen kurallara göre birleştirerek puanla.

ÇOK ÖNEMLİ — PUANLARIN BİRBİRİNE YAPIŞMASINI (AYNI SAYIYA TIKANMASINI) ÖNLE:
Her parite farklı göstergelere sahip, bu yüzden puanları da farklı olmalı.

ŞU ANKİ GENEL PİYASA REJİMİ (BTC 4 saatlik trend baz alınarak önceden hesaplandı): {market_regime}
Bu rejime karşılık gelen çarpan: {regime_multiplier}

1. Önce ham puanı hesapla (taban 50 + etkiler toplamı).
2. Piyasa rejimine göre yukarıda verilen ORANTILI ÇARPANI uygula:
   YÜKSELİŞ -> 1.0, NÖTR -> 0.65, DÜŞÜŞ -> 0.35.
   Formül: nihai_puan = 50 + (ham_puan - 50) * çarpan.
   ÖNEMLİ: Yukarıda "ŞU ANKİ GENEL PİYASA REJİMİ" olarak verilen değeri kullan, kendi tahminini yapma.
3. Sonucu 0-100 aralığında sınırla ve tam sayıya yuvarla.

HAM PUANLAMA KURALLARI:
- rsi_14 > 70 : +10
- rsi_14 60-70 arası : +5
- rsi_14 30-40 arası : -8
- rsi_14 < 30 : 0
- ema_trend == 'GÜÇLÜ_YÜKSELİŞ' : +20 | 'YÜKSELİŞ' : +3
- ema_trend == 'GÜÇLÜ_DÜŞÜŞ' : -15 | 'DÜŞÜŞ' : -3
- volume_vs_avg_ratio > 1.5 : +15 (2x ve üstü +22)
- volume_vs_avg_ratio < 1.0 : -5
- change_24h_percent 15-30 : -8
- change_24h_percent > 30 : -15
- avg_hourly_volatility_pct < 1.0 : -5
- avg_hourly_volatility_pct 1.0-4.0 : 0
- avg_hourly_volatility_pct 4.0-7.0 : -5
- avg_hourly_volatility_pct > 7.0 : -12
- pct_below_30d_high < 3 : -15

Puan 0-100 aralığında sınırla. Sonra:
"signal_type": "STRONG_BUY" (>=80), "BUY" (>=65), "NEUTRAL" (40-64), "SELL" (<40).
"scan_reason": Türkçe, 1-2 cümlelik ve hangi göstergelerin puana katkı yaptığını özetleyen açıklama.

Piyasa Verileri:
{json.dumps(market_summary, indent=2)}

SADECE aşağıdaki JSON formatında geçerli liste döndür, başka metin ekleme:
[
  {{"symbol": "BTCTRY", "ai_score": 85, "signal_type": "STRONG_BUY", "scan_reason": "..."}}
]
"""
    try:
        response = genai_client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=genai_types.GenerateContentConfig(response_mime_type="application/json"),
        )
    except Exception as e:
        logger.error(f"Gemini API çağrısı başarısız: {e}")
        logger.warning("Gemini çağrısı başarısız olduğu için yerel fallback puanlama kullanılacak.")
        return _fallback_score_market(shortlist, indicators_by_symbol), indicators_by_symbol

    try:
        ai_results = json.loads(response.text)
        logger.info(f"Gemini {len(ai_results)} parite için analiz tamamladı.")
        return ai_results, indicators_by_symbol
    except Exception as e:
        logger.error(f"Gemini yanıtı ayrıştırılamadı (API çalıştı ama format bozuk): {e}")
        return _fallback_score_market(shortlist, indicators_by_symbol), indicators_by_symbol


def get_available_cash(config: Dict[str, Any], open_positions: List[Dict[str, Any]]) -> float:
    virtual_balance = float(config.get("virtual_balance", 10000.0) or 10000.0)
    max_usage_pct = float(config.get("max_balance_usage_pct", 70.0) or 70.0)
    usable_capital = virtual_balance * (max_usage_pct / 100.0)
    already_invested = sum(float(p.get("total_amount") or 0) for p in open_positions)
    return max(0.0, usable_capital - already_invested)


def get_position_size_try(available_cash: float, ai_score: int, market_regime: str = "NÖTR") -> float:
    if ai_score >= 90:
        pct = 0.14
    elif ai_score >= 80:
        pct = 0.10
    elif ai_score >= 70:
        pct = 0.07
    else:
        pct = 0.05

    # v3.2 FIX: DÜŞÜŞ rejiminde pozisyon büyüklüğünü küçült — gerçek işlem
    # verisi DÜŞÜŞ rejiminde kazanma oranının belirgin şekilde düştüğünü
    # gösterdi (%25 vs YÜKSELİŞ'te %45.5). Bot tamamen durmuyor, sadece
    # kötü rejimde daha az sermaye riske atıyor.
    pct *= REGIME_POSITION_SIZE_MULTIPLIER.get(market_regime, 1.0)

    amount = available_cash * pct
    amount = max(MIN_TRADE_AMOUNT_TRY, amount)
    amount = min(amount, available_cash)
    return round(amount, 2)


def log_performance_summary(client: SupabaseRestClient):
    closed = client.get_recent_closed_trades(limit=50)
    pnls = [float(t["realized_pnl"]) for t in closed if t.get("realized_pnl") is not None]
    if not pnls:
        logger.info("--- Performans özeti: henüz kapanmış işlem yok ---")
        return
    wins = [p for p in pnls if p > 0]
    win_rate = (len(wins) / len(pnls)) * 100
    total_pnl = sum(pnls)
    logger.info(
        f"--- Performans özeti (son {len(pnls)} işlem): Kazanma oranı %{win_rate:.1f} | "
        f"Ortalama PnL ₺{total_pnl/len(pnls):.2f} | Toplam PnL ₺{total_pnl:.2f} ---"
    )


def run_scan_cycle(client: SupabaseRestClient):
    logger.info("=== YENİ TARAMA DÖNGÜSÜ BAŞLATILDI ===")

    config = client.get_bot_config()
    mode = config.get("active_mode", "VIRTUAL")
    emergency_stop = config.get("emergency_stop", False)
    min_ai_score = int(config.get("min_ai_score_to_buy", DEFAULT_MIN_AI_SCORE_TO_BUY) or DEFAULT_MIN_AI_SCORE_TO_BUY)
    logger.info(f"Mod: {mode} | Acil Durdurma: {emergency_stop} | Min Skor: {min_ai_score}")

    if emergency_stop:
        logger.warning("ACİL DURDURMA aktif! Yeni alım yapılmayacak.")
        return

    df_all = fetch_all_try_data()
    if df_all.empty:
        logger.error("Binance verisi boş geldi, yeni tarama/alım döngüsü atlanıyor.")
        return

    universe = build_scan_universe(df_all)
    open_positions = client.get_open_positions()
    held_symbols = {p["symbol"] for p in open_positions}
    losing_cooldown_symbols = client.get_recent_losing_symbols(LOSS_COOLDOWN_HOURS)
    logger.info(f"Soğuma süresinde olan (son {LOSS_COOLDOWN_HOURS}s zararlı) semboller: {losing_cooldown_symbols}")

    shortlist = shortlist_for_detailed_analysis(universe, excluded_symbols=set())
    if shortlist.empty:
        logger.error("Kısa liste boş çıktı, döngü sonlandırılıyor.")
        return

    market_regime = get_market_regime()
    ai_evaluations, indicators_by_symbol = analyze_markets_with_gemini(shortlist, market_regime)
    ai_dict = {item["symbol"]: item for item in ai_evaluations if "symbol" in item}
    effective_min_score = min_ai_score

    records_to_upsert = []
    market_scan_payload = []
    for _, row in shortlist.iterrows():
        sym = row["symbol"]
        ai_data = ai_dict.get(sym, {"ai_score": 50, "signal_type": "NEUTRAL", "scan_reason": "Analiz bekleniyor."})
        ai_score = max(0, min(100, int(ai_data.get("ai_score", 50))))
        signal_type = str(ai_data.get("signal_type", "NEUTRAL"))
        scan_reason = str(ai_data.get("scan_reason", "Teknik tarama tamamlandı."))
        symbol_indicators = indicators_by_symbol.get(sym, {})
        pct_from_30d_high = float(symbol_indicators.get("pct_from_30d_high", 100.0))
        change_24h_percent = float(row["priceChangePercent"])
        avg_hourly_range_pct = float(symbol_indicators.get("avg_hourly_range_pct", 0.0))

        records_to_upsert.append({
            "symbol": sym,
            "price": float(row["lastPrice"]),
            "ai_score": ai_score,
            "signal_type": signal_type,
            "scan_reason": scan_reason,
            "pct_from_30d_high": pct_from_30d_high,
            "change_24h_percent": change_24h_percent,
            "avg_hourly_range_pct": avg_hourly_range_pct,
        })
        market_scan_payload.append({
            "symbol": sym,
            "current_price": float(row["lastPrice"]),
            "volume_24h": float(row["quoteVolume"]),
            "price_change_24h_pct": float(row["priceChangePercent"]),
            "ai_score": ai_score,
            "signal_type": signal_type,
            "scan_reason": scan_reason,
        })

    scans_ok = client.upsert_market_scans(market_scan_payload)
    if not scans_ok:
        raise RuntimeError("market_scans tablosuna yazma başarısız oldu.")

    sorted_scores = sorted(records_to_upsert, key=lambda r: r["ai_score"], reverse=True)
    score_lines = "\n".join(f"  {r['symbol']}: {r['ai_score']} ({r['signal_type']})" for r in sorted_scores)
    logger.info(f"--- Bu döngüdeki tüm puanlar (yüksekten düşüğe) ---\n{score_lines}")

    log_performance_summary(client)

    if mode != "VIRTUAL":
        logger.info("Mod VIRTUAL değil, otomatik alım bu script tarafından yapılmıyor (güvenlik).")
        return

    available_cash = get_available_cash(config, open_positions)
    logger.info(f"Kullanılabilir nakit: ₺{available_cash:.2f} (açık pozisyon sayısı: {len(open_positions)})")

    if available_cash < MIN_TRADE_AMOUNT_TRY:
        logger.info("Kullanılabilir nakit minimum işlem tutarının altında, yeni alım yapılmayacak.")
        return

    held_category_counts = Counter(get_category(s) for s in held_symbols)

    # NOT: 30 günlük zirve yakınlığı / 24s değişim / saatlik volatilite artık
    # burada SERT ENGEL olarak uygulanmıyor — bu üç faktör zaten Gemini'nin
    # puanlamasına (analyze_markets_with_gemini prompt'u) kademeli ceza olarak
    # gömülü. Burada da tekrar sert filtre olarak uygulamak, yüksek puan alan
    # (89-93 gibi) güçlü momentum coinlerini puanlarına bakılmaksızın eleyip
    # botu neredeyse hiç alım yapamaz hale getiriyordu.
    candidates = [
        r for r in records_to_upsert
        if r["ai_score"] >= effective_min_score
        and r["symbol"] not in held_symbols
        and r["symbol"] not in losing_cooldown_symbols
        and get_category(r["symbol"]) != "STABLE"
        and held_category_counts[get_category(r["symbol"])] < MAX_PER_CATEGORY.get(get_category(r["symbol"]), 3)
    ]
    candidates.sort(key=lambda r: r["ai_score"], reverse=True)

    selected_category_counts = Counter(held_category_counts)
    final_candidates = []
    for c in candidates:
        cat = get_category(c["symbol"])
        limit = MAX_PER_CATEGORY.get(cat, 3)
        if selected_category_counts[cat] >= limit:
            continue
        selected_category_counts[cat] += 1
        final_candidates.append(c)

    remaining_cash = available_cash
    for candidate in final_candidates:
        if remaining_cash < MIN_TRADE_AMOUNT_TRY:
            break

        if not is_recently_active(candidate["symbol"]):
            logger.warning(
                f"{candidate['symbol']}: 24h hacim filtresini geçti ama son saatlerde "
                f"gerçek işlem hacmi yok (muhtemelen fiyat donmuş) — alım İPTAL edildi."
            )
            continue

        amount_try = get_position_size_try(remaining_cash, candidate["ai_score"], market_regime)
        buy_fee = amount_try * FEE_RATE
        net_investment = amount_try - buy_fee
        entry_price = candidate["price"]
        quantity = net_investment / entry_price if entry_price else 0
        position_pct = (amount_try / available_cash * 100) if available_cash else 0

        trade_record = {
            "symbol": candidate["symbol"],
            "side": "BUY",
            "status": "FILLED",
            "price": entry_price,
            "entry_price": entry_price,
            "quantity": quantity,
            "cost_try": amount_try,
            "total_amount": amount_try,
            "is_active": True,
            "scan_reason": candidate["scan_reason"],
            "mode": mode,
            "realized_pnl": 0,
        }
        if client.insert_trade(trade_record, position_pct=position_pct):
            remaining_cash -= amount_try

    logger.info("Döngü başarıyla tamamlandı.")


if __name__ == "__main__":
    logger.info("Binance TR AI Algo-Trading Bot - Tek Döngü Çalıştırması Başlıyor...")
    client = SupabaseRestClient(SUPABASE_URL, SUPABASE_KEY)
    try:
        run_scan_cycle(client)
    except Exception as e:
        logger.error(f"Beklenmeyen hata: {e}", exc_info=True)
        raise
