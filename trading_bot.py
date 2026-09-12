"""
==============================================================================
Binance TR AI Algo-Trading Bot - 7/24 Otonom Tarama & Sanal Alım Motoru
GitHub Actions üzerinde periyodik (örn. her 10 dakikada bir) çalıştırılmak
üzere tasarlanmıştır. Tek bir tarama döngüsü çalıştırıp çıkar.
==============================================================================
Gereksinimler:
pip install requests pandas google-generativeai yfinance

Ortam Değişkenleri (GitHub Actions Secrets üzerinden sağlanır):
- SUPABASE_URL
- SUPABASE_KEY   (Service Role Key kullanılması önerilir)
- GEMINI_API_KEY
"""

import os
import json
import logging
import requests
import pandas as pd
import yfinance as yf
import google.generativeai as genai
from typing import List, Dict, Any

# ------------------------------------------------------------------------------
# 1. YAPILANDIRMA & ORTAM DEĞİŞKENLERİ
# ------------------------------------------------------------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Not: Binance'in kendi API'si, GitHub Actions gibi bulut sunucu IP'lerini
# coğrafi kısıtlama (HTTP 451) ile engelliyor. Bu yüzden fiyat verisi
# Yahoo Finance üzerinden çekiliyor (engellenmiyor, anahtar gerekmiyor).
WATCHLIST = [
    "BTC-USD", "ETH-USD", "SOL-USD", "AVAX-USD", "BNB-USD",
    "XRP-USD", "ADA-USD", "DOGE-USD", "TRX-USD", "DOT-USD",
    "LINK-USD", "MATIC-USD", "LTC-USD", "SHIB-USD", "ATOM-USD"
]

# Çeşitlendirme (diversification) için kaba kategori etiketleri.
# Aynı anda aynı kategoriden birden fazla pozisyon açılmasını engellemek için kullanılır.
MAJOR_SYMBOLS = {"BTCTRY", "ETHTRY", "BNBTRY", "SOLTRY", "XRPTRY", "ADATRY"}
STABLE_SYMBOLS = {"USDTTRY", "USDCTRY", "BUSDTRY", "DAITRY", "FDUSDTRY"}


def get_category(symbol: str) -> str:
    if symbol in STABLE_SYMBOLS:
        return "STABLE"
    if symbol in MAJOR_SYMBOLS:
        return "MAJOR"
    return "ALT"

BINANCE_TICKER_24HR_URL = "https://api.binance.me/api/v3/ticker/24hr"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("BinanceAlgoBot")

if not SUPABASE_URL or not SUPABASE_KEY or not GEMINI_API_KEY:
    logger.error("Eksik ortam değişkeni! SUPABASE_URL, SUPABASE_KEY ve GEMINI_API_KEY gerekli.")
    raise SystemExit(1)

genai.configure(api_key=GEMINI_API_KEY)

MODEL_NAME = "gemini-1.5-flash"
try:
    model = genai.GenerativeModel(
        model_name=MODEL_NAME,
        generation_config={"response_mime_type": "application/json"}
    )
except Exception as e:
    logger.warning(f"{MODEL_NAME} başlatılamadı: {e}")
    model = genai.GenerativeModel(model_name="gemini-1.5-flash")


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
            "Prefer": "return=representation"
        }

    def get_bot_config(self) -> Dict[str, Any]:
        url = f"{self.base_url}/rest/v1/bot_config"
        params = {"select": "*", "limit": 1}
        try:
            resp = requests.get(url, headers=self.headers, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            if data and len(data) > 0:
                return data[0]
            return {"active_mode": "VIRTUAL", "emergency_stop": False, "max_open_positions": 3, "min_ai_score_to_buy": 75}
        except Exception as e:
            logger.error(f"bot_config okunamadı: {e}")
            return {"active_mode": "VIRTUAL", "emergency_stop": False, "max_open_positions": 3, "min_ai_score_to_buy": 75}

    def get_open_positions(self) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/rest/v1/trades"
        params = {
            "select": "id,symbol,entry_price,quantity,total_amount,highest_price_reached",
            "is_active": "eq.true"
        }
        try:
            resp = requests.get(url, headers=self.headers, params=params, timeout=10)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f"Açık pozisyonlar okunamadı: {e}")
            return []

    def update_trade_peak(self, trade_id: str, highest_price_reached: float, trailing_stop_price: Any = None) -> None:
        url = f"{self.base_url}/rest/v1/trades"
        payload: Dict[str, Any] = {"highest_price_reached": highest_price_reached}
        if trailing_stop_price is not None:
            payload["trailing_stop_price"] = trailing_stop_price
        try:
            requests.patch(url, headers=self.headers, params={"id": f"eq.{trade_id}"}, json=payload, timeout=10)
        except Exception as e:
            logger.warning(f"Zirve fiyat güncellenemedi ({trade_id}): {e}")

    def get_recent_closed_trades(self, limit: int = 50) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/rest/v1/trades"
        params = {
            "select": "symbol,realized_pnl,closed_at",
            "is_active": "eq.false",
            "order": "closed_at.desc",
            "limit": str(limit),
        }
        try:
            resp = requests.get(url, headers=self.headers, params=params, timeout=10)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning(f"Kapanmış işlemler okunamadı: {e}")
            return []

    def close_trade(self, trade_id: str, exit_price: float, realized_pnl: float, reason: str) -> bool:
        url = f"{self.base_url}/rest/v1/trades"
        payload = {
            "is_active": False,
            "status": "FILLED",
            "exit_price": exit_price,
            "realized_pnl": realized_pnl,
            "notes": reason,
            "closed_at": pd.Timestamp.utcnow().isoformat(),
        }
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
        url = f"{self.base_url}/rest/v1/market_scans"
        try:
            response = requests.post(url, headers=self.headers, json=records, timeout=15)
            if response.status_code in (200, 201):
                logger.info(f"Supabase'e {len(records)} adet piyasa tarama verisi yazıldı.")
                return True
            logger.error(f"market_scans yazma hatası ({response.status_code}): {response.text}")
            return False
        except Exception as e:
            logger.error(f"market_scans isteği başarısız: {e}")
            return False

    def insert_trade(self, record: Dict[str, Any]) -> bool:
        url = f"{self.base_url}/rest/v1/trades"
        try:
            response = requests.post(url, headers=self.headers, json=record, timeout=15)
            if response.status_code in (200, 201):
                logger.info(f"YENİ ALIM: {record['symbol']} - ₺{record['cost_try']}")
                return True
            logger.error(f"trades yazma hatası ({response.status_code}): {response.text}")
            return False
        except Exception as e:
            logger.error(f"trades isteği başarısız: {e}")
            return False


# ------------------------------------------------------------------------------
# 3. BİNANCE GERÇEK VERİ (data-api.binance.vision aynası): TOP 20 TRY PARİTESİ
# ------------------------------------------------------------------------------
BINANCE_TICKER_URLS = [
    "https://data-api.binance.vision/api/v3/ticker/24hr",  # Bulut IP'lerinde engellenmeyen resmi ayna
    "https://api.binance.com/api/v3/ticker/24hr",           # Web uygulamasının kullandığı ana adres (yedek)
]


def fetch_all_try_data() -> pd.DataFrame:
    """Binance'ten TÜM TRY paritelerini (hacim filtresi olmadan) çeker.
    Hem tarama (top 20) hem de açık pozisyon izleme (herhangi bir sembol) için kullanılır."""
    logger.info("Binance gerçek piyasa verisi çekiliyor...")

    raw_data = None
    last_error = None
    for url in BINANCE_TICKER_URLS:
        try:
            resp = requests.get(url, timeout=10)
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
        return fetch_top_20_try_pairs_yahoo_fallback()

    df = pd.DataFrame(raw_data)
    numeric_cols = ['lastPrice', 'priceChangePercent', 'volume', 'quoteVolume', 'highPrice', 'lowPrice']
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors='coerce')

    df_try = df[df['symbol'].str.endswith('TRY')].copy()
    logger.info(f"Binance'ten toplam {len(df_try)} TRY paritesi çekildi (web uygulamasıyla aynı kaynak).")
    return df_try


def fetch_top_20_try_pairs(df_all: pd.DataFrame) -> pd.DataFrame:
    df_liquid = df_all[df_all['quoteVolume'] > 100000]
    df_top20 = df_liquid.sort_values(by='quoteVolume', ascending=False).head(20).reset_index(drop=True)
    logger.info(f"En yüksek hacimli {len(df_top20)} parite tarama için seçildi.")
    return df_top20


def fetch_top_20_try_pairs_yahoo_fallback() -> pd.DataFrame:
    """Binance'e hiçbir yoldan ulaşılamazsa devreye giren yedek yöntem (tahmini fiyat)."""
    logger.info("[YEDEK] Yahoo Finance üzerinden tahmini piyasa verisi çekiliyor...")

    try:
        usdtry_hist = yf.Ticker("USDTRY=X").history(period="1d")
        usd_try_rate = float(usdtry_hist['Close'].iloc[-1])
    except Exception as e:
        logger.warning(f"USD/TRY kuru çekilemedi, varsayılan 34.0 kullanılıyor: {e}")
        usd_try_rate = 34.0

    rows = []
    for ticker_symbol in WATCHLIST:
        try:
            tk = yf.Ticker(ticker_symbol)
            hist = tk.history(period="2d")
            if hist.empty or len(hist) < 1:
                continue

            last_close_usd = float(hist['Close'].iloc[-1])
            prev_close_usd = float(hist['Close'].iloc[-2]) if len(hist) >= 2 else last_close_usd
            high_usd = float(hist['High'].iloc[-1])
            low_usd = float(hist['Low'].iloc[-1])
            volume = float(hist['Volume'].iloc[-1]) if 'Volume' in hist else 0.0

            change_pct = ((last_close_usd - prev_close_usd) / prev_close_usd * 100) if prev_close_usd else 0.0
            base_symbol = ticker_symbol.replace("-USD", "")

            rows.append({
                "symbol": f"{base_symbol}TRY",
                "lastPrice": last_close_usd * usd_try_rate,
                "priceChangePercent": change_pct,
                "volume": volume,
                "quoteVolume": volume * last_close_usd * usd_try_rate,
                "highPrice": high_usd * usd_try_rate,
                "lowPrice": low_usd * usd_try_rate,
            })
        except Exception as e:
            logger.warning(f"{ticker_symbol} için veri çekilemedi: {e}")
            continue

    df = pd.DataFrame(rows)
    if df.empty:
        return df

    df_top20 = df.sort_values(by='quoteVolume', ascending=False).head(20).reset_index(drop=True)
    logger.info(f"Yahoo Finance'ten {len(df_top20)} parite için veri çekildi (USD/TRY: {usd_try_rate:.2f}).")
    return df_top20


# ------------------------------------------------------------------------------
# 5. TEKNİK GÖSTERGELER (RSI / EMA / Hacim Trendi) VE PİYASA REJİMİ
# ------------------------------------------------------------------------------
def fetch_klines(symbol: str, interval: str = "1h", limit: int = 60) -> pd.DataFrame:
    """Belirli bir sembol için mum (kline) verisi çeker. Kapanış fiyatı ve hacim döner."""
    for base_url in ["https://data-api.binance.vision", "https://api.binance.com"]:
        try:
            url = f"{base_url}/api/v3/klines"
            resp = requests.get(url, params={"symbol": symbol, "interval": interval, "limit": limit}, timeout=10)
            resp.raise_for_status()
            raw = resp.json()
            df = pd.DataFrame(raw, columns=[
                "open_time", "open", "high", "low", "close", "volume",
                "close_time", "quote_volume", "trades", "taker_base", "taker_quote", "ignore"
            ])
            df["close"] = pd.to_numeric(df["close"], errors="coerce")
            df["volume"] = pd.to_numeric(df["volume"], errors="coerce")
            return df
        except Exception as e:
            logger.warning(f"{symbol} için kline verisi çekilemedi ({base_url}): {e}")
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
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def compute_indicators(symbol: str) -> Dict[str, Any]:
    """Bir sembol için RSI(14), EMA20/EMA50 trendi ve hacim oranını hesaplar."""
    df = fetch_klines(symbol, interval="1h", limit=60)
    if df.empty or len(df) < 21:
        return {"rsi": 50.0, "trend": "BİLİNMİYOR", "volume_ratio": 1.0}

    closes = df["close"]
    volumes = df["volume"]

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

    recent_volume = volumes.iloc[-1]
    avg_volume = volumes.iloc[-21:-1].mean() if len(volumes) >= 21 else volumes.mean()
    volume_ratio = round(recent_volume / avg_volume, 2) if avg_volume else 1.0

    return {"rsi": rsi, "trend": trend, "volume_ratio": volume_ratio}


def get_market_regime() -> str:
    """BTC'nin 4 saatlik trendine bakarak genel piyasa rejimini belirler.
    Düşüş rejiminde yeni alımlar durdurulur veya eşik yükseltilir."""
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
# 5. POZİSYON İZLEME: STOP-LOSS / TAKE-PROFIT / İZ SÜREN STOP
# ------------------------------------------------------------------------------
# Not: Bu eşikler web uygulamasındaki (useTradingEngine.ts) mantıkla birebir
# aynı tutulmuştur, böylece tarayıcı kapalıyken de aynı kararlar alınır.
STOP_LOSS_PERCENT_DEFAULT = 1.2
TAKE_PROFIT_PERCENT_DEFAULT = 5.0
TRAILING_ACTIVATION_PCT = 2.8   # Bu net kâr yüzdesine ulaşınca iz süren stop devreye girer
FEE_RATE = 0.001                 # Binance standart %0.1 komisyon


def monitor_and_close_positions(client: SupabaseRestClient, price_lookup: Dict[str, float], config: Dict[str, Any]):
    logger.info("--- Açık pozisyonlar izleniyor (stop-loss / take-profit / iz süren stop) ---")

    stop_loss_percent = float(config.get("stop_loss_percent", STOP_LOSS_PERCENT_DEFAULT) or STOP_LOSS_PERCENT_DEFAULT)
    take_profit_percent = float(config.get("take_profit_percent", TAKE_PROFIT_PERCENT_DEFAULT) or TAKE_PROFIT_PERCENT_DEFAULT)

    open_positions = client.get_open_positions()
    if not open_positions:
        logger.info("Açık pozisyon yok, izleme atlanıyor.")
        return

    for trade in open_positions:
        symbol = trade.get("symbol")
        live_price = price_lookup.get(symbol)
        if live_price is None:
            logger.warning(f"{symbol} için güncel fiyat bulunamadı, bu pozisyon bu döngüde atlanıyor.")
            continue

        entry_price = float(trade.get("entry_price") or 0)
        quantity = float(trade.get("quantity") or 0)
        total_amount = float(trade.get("total_amount") or 0)
        previous_highest = float(trade.get("highest_price_reached") or entry_price)

        if entry_price <= 0 or quantity <= 0 or total_amount <= 0:
            logger.warning(f"{symbol} için geçersiz işlem verisi, atlanıyor.")
            continue

        live_highest = max(previous_highest, live_price)

        # Anlık net değer (satış komisyonu düşülmüş):
        gross_value = quantity * live_price
        sell_fee = gross_value * FEE_RATE
        live_value = gross_value - sell_fee
        pnl = live_value - total_amount
        pnl_pct = (pnl / total_amount) * 100

        # Zirve net değer ve zirve kâr yüzdesi:
        gross_peak_value = quantity * live_highest
        peak_sell_fee = gross_peak_value * FEE_RATE
        net_peak_value = gross_peak_value - peak_sell_fee
        peak_profit_pct = ((net_peak_value - total_amount) / total_amount) * 100

        is_trailing_active = peak_profit_pct >= TRAILING_ACTIVATION_PCT
        drawdown_pct = ((net_peak_value - live_value) / net_peak_value) * 100 if net_peak_value else 0

        should_trigger_sl = (
            (drawdown_pct >= stop_loss_percent) if is_trailing_active
            else (pnl_pct <= -stop_loss_percent)
        )
        should_trigger_tp = (not should_trigger_sl) and (pnl_pct >= take_profit_percent)

        if should_trigger_sl or should_trigger_tp:
            reason = "STOP_LOSS" if should_trigger_sl else "TAKE_PROFIT"
            client.close_trade(trade["id"], exit_price=live_price, realized_pnl=round(pnl, 2), reason=reason)
        else:
            # Kapanmadıysa, zirve fiyat yükseldiyse kalıcı olarak güncelle
            if live_highest > previous_highest:
                trailing_stop_price = (
                    round(live_highest * (1 - stop_loss_percent / 100), 8) if is_trailing_active else None
                )
                client.update_trade_peak(trade["id"], live_highest, trailing_stop_price)
            logger.info(f"{symbol}: PnL %{pnl_pct:.2f} | Zirve kâr %{peak_profit_pct:.2f} | Trailing aktif: {is_trailing_active} — açık kalıyor.")

    logger.info("--- Pozisyon izleme tamamlandı ---")


# ------------------------------------------------------------------------------
# 7. PERFORMANS GÜNLÜĞÜ (basit istatistik özeti, her döngüde loglanır)
# ------------------------------------------------------------------------------
def log_performance_summary(client: SupabaseRestClient):
    closed = client.get_recent_closed_trades(limit=50)
    if not closed:
        logger.info("--- Performans özeti: henüz kapanmış işlem yok ---")
        return

    pnls = [float(t["realized_pnl"]) for t in closed if t.get("realized_pnl") is not None]
    if not pnls:
        return

    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]
    win_rate = (len(wins) / len(pnls)) * 100 if pnls else 0
    avg_pnl = sum(pnls) / len(pnls)
    total_pnl = sum(pnls)

    logger.info(
        f"--- Performans özeti (son {len(pnls)} kapanmış işlem): "
        f"Kazanma oranı %{win_rate:.1f} | Ortalama PnL ₺{avg_pnl:.2f} | Toplam PnL ₺{total_pnl:.2f} ---"
    )


# ------------------------------------------------------------------------------
# 8. GEMINI KARAR VE PUANLAMA MOTORU
# ------------------------------------------------------------------------------
def analyze_markets_with_gemini(df: pd.DataFrame, market_regime: str) -> List[Dict[str, Any]]:
    logger.info("Gemini Algo-Trading Karar Motoru çalıştırılıyor (teknik göstergelerle)...")

    market_summary = []
    for _, row in df.iterrows():
        symbol = row['symbol']
        indicators = compute_indicators(symbol)
        market_summary.append({
            "symbol": symbol,
            "last_price": round(float(row['lastPrice']), 4),
            "change_24h_percent": round(float(row['priceChangePercent']), 2),
            "volume_try": round(float(row['quoteVolume']), 0),
            "rsi_14": indicators["rsi"],
            "ema_trend": indicators["trend"],
            "volume_vs_avg_ratio": indicators["volume_ratio"],
        })

    prompt = f"""
Sen kural tabanlı çalışan bir Kripto Para Teknik Analiz Motorusun. Kendi sezgine göre TAHMİN ETME;
sadece aşağıda verilen GERÇEK, HESAPLANMIŞ göstergeleri belirtilen kurallara göre birleştirerek puanla.

GENEL PİYASA REJİMİ (BTC 4 saatlik trend): {market_regime}
- Rejim DÜŞÜŞ ise: hiçbir pariteye 70'in üzerinde puan verme (genel piyasa riskli).
- Rejim NÖTR ise: en fazla 85 puan ver.
- Rejim YÜKSELİŞ ise: normal puanlama kurallarını uygula.

HER PARİTE İÇİN PUANLAMA KURALLARI (0-100 arası taban puan 50'den başla):
- rsi_14 < 30 (aşırı satım, toparlanma ihtimali): +15 puan
- rsi_14 > 70 (aşırı alım, risk): -15 puan
- ema_trend == "GÜÇLÜ_YÜKSELİŞ": +20 puan
- ema_trend == "YÜKSELİŞ": +10 puan
- ema_trend == "GÜÇLÜ_DÜŞÜŞ": -20 puan
- ema_trend == "DÜŞÜŞ": -10 puan
- volume_vs_avg_ratio > 1.5 (ortalamanın üstünde ilgi): +10 puan
- volume_vs_avg_ratio < 0.7 (zayıf ilgi): -10 puan
- change_24h_percent > 15 (aşırı ısınmış, geri çekilme riski): -10 puan

Puanı 0-100 aralığında sınırla. Sonra:
"signal_type": "STRONG_BUY" (skor >= 80), "BUY" (skor >= 65), "NEUTRAL" (skor 40-64), "SELL" (skor < 40).
"scan_reason": Türkçe, hangi göstergelerin puana nasıl katkı yaptığını özetleyen 1-2 cümle.

Piyasa Verileri (gerçek hesaplanmış göstergelerle):
{json.dumps(market_summary, indent=2)}

SADECE aşağıdaki JSON formatında geçerli bir liste döndür, başka hiçbir metin ekleme:
[
  {{"symbol": "BTCTRY", "ai_score": 85, "signal_type": "STRONG_BUY", "scan_reason": "..."}}
]
"""
    try:
        response = model.generate_content(prompt)
        ai_results = json.loads(response.text)
        logger.info(f"Gemini {len(ai_results)} parite için analiz tamamladı.")
        return ai_results
    except Exception as e:
        logger.error(f"Gemini analiz/parse hatası: {e}")
        return []


# ------------------------------------------------------------------------------
# 5. BOT ÇALIŞTIRMA DÖNGÜSÜ (TEK ÇALIŞTIRMA - GitHub Actions cron tetikler)
# ------------------------------------------------------------------------------
def run_scan_cycle(client: SupabaseRestClient):
    logger.info("=== YENİ TARAMA DÖNGÜSÜ BAŞLATILDI ===")

    config = client.get_bot_config()
    mode = config.get("active_mode", "VIRTUAL")
    emergency_stop = config.get("emergency_stop", False)
    max_positions = int(config.get("max_open_positions", 3) or 3)
    min_ai_score = int(config.get("min_ai_score_to_buy", 75) or 75)

    logger.info(f"Mod: {mode} | Acil Durdurma: {emergency_stop} | Min Skor: {min_ai_score} | Maks Pozisyon: {max_positions}")

    if emergency_stop:
        logger.warning("ACİL DURDURMA aktif! Yeni alım yapılmayacak.")
        return

    df_all = fetch_all_try_data()
    if df_all.empty:
        logger.error("Binance verisi boş geldi, döngü atlanıyor.")
        return

    price_lookup = dict(zip(df_all['symbol'], df_all['lastPrice']))

    # Önce açık pozisyonları güncel fiyatlarla kontrol et ve gerekiyorsa kapat
    # (tarayıcı kapalı olsa bile stop-loss/take-profit/iz süren stop çalışsın diye)
    monitor_and_close_positions(client, price_lookup, config)

    df_top20 = fetch_top_20_try_pairs(df_all)
    if df_top20.empty:
        logger.error("Binance verisi boş geldi, döngü atlanıyor.")
        return

    market_regime = get_market_regime()
    ai_evaluations = analyze_markets_with_gemini(df_top20, market_regime)
    ai_dict = {item["symbol"]: item for item in ai_evaluations if "symbol" in item}

    # Düşüş rejiminde ek güvenlik katmanı: prompt'taki kural yetmezse diye eşiği yükselt.
    effective_min_score = min_ai_score + 10 if market_regime == "DÜŞÜŞ" else min_ai_score

    records_to_upsert = []      # İç mantık için (alım kararı vb.)
    market_scan_payload = []    # Supabase 'market_scans' tablosunun gerçek sütun adlarıyla
    for _, row in df_top20.iterrows():
        sym = row['symbol']
        ai_data = ai_dict.get(sym, {"ai_score": 50, "signal_type": "NEUTRAL", "scan_reason": "Analiz bekleniyor."})
        ai_score = int(ai_data.get("ai_score", 50))
        signal_type = str(ai_data.get("signal_type", "NEUTRAL"))
        scan_reason = str(ai_data.get("scan_reason", "Teknik tarama tamamlandı."))

        record = {
            "symbol": sym,
            "price": float(row['lastPrice']),
            "ai_score": ai_score,
            "signal_type": signal_type,
            "scan_reason": scan_reason,
        }
        records_to_upsert.append(record)

        market_scan_payload.append({
            "symbol": sym,
            "current_price": float(row['lastPrice']),
            "volume_24h": float(row['quoteVolume']),
            "price_change_24h_pct": float(row['priceChangePercent']),
            "ai_score": ai_score,
            "signal_type": signal_type,
            "scan_reason": scan_reason,
        })

    scans_ok = client.upsert_market_scans(market_scan_payload)
    if not scans_ok:
        raise RuntimeError("market_scans tablosuna yazma başarısız oldu (yukarıdaki hata mesajına bakın).")

    log_performance_summary(client)

    # --- Otonom Sanal Alım Mantığı ---
    if mode != "VIRTUAL":
        logger.info("Mod VIRTUAL değil, otomatik alım bu script tarafından yapılmıyor (güvenlik).")
        return

    open_positions = client.get_open_positions()
    held_symbols = {p["symbol"] for p in open_positions}
    held_categories = {get_category(s) for s in held_symbols}
    logger.info(f"Açık pozisyon sayısı: {len(open_positions)}/{max_positions}, semboller: {held_symbols}, kategoriler: {held_categories}")

    if len(open_positions) >= max_positions:
        logger.info("Maksimum açık pozisyon sayısına ulaşıldı, yeni alım yapılmayacak.")
        return

    # Çeşitlendirme kuralı: stablecoin'leri hiç alma, ve zaten elde olan kategoriden tekrar alma.
    candidates = [
        r for r in records_to_upsert
        if r["ai_score"] >= effective_min_score
        and r["symbol"] not in held_symbols
        and get_category(r["symbol"]) != "STABLE"
        and get_category(r["symbol"]) not in held_categories
    ]
    candidates.sort(key=lambda r: r["ai_score"], reverse=True)

    # Aynı döngüde birden fazla aday seçilirse, aralarında da kategori tekrarını engelle.
    selected_categories: set = set()
    final_candidates = []
    for c in candidates:
        cat = get_category(c["symbol"])
        if cat in selected_categories:
            continue
        selected_categories.add(cat)
        final_candidates.append(c)

    slots_available = max_positions - len(open_positions)
    for candidate in final_candidates[:slots_available]:
        amount_try = 1500.0
        buy_fee = amount_try * 0.001
        net_investment = amount_try - buy_fee
        entry_price = candidate["price"]
        quantity = net_investment / entry_price if entry_price else 0

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
        client.insert_trade(trade_record)

    logger.info("Döngü başarıyla tamamlandı.")


if __name__ == "__main__":
    logger.info("Binance TR AI Algo-Trading Bot - Tek Döngü Çalıştırması Başlıyor...")
    client = SupabaseRestClient(SUPABASE_URL, SUPABASE_KEY)
    try:
        run_scan_cycle(client)
    except Exception as e:
        logger.error(f"Beklenmeyen hata: {e}", exc_info=True)
        raise
