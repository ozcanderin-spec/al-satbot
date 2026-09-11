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
            return {"mode": "VIRTUAL", "emergency_stop": False, "max_open_positions": 3, "min_ai_score": 75}
        except Exception as e:
            logger.error(f"bot_config okunamadı: {e}")
            return {"mode": "VIRTUAL", "emergency_stop": False, "max_open_positions": 3, "min_ai_score": 75}

    def get_open_positions(self) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/rest/v1/trades"
        params = {"select": "symbol", "is_active": "eq.true"}
        try:
            resp = requests.get(url, headers=self.headers, params=params, timeout=10)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error(f"Açık pozisyonlar okunamadı: {e}")
            return []

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
# 3. YAHOO FINANCE: WATCHLIST FİYAT VERİSİNİ ÇEKME (TRY CİNSİNDEN)
# ------------------------------------------------------------------------------
def fetch_top_20_try_pairs() -> pd.DataFrame:
    logger.info("Yahoo Finance üzerinden piyasa verisi çekiliyor...")

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
# 4. GEMINI KARAR VE PUANLAMA MOTORU
# ------------------------------------------------------------------------------
def analyze_markets_with_gemini(df: pd.DataFrame) -> List[Dict[str, Any]]:
    logger.info("Gemini Algo-Trading Karar Motoru çalıştırılıyor...")

    market_summary = []
    for _, row in df.iterrows():
        market_summary.append({
            "symbol": row['symbol'],
            "last_price": round(float(row['lastPrice']), 4),
            "change_24h_percent": round(float(row['priceChangePercent']), 2),
            "volume_try": round(float(row['quoteVolume']), 0),
            "high_24h": round(float(row['highPrice']), 4),
            "low_24h": round(float(row['lowPrice']), 4)
        })

    prompt = f"""
Sen profesyonel bir Kripto Para Algo-Trading Karar Motorusun.
Aşağıdaki Binance TR en yüksek hacimli 20 TRY paritesinin 24 saatlik fiyat, değişim yüzdesi, hacim ve aralık verilerini analiz et.

HER PARİTE İÇİN:
1. "ai_score": 0 ile 100 arasında tam sayı güven skoru.
2. "signal_type": "STRONG_BUY" (skor >= 80), "BUY" (skor >= 65), "NEUTRAL" (skor 40-64), "SELL" (skor < 40).
3. "scan_reason": Türkçe, 1-2 cümlelik teknik ve hacimsel gerekçe.

Piyasa Verileri:
{json.dumps(market_summary, indent=2)}

SADECE aşağıdaki JSON formatında geçerli bir liste döndür:
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
    mode = config.get("mode", "VIRTUAL")
    emergency_stop = config.get("emergency_stop", False)
    max_positions = int(config.get("max_open_positions", 3) or 3)
    min_ai_score = int(config.get("min_ai_score", 75) or 75)

    logger.info(f"Mod: {mode} | Acil Durdurma: {emergency_stop} | Min Skor: {min_ai_score} | Maks Pozisyon: {max_positions}")

    if emergency_stop:
        logger.warning("ACİL DURDURMA aktif! Yeni alım yapılmayacak.")
        return

    df_top20 = fetch_top_20_try_pairs()
    if df_top20.empty:
        logger.error("Binance verisi boş geldi, döngü atlanıyor.")
        return

    ai_evaluations = analyze_markets_with_gemini(df_top20)
    ai_dict = {item["symbol"]: item for item in ai_evaluations if "symbol" in item}

    records_to_upsert = []
    for _, row in df_top20.iterrows():
        sym = row['symbol']
        ai_data = ai_dict.get(sym, {"ai_score": 50, "signal_type": "NEUTRAL", "scan_reason": "Analiz bekleniyor."})
        record = {
            "symbol": sym,
            "price": float(row['lastPrice']),
            "volume_24h_try": float(row['quoteVolume']),
            "change_24h_percent": float(row['priceChangePercent']),
            "ai_score": int(ai_data.get("ai_score", 50)),
            "signal_type": str(ai_data.get("signal_type", "NEUTRAL")),
            "scan_reason": str(ai_data.get("scan_reason", "Teknik tarama tamamlandı.")),
        }
        records_to_upsert.append(record)

    client.upsert_market_scans(records_to_upsert)

    # --- Otonom Sanal Alım Mantığı ---
    if mode != "VIRTUAL":
        logger.info("Mod VIRTUAL değil, otomatik alım bu script tarafından yapılmıyor (güvenlik).")
        return

    open_positions = client.get_open_positions()
    held_symbols = {p["symbol"] for p in open_positions}
    logger.info(f"Açık pozisyon sayısı: {len(open_positions)}/{max_positions}, semboller: {held_symbols}")

    if len(open_positions) >= max_positions:
        logger.info("Maksimum açık pozisyon sayısına ulaşıldı, yeni alım yapılmayacak.")
        return

    candidates = [r for r in records_to_upsert if r["ai_score"] >= min_ai_score and r["symbol"] not in held_symbols]
    candidates.sort(key=lambda r: r["ai_score"], reverse=True)

    slots_available = max_positions - len(open_positions)
    for candidate in candidates[:slots_available]:
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
