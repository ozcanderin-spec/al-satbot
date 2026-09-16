"""
==============================================================================
Binance TR AI Algo-Trading Bot - 7/24 Otonom Tarama & Sanal Alım Motoru (v3)
==============================================================================
GitHub Actions üzerinde periyodik çalıştırılmak üzere tasarlanmıştır.
Tek bir tarama+alım döngüsü çalıştırıp çıkar (scheduled cron ile tetiklenir).

v3 DEĞİŞİKLİKLERİ (bug fix turu):
1) monitor_and_close_positions artık stop-loss / trailing eşiklerini
   config (bot_config tablosu) üzerinden okuyor. Önceden fonksiyon bir
   config parametresi alıyordu ama HİÇ KULLANMIYORDU — stop-loss her zaman
   sabit %2 (STOP_LOSS_PERCENT_DEFAULT) ile çalışıyordu, dashboard'dan
   girilen değerler etkisizdi. Artık config'te yoksa sabitlere düşer.
2) fetch_live_price artık başarısızlıkları (hangi sembol, hangi URL, hangi
   hata) tek tek logluyor ve bir döngü sonunda kaç pozisyonun fiyatının
   alınamadığını özetliyor, böylece GitHub Actions logunda görünür oluyor
   ("sessiz atlama" sorunu ortadan kalktı). Ayrıca timeout süresi artırıldı
   ve iki uç noktanın ikisi de denenip en son hata saklanıyor.
3) monitor_and_close_positions'taki kullanılmayan price_lookup parametresi
   kaldırıldı (zaten fetch_live_price ile ayrı ayrı çekiliyordu).

Gereksinimler:
pip install requests pandas google-genai yfinance

Ortam Değişkenleri (GitHub Actions Secrets üzerinden sağlanır):
- SUPABASE_URL
- SUPABASE_KEY   (Service Role Key kullanılması önerilir)
- GEMINI_API_KEY

TASARIM NOTU (huni/funnel yaklaşımı):
Binance'te işlem gören TÜM TRY paritelerini (yükselenler + düşenler + en
hacimliler, ~250'ye kadar) ucuz/basit verilerle tararız, sonra bunların
içinden en umut vadeden ~40 tanesini gerçek teknik göstergelerle (RSI, EMA,
30 günlük trend) ve Gemini ile detaylı analiz ederiz. Tüm 250 sembol için
detaylı analiz yapmak, her 10 dakikalık döngüde çok fazla ağ isteği ve süre
gerektireceğinden pratik değildir.
==============================================================================
"""

import os
import json
import logging
import requests
import pandas as pd
import yfinance as yf
from google import genai
from google.genai import types as genai_types
from typing import List, Dict, Any, Set, Optional
from collections import Counter

# ------------------------------------------------------------------------------
# 1. YAPILANDIRMA & ORTAM DEĞİŞKENLERİ
# ------------------------------------------------------------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

WATCHLIST = [  # Yahoo Finance yedek yöntemi için (Binance tamamen erişilemezse)
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

# --- Strateji sabitleri (bot_config tablosunda karşılığı YOKSA bu varsayılanlar kullanılır) ---
STOP_LOSS_PERCENT_DEFAULT = 2.0        # Sabit stop-loss (kâr %3'e ulaşana kadar)
TRAILING_ACTIVATION_PCT_DEFAULT = 3.0  # Bu kâr yüzdesinden sonra iz süren stop devreye girer
TRAILING_DISTANCE_PCT_DEFAULT = 1.2    # Zirveden bu yüzde kadar geri çekilince iz süren stop
FEE_RATE = 0.001                        # Binance standart %0.1 komisyon
MAX_UNIVERSE_SIZE = 250                 # Ucuz taramada bakılacak azami parite sayısı
MAX_DETAILED_ANALYSIS = 40              # Gemini + gerçek gösterge ile detaylı analiz edilecek azami sayı
LOSS_COOLDOWN_HOURS = 3                 # Zararla kapanan bir coin bu süre boyunca tekrar alınmaz
MIN_TRADE_AMOUNT_TRY = 100.0            # Minimum işlem tutarı
PEAK_PROXIMITY_PENALTY_PCT = 3.0        # 30 günlük zirveye bu kadar yakınsa puan kırılır
MAX_24H_CHANGE_FOR_BUY_PCT = 12.0       # v7 FIX: 24 saatte bu yüzdeden fazla artmış coin
                                          # ALINMAZ — "yükselişin sonunda alım" sorununu
                                          # önlemek için (kullanıcı geri bildirimi).
MAX_HOURLY_VOLATILITY_PCT = 6.0         # v7 FIX: son 20 saatlik ortalama (high-low)/close
                                          # oranı bu değeri aşan coinler ALINMAZ — çok sert/
                                          # gappy hareket eden coinlerde stop-loss iki kontrol
                                          # arasında büyük farkla aşılıyordu (%2 yerine -4/-5%).

# Canlı fiyat çekimi için deneme ayarları
PRICE_FETCH_TIMEOUT_SECONDS = 12
PRICE_FETCH_RETRIES_PER_URL = 2

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("BinanceAlgoBot")

if not SUPABASE_URL or not SUPABASE_KEY:
    logger.warning("SUPABASE_URL/SUPABASE_KEY bulunamadı; Supabase bağlantısı kurulamazsa script varsayılan ayarlarla çalışmaya devam eder.")
if not GEMINI_API_KEY:
    logger.warning("GEMINI_API_KEY bulunamadı; Gemini API yerine yerel fallback skorlaması kullanılacak.")

# v4 FIX: google.generativeai paketi Google tarafından kullanımdan
# kaldırıldı (GitHub Actions loglarında FutureWarning görüldü — "All
# support for the google.generativeai package has ended"). Yeni birleşik
# google.genai SDK'sına geçildi; istemci ve model çağırma şekli değişti
# ama fonksiyonel davranış (JSON çıktı zorlaması) korunuyor.
MODEL_NAME = "gemini-flash-lite-latest"  # "flash-latest" günde sadece 20 ücretsiz istekle sınırlıydı; "lite" çok daha yüksek ücretsiz kota sunuyor
genai_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


def get_category(symbol: str) -> str:
    if symbol in STABLE_SYMBOLS:
        return "STABLE"
    if symbol in MAJOR_SYMBOLS:
        return "MAJOR"
    return "ALT"


# ------------------------------------------------------------------------------
# 2. SUPABASE REST API İSTEMCİSİ
# ------------------------------------------------------------------------------
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
            "active_mode": "VIRTUAL", "emergency_stop": False, "min_ai_score_to_buy": 75,
            "virtual_balance": 10000.0, "max_balance_usage_pct": 70.0, "reserve_cash_pct": 30.0,
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

        cutoff = pd.Timestamp.now('UTC') - pd.Timedelta(hours=cooldown_hours)
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
        url = f"{self.base_url}/rest/v1/trades"
        payload: Dict[str, Any] = {"highest_price_reached": highest_price_reached}
        if trailing_stop_price is not None:
            payload["trailing_stop_price"] = trailing_stop_price
        if not self.base_url or not self.headers.get("apikey"):
            return
        try:
            requests.patch(url, headers=self.headers, params={"id": f"eq.{trade_id}"}, json=payload, timeout=10)
        except Exception as e:
            logger.warning(f"Zirve fiyat güncellenemedi ({trade_id}): {e}")

    def close_trade(self, trade_id: str, exit_price: float, realized_pnl: float, reason: str) -> bool:
        url = f"{self.base_url}/rest/v1/trades"
        payload = {
            "is_active": False, "status": "FILLED", "exit_price": exit_price,
            "realized_pnl": realized_pnl, "notes": reason,
            "closed_at": pd.Timestamp.now('UTC').isoformat(),
        }
        if not self.base_url or not self.headers.get("apikey"):
            logger.warning(f"Supabase bağlantısı yok; {trade_id} kapanamadı.")
            return False
        try:
            resp = requests.patch(url, headers=self.headers, params={"id": f"eq.{trade_id}"}, json=payload, timeout=10)
            if resp.status_code in (200, 201, 204):
                logger.info(f"POZİSYON KAPANDI: {trade_id} - Sebep: {reason} - PnL: ₺{realized_pnl:.2f}")
                return True
            logger.error(f"trades kapama hatası ({resp.status_code}): {resp.text}")
            return False
        except Exception as e:
            logger.error(f"trades kapama isteği başarısız: {e}")
            return False

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


# ------------------------------------------------------------------------------
# 3. BİNANCE GERÇEK VERİ: TÜM TRY PARİTELERİ + HUNİ (FUNNEL) EVRENİ
# ------------------------------------------------------------------------------
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

    numeric_cols = ['lastPrice', 'priceChangePercent', 'volume', 'quoteVolume', 'highPrice', 'lowPrice']
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    df_try = df[df['symbol'].str.endswith('TRY')].copy() if 'symbol' in df.columns else pd.DataFrame()
    logger.info(f"Binance'ten toplam {len(df_try)} TRY paritesi çekildi.")
    return df_try


def fetch_live_price(symbol: str) -> Optional[float]:
    """Açık pozisyon için anlık fiyatı doğrudan Binance ticker'dan alır.

    v3: Her URL için birkaç deneme yapar, HER başarısızlığı (sembol + URL +
    hata mesajı + HTTP kodu varsa) ayrı ayrı loglar ki GitHub Actions
    logunda tam olarak hangi sembollerin neden atlandığı görülebilsin.
    Önceki sürümde bu hatalar sadece bir 'warning' olarak geçiyor ve
    pozisyon sessizce bu döngüde atlanıyordu.
    """
    last_error = None
    for url in BINANCE_TICKER_URLS:
        for attempt in range(1, PRICE_FETCH_RETRIES_PER_URL + 1):
            try:
                resp = requests.get(url, params={"symbol": symbol}, timeout=PRICE_FETCH_TIMEOUT_SECONDS)
                status = resp.status_code
                if status == 451:
                    logger.error(
                        f"{symbol}: {url} adresinden 451 (erişim engellendi) yanıtı alındı "
                        f"— muhtemelen runner IP'si Binance tarafından kısıtlanmış."
                    )
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
        usd_try_rate = float(yf.Ticker("USDTRY=X").history(period="1d")['Close'].iloc[-1])
    except Exception:
        usd_try_rate = 34.0

    rows = []
    for ticker_symbol in WATCHLIST:
        try:
            hist = yf.Ticker(ticker_symbol).history(period="2d")
            if hist.empty:
                continue
            last_close = float(hist['Close'].iloc[-1])
            prev_close = float(hist['Close'].iloc[-2]) if len(hist) >= 2 else last_close
            volume = float(hist['Volume'].iloc[-1]) if 'Volume' in hist else 0.0
            change_pct = ((last_close - prev_close) / prev_close * 100) if prev_close else 0.0
            base_symbol = ticker_symbol.replace("-USD", "")
            rows.append({
                "symbol": f"{base_symbol}TRY", "lastPrice": last_close * usd_try_rate,
                "priceChangePercent": change_pct, "volume": volume,
                "quoteVolume": volume * last_close * usd_try_rate,
                "highPrice": last_close * usd_try_rate * 1.01, "lowPrice": last_close * usd_try_rate * 0.99,
            })
        except Exception as e:
            logger.warning(f"{ticker_symbol} çekilemedi: {e}")
    return pd.DataFrame(rows)


MIN_QUOTE_VOLUME_TRY = 5000000  # v5 FIX: 500.000'den 5.000.000'a yükseltildi.


def is_recently_active(symbol: str) -> bool:
    df = fetch_klines(symbol, interval="1h", limit=3)
    if df.empty:
        return False
    recent_volume_sum = df["volume"].sum()
    return recent_volume_sum > 0


def build_scan_universe(df_all: pd.DataFrame) -> pd.DataFrame:
    liquid = df_all[df_all['quoteVolume'] > MIN_QUOTE_VOLUME_TRY].copy()
    if liquid.empty:
        liquid = df_all.copy()

    gainers = liquid.sort_values('priceChangePercent', ascending=False).head(100)
    losers = liquid.sort_values('priceChangePercent', ascending=True).head(75)
    by_volume = liquid.sort_values('quoteVolume', ascending=False).head(100)

    universe = pd.concat([gainers, losers, by_volume]).drop_duplicates(subset='symbol')
    universe = universe.head(MAX_UNIVERSE_SIZE).reset_index(drop=True)
    logger.info(f"Tarama evreni: {len(universe)} parite (yükselen+düşen+hacimli birleşimi).")
    return universe


def shortlist_for_detailed_analysis(universe: pd.DataFrame, excluded_symbols: Set[str]) -> pd.DataFrame:
    df = universe[~universe['symbol'].isin(excluded_symbols)].copy()
    df = df[df['symbol'].apply(lambda s: get_category(s) != "STABLE")]

    if df.empty:
        return df

    vol_norm = (df['quoteVolume'] / df['quoteVolume'].max()).fillna(0) if df['quoteVolume'].max() else 0
    positive_change = df['priceChangePercent'].clip(lower=0)
    change_norm = (positive_change / positive_change.max()).fillna(0) if positive_change.max() else 0
    df['quick_score'] = vol_norm * 0.5 + change_norm * 0.5

    shortlisted = df.sort_values('quick_score', ascending=False).head(MAX_DETAILED_ANALYSIS).reset_index(drop=True)
    logger.info(f"Detaylı analiz için kısa liste: {len(shortlisted)} parite.")
    return shortlisted


# ------------------------------------------------------------------------------
# 4. TEKNİK GÖSTERGELER (RSI / EMA / Hacim / 30 Günlük Trend) VE PİYASA REJİMİ
# ------------------------------------------------------------------------------
def fetch_klines(symbol: str, interval: str = "1h", limit: int = 60) -> pd.DataFrame:
    for base_url in ["https://data-api.binance.vision", "https://api.binance.com"]:
        try:
            resp = requests.get(
                f"{base_url}/api/v3/klines",
                params={"symbol": symbol, "interval": interval, "limit": limit}, timeout=10,
            )
            resp.raise_for_status()
            raw = resp.json()
            df = pd.DataFrame(raw, columns=[
                "open_time", "open", "high", "low", "close", "volume", "close_time",
                "quote_volume", "trades", "taker_base", "taker_quote", "ignore"
            ])
            df["close"] = pd.to_numeric(df["close"], errors="coerce")
            df["high"] = pd.to_numeric(df["high"], errors="coerce")
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
        "rsi": 50.0, "trend": "BİLİNMİYOR", "volume_ratio": 1.0,
        "pct_from_30d_high": 0.0, "avg_hourly_range_pct": 0.0,
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
        recent_ranges_pct = ((highs - lows) / closes.replace(0, pd.NA)).tail(20) * 100
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
    logger.info(f"Genel piyasa rejimi (BTC 4s trend): {regime}")
    return regime


# ------------------------------------------------------------------------------
# 5. POZİSYON İZLEME: STOP-LOSS / İZ SÜREN STOP (sabit take-profit YOK —
#    kâr %3'ü geçince iz süren stop devreye girip yükselişten sonuna kadar faydalanmaya çalışır)
# ------------------------------------------------------------------------------
def _resolve_config_pct(config: Dict[str, Any], candidate_keys: List[str], default: float) -> tuple:
    for key in candidate_keys:
        raw = config.get(key)
        if raw is not None:
            try:
                return float(raw), key
            except (TypeError, ValueError):
                continue
    return default, None


def fetch_high_since_entry(symbol: str, entry_time_iso: Optional[str]) -> Optional[float]:
    if not entry_time_iso:
        return None
    try:
        entry_dt = pd.Timestamp(entry_time_iso)
        if entry_dt.tzinfo is None:
            entry_dt = entry_dt.tz_localize("UTC")
        minutes_open = max(1, int((pd.Timestamp.now("UTC") - entry_dt).total_seconds() // 60))
        limit = min(1000, minutes_open // 5 + 3)
        df = fetch_klines(symbol, interval="5m", limit=limit)
        if df.empty:
            return None
        df["open_time"] = pd.to_numeric(df["open_time"], errors="coerce")
        entry_ms = int(entry_dt.timestamp() * 1000)
        df_after_entry = df[df["open_time"] >= entry_ms]
        if df_after_entry.empty:
            return None
        return float(df_after_entry["high"].max())
    except Exception as e:
        logger.warning(f"{symbol} giriş-sonrası gerçek zirve (kline) hesaplanamadı: {e}")
        return None


def monitor_and_close_positions(client: SupabaseRestClient, config: Dict[str, Any]):
    logger.info("--- Açık pozisyonlar izleniyor (stop-loss / iz süren stop) ---")

    stop_loss_percent, sl_source = _resolve_config_pct(
        config, ["stop_loss_percent", "stop_loss_pct"], STOP_LOSS_PERCENT_DEFAULT)
    trailing_activation_pct, ta_source = _resolve_config_pct(
        config, ["trailing_activation_pct", "trailing_activation_percent"], TRAILING_ACTIVATION_PCT_DEFAULT)
    trailing_distance_pct, td_source = _resolve_config_pct(
        config,
        ["trailing_distance_pct", "trailing_stop_pct", "trailing_stop_distance_pct"],
        TRAILING_DISTANCE_PCT_DEFAULT,
    )
    logger.info(
        f"Aktif eşikler — Stop-Loss: %{stop_loss_percent} (kaynak: {sl_source or 'VARSAYILAN'}) | "
        f"Trailing aktivasyon: %{trailing_activation_pct} (kaynak: {ta_source or 'VARSAYILAN'}) | "
        f"Trailing mesafe: %{trailing_distance_pct} (kaynak: {td_source or 'VARSAYILAN'})"
    )
    if td_source == "trailing_stop_pct":
        logger.warning(
            "bot_config.trailing_distance_pct bulunamadı, bunun yerine "
            "bot_config.trailing_stop_pct kullanıldı. Supabase'de her iki "
            "alan da mevcutsa hangisinin doğru/güncel olduğunu netleştirip "
            "diğerini silmeniz önerilir — aksi halde ikisi arasında hangi "
            "değerin geçerli olduğu her seferinde belirsiz kalır."
        )

    open_positions = client.get_open_positions()
    if not open_positions:
        logger.info("Açık pozisyon yok, izleme atlanıyor.")
        return

    price_fetch_failures = []

    for trade in open_positions:
        symbol = trade.get("symbol")
        live_price = fetch_live_price(symbol)
        if live_price is None or float(live_price) <= 0:
            price_fetch_failures.append(symbol)
            logger.error(
                f"{symbol} için doğrudan Binance güncel fiyatı alınamadı; yanlış fiyatla "
                f"stop-loss çalıştırmamak için bu döngüde güvenli şekilde atlanıyor."
            )
            continue
        live_price = float(live_price)

        entry_price = float(trade.get("entry_price") or 0)
        quantity = float(trade.get("quantity") or 0)
        total_amount = float(trade.get("total_amount") or 0)
        stored_highest = trade.get("highest_price_reached")
        previous_highest = float(stored_highest) if stored_highest is not None else entry_price
        if entry_price <= 0 or quantity <= 0 or total_amount <= 0:
            continue

        kline_high_since_entry = fetch_high_since_entry(symbol, trade.get("created_at"))
        live_highest = max(previous_highest, live_price, kline_high_since_entry or 0)
        gross_value = quantity * live_price
        live_value = gross_value * (1 - FEE_RATE)
        pnl = live_value - total_amount
        pnl_pct = (pnl / total_amount) * 100

        gross_peak_value = quantity * live_highest
        net_peak_value = gross_peak_value * (1 - FEE_RATE)
        peak_profit_pct = ((net_peak_value - total_amount) / total_amount) * 100
        is_trailing_active = peak_profit_pct >= trailing_activation_pct
        drawdown_pct = ((net_peak_value - live_value) / net_peak_value) * 100 if net_peak_value else 0

        should_close = (drawdown_pct >= trailing_distance_pct) if is_trailing_active else (pnl_pct <= -stop_loss_percent)

        if should_close:
            reason = "TRAILING_STOP" if is_trailing_active else "STOP_LOSS"
            client.close_trade(trade["id"], exit_price=live_price, realized_pnl=round(pnl, 2), reason=reason)
        else:
            if stored_highest is None or live_highest > previous_highest:
                trailing_stop_price = round(live_highest * (1 - trailing_distance_pct / 100), 8) if is_trailing_active else None
                client.update_trade_peak(trade["id"], live_highest, trailing_stop_price)
            logger.info(f"{symbol}: PnL %{pnl_pct:.2f} | Zirve kâr %{peak_profit_pct:.2f} | Trailing aktif: {is_trailing_active} — açık kalıyor.")

    if price_fetch_failures:
        logger.error(
            f"ÖZET: {len(price_fetch_failures)}/{len(open_positions)} açık pozisyonun canlı fiyatı "
            f"bu döngüde alınamadı ve stop-loss kontrolü YAPILAMADI: {price_fetch_failures}. "
            f"Bu tekrarlıyorsa muhtemelen GitHub Actions runner IP'si Binance tarafından "
            f"kısıtlanıyor (HTTP 451) — alternatif bir veri kaynağı/proxy gerekebilir."
        )

    logger.info("--- Pozisyon izleme tamamlandı ---")


# ------------------------------------------------------------------------------
# 6. POZİSYON BÜYÜKLÜĞÜ: BAKİYENİN YÜZDESİ (sabit tutar DEĞİL)
# ------------------------------------------------------------------------------
def get_available_cash(config: Dict[str, Any], open_positions: List[Dict[str, Any]]) -> float:
    virtual_balance = float(config.get("virtual_balance", 10000.0) or 10000.0)
    max_usage_pct = float(config.get("max_balance_usage_pct", 70.0) or 70.0)
    usable_capital = virtual_balance * (max_usage_pct / 100.0)
    already_invested = sum(float(p.get("total_amount") or 0) for p in open_positions)
    return max(0.0, usable_capital - already_invested)


def get_position_size_try(available_cash: float, ai_score: int) -> float:
    if ai_score >= 90:
        pct = 0.14
    elif ai_score >= 80:
        pct = 0.10
    elif ai_score >= 70:
        pct = 0.07
    else:
        pct = 0.05

    amount = available_cash * pct
    amount = max(MIN_TRADE_AMOUNT_TRY, amount)
    amount = min(amount, available_cash)
    return round(amount, 2)


# ------------------------------------------------------------------------------
# 7. PERFORMANS GÜNLÜĞÜ
# ------------------------------------------------------------------------------
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


def _fallback_score_market(shortlist: pd.DataFrame, indicators_by_symbol: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    results = []
    for _, row in shortlist.iterrows():
        symbol = row['symbol']
        indicators = indicators_by_symbol.get(symbol, {})
        rsi = float(indicators.get('rsi', 50.0))
        trend = str(indicators.get('trend', 'BİLİNMİYOR'))
        volume_ratio = float(indicators.get('volume_ratio', 1.0))
        pct_from_30d_high = float(indicators.get('pct_from_30d_high', 100.0))
        change_24h = float(row.get('priceChangePercent', 0.0))

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


# ------------------------------------------------------------------------------
# 8. GEMINI KARAR VE PUANLAMA MOTORU
# ------------------------------------------------------------------------------
def analyze_markets_with_gemini(shortlist: pd.DataFrame, market_regime: str):
    logger.info("Gemini Algo-Trading Karar Motoru çalıştırılıyor (teknik göstergelerle)...")

    market_summary = []
    indicators_by_symbol: Dict[str, Dict[str, Any]] = {}
    for _, row in shortlist.iterrows():
        symbol = row['symbol']
        indicators = compute_indicators(symbol)
        indicators_by_symbol[symbol] = indicators
        market_summary.append({
            "symbol": symbol,
            "last_price": round(float(row['lastPrice']), 6),
            "change_24h_percent": round(float(row['priceChangePercent']), 2),
            "volume_try": round(float(row['quoteVolume']), 0),
            "rsi_14": indicators["rsi"],
            "ema_trend": indicators["trend"],
            "volume_vs_avg_ratio": indicators["volume_ratio"],
            "pct_below_30d_high": indicators["pct_from_30d_high"],
        })

    if not genai_client or not GEMINI_API_KEY:
        logger.warning("Gemini client yok; yerel fallback puanlaması devreye alındı.")
        return _fallback_score_market(shortlist, indicators_by_symbol), indicators_by_symbol

    prompt = f"""
Sen kural tabanlı çalışan bir Kripto Para Teknik Analiz Motorusun. Kendi sezgine göre TAHMİN ETME;
sadece aşağıda verilen GERÇEK, HESAPLANMIŞ göstergeleri belirtilen kurallara göre birleştirerek puanla.

ÇOK ÖNEMLİ — PUANLARIN BİRBİRİNE YAPIŞMASINI (AYNI SAYIYA TIKANMASINI) ÖNLE:
Her parite farklı göstergelere sahip, bu yüzden puanları da farklı olmalı. Aşağıdaki
adımları SIRAYLA uygula, "en fazla X puan" gibi bir sert tavana yuvarlamak yerine
ORANTISAL küçültme kullan ki güçlü adaylar birbirinden ayrışabilsin:
1. Önce her parite için HAM puanı (taban 50 + aşağıdaki tüm etkiler toplamı) hesapla,
   bu 50-130 arası bir değer olabilir.
2. Piyasa rejimine göre şu ORANTISAL çarpanı uygula (taban 50'yi DEĞİL, 50'nin
   ÜZERİNDEKİ kısmı çarp): YÜKSELİŞ rejiminde çarpan 1.0, NÖTR rejiminde çarpan 0.65,
   DÜŞÜŞ rejiminde çarpan 0.35. Yani: nihai_puan = 50 + (ham_puan - 50) * çarpan.
   Bu şekilde ham puanı 100 olan bir parite NÖTR'de ~82, ham puanı 80 olan bir parite
   NÖTR'de ~70 olur — ikisi de farklı kalır, ikisi de aynı sert tavana YAPIŞMAZ.
3. Sonucu 0-100 aralığında sınırla ve en yakın tam sayıya yuvarla.

HER PARİTE İÇİN HAM PUANLAMA KURALLARI (taban puan 50'den başla).
NOT: Bu ağırlıklar, 364 coin / 6 aylık / 56.092 gün-gözlemlik gerçek geçmiş veri
üzerinde yapılan "taban oran karşılaştırmalı" (lift) analize dayanır — klasik
"aşırı satımda al, aşırı alımda sat" mantığı DEĞİL, gerçek istatistiksel bulgu
kullanılmıştır:
- rsi_14 > 70 (momentum devam ediyor, gerçek veride LIFT 2.28x — EN GÜÇLÜ sinyal): +18 puan
- rsi_14 60-70 arası (LIFT 1.14x, hafif pozitif): +5 puan
- rsi_14 30-40 arası (LIFT 0.74x, hafif negatif): -8 puan
- rsi_14 < 30 (gerçek veride öngörü değeri neredeyse yok, LIFT 0.94x): 0 puan (ne ödül ne ceza)
- ema_trend == "GÜÇLÜ_YÜKSELİŞ" (LIFT 1.48x): +20 | "YÜKSELİŞ" (LIFT ~1.0x, nötr): +3
- ema_trend == "GÜÇLÜ_DÜŞÜŞ" (LIFT 0.76x): -15 | "DÜŞÜŞ" (LIFT 0.94x, hafif negatif): -3
- volume_vs_avg_ratio > 1.5 (LIFT 1.74x — güçlü gerçek sinyal): +15 puan (2x'ten fazlaysa +22 puan ver, orantılı düşün)
- volume_vs_avg_ratio < 1.0 (LIFT ~0.83x, hafif negatif, iki taraf da benzer): -5 puan
- change_24h_percent > 15: -10 (aşırı ısınmış, kısa vadeli geri çekilme riski)
- pct_below_30d_high < 3 (30 günlük ZİRVEYE çok yakın): -15 puan
- pct_below_30d_high diğer durumlarda: puan etkisi yok

Puanı 0-100 aralığında sınırla. Sonra:
"signal_type": "STRONG_BUY" (>=80), "BUY" (>=65), "NEUTRAL" (40-64), "SELL" (<40).
"scan_reason": Türkçe, hangi göstergelerin puana nasıl katkı yaptığını özetleyen 1-2 cümle.

Piyasa Verileri:
{json.dumps(market_summary, indent=2)}

SADECE aşağıdaki JSON formatında geçerli bir liste döndür, başka hiçbir metin ekleme:
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
        logger.error(f"Gemini API ÇAĞRISI BAŞARISIZ: {e}")
        logger.warning("Gemini çağrısı başarısız olduğu için yerel fallback puanlama kullanılacak.")
        return _fallback_score_market(shortlist, indicators_by_symbol), indicators_by_symbol

    try:
        ai_results = json.loads(response.text)
        logger.info(f"Gemini {len(ai_results)} parite için analiz tamamladı.")
        return ai_results, indicators_by_symbol
    except Exception as e:
        logger.error(f"Gemini yanıtı ayrıştırılamadı (API çalıştı ama format bozuk): {e}")
        return _fallback_score_market(shortlist, indicators_by_symbol), indicators_by_symbol


# ------------------------------------------------------------------------------
# 9. BOT ÇALIŞTIRMA DÖNGÜSÜ
# ------------------------------------------------------------------------------
def run_scan_cycle(client: SupabaseRestClient):
    logger.info("=== YENİ TARAMA DÖNGÜSÜ BAŞLATILDI ===")

    config = client.get_bot_config()
    mode = config.get("active_mode", "VIRTUAL")
    emergency_stop = config.get("emergency_stop", False)
    min_ai_score = int(config.get("min_ai_score_to_buy", 75) or 75)

    logger.info(f"Mod: {mode} | Acil Durdurma: {emergency_stop} | Min Skor: {min_ai_score}")

    monitor_and_close_positions(client, config)

    if emergency_stop:
        logger.warning("ACİL DURDURMA aktif! Açık pozisyonlar izlendi; yeni alım yapılmayacak.")
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
        sym = row['symbol']
        ai_data = ai_dict.get(sym, {"ai_score": 50, "signal_type": "NEUTRAL", "scan_reason": "Analiz bekleniyor."})
        ai_score = max(0, min(100, int(ai_data.get("ai_score", 50))))
        signal_type = str(ai_data.get("signal_type", "NEUTRAL"))
        scan_reason = str(ai_data.get("scan_reason", "Teknik tarama tamamlandı."))
        symbol_indicators = indicators_by_symbol.get(sym, {})
        pct_from_30d_high = float(symbol_indicators.get("pct_from_30d_high", 100.0))
        change_24h_percent = float(row['priceChangePercent'])
        avg_hourly_range_pct = float(symbol_indicators.get("avg_hourly_range_pct", 0.0))

        records_to_upsert.append({"symbol": sym, "price": float(row['lastPrice']), "ai_score": ai_score,
                                   "signal_type": signal_type, "scan_reason": scan_reason,
                                   "pct_from_30d_high": pct_from_30d_high,
                                   "change_24h_percent": change_24h_percent,
                                   "avg_hourly_range_pct": avg_hourly_range_pct})
        market_scan_payload.append({
            "symbol": sym, "current_price": float(row['lastPrice']),
            "volume_24h": float(row['quoteVolume']), "price_change_24h_pct": float(row['priceChangePercent']),
            "ai_score": ai_score, "signal_type": signal_type, "scan_reason": scan_reason,
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
    logger.info(f"Kullanılabilir nakit: ₺{available_cash:.2f} (açık pozisyon sayısı: {len(open_positions)}, sınır yok)")

    if available_cash < MIN_TRADE_AMOUNT_TRY:
        logger.info("Kullanılabilir nakit minimum işlem tutarının altında, yeni alım yapılmayacak.")
        return

    MAX_PER_CATEGORY = {"MAJOR": 1, "ALT": 7, "STABLE": 0}

    held_category_counts = Counter(get_category(s) for s in held_symbols)

    candidates = [
        r for r in records_to_upsert
        if r["ai_score"] >= effective_min_score
        and r["symbol"] not in held_symbols
        and r["symbol"] not in losing_cooldown_symbols
        and get_category(r["symbol"]) != "STABLE"
        and r.get("pct_from_30d_high", 100.0) >= PEAK_PROXIMITY_PENALTY_PCT
        and r.get("change_24h_percent", 0.0) <= MAX_24H_CHANGE_FOR_BUY_PCT
        and r.get("avg_hourly_range_pct", 0.0) <= MAX_HOURLY_VOLATILITY_PCT
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

        amount_try = get_position_size_try(remaining_cash, candidate["ai_score"])
        buy_fee = amount_try * FEE_RATE
        net_investment = amount_try - buy_fee
        entry_price = candidate["price"]
        quantity = net_investment / entry_price if entry_price else 0
        position_pct = (amount_try / available_cash * 100) if available_cash else 0

        trade_record = {
            "symbol": candidate["symbol"], "side": "BUY", "status": "FILLED",
            "price": entry_price, "entry_price": entry_price, "quantity": quantity,
            "cost_try": amount_try, "total_amount": amount_try, "is_active": True,
            "scan_reason": candidate["scan_reason"], "mode": mode, "realized_pnl": 0,
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
