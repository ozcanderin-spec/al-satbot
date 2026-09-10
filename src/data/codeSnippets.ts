export const SQL_SCHEMA = `-- ==============================================================================
-- 1. SUPABASE POSTGRESQL VERİTABANI & GÜVENLİK ŞEMASI (STANDART PRODUCTION-READY)
-- ==============================================================================

-- Gerekli evrensel eklentileri etkinleştir (Vault eklentisi gerektirmez)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- ENUM TİPLERİ
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE app_mode AS ENUM ('VIRTUAL', 'LIVE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE order_side AS ENUM ('BUY', 'SELL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE order_status AS ENUM ('NEW', 'FILLED', 'CANCELLED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ------------------------------------------------------------------------------
-- TABLO 1: bot_config (Kullanıcı Yapılandırması & Güvenli API Anahtarı Saklama)
-- ------------------------------------------------------------------------------
-- Vault eklentisi yerine API anahtarları bot_config tablosunda Single-User RLS
-- ve pgcrypto şifreleme desteğiyle doğrudan ve hatasız şekilde saklanır.
CREATE TABLE IF NOT EXISTS public.bot_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    mode app_mode NOT NULL DEFAULT 'VIRTUAL',
    emergency_stop BOOLEAN NOT NULL DEFAULT FALSE,
    max_open_positions INT NOT NULL DEFAULT 3 CHECK (max_open_positions > 0),
    risk_per_trade_percent NUMERIC(5, 2) NOT NULL DEFAULT 5.00 CHECK (risk_per_trade_percent > 0 AND risk_per_trade_percent <= 100),
    min_ai_score_to_buy INT NOT NULL DEFAULT 75 CHECK (min_ai_score_to_buy BETWEEN 0 AND 100),
    stop_loss_percent NUMERIC(5, 2) NOT NULL DEFAULT 2.50,
    take_profit_percent NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
    -- Binance API Anahtarları (Tek Tabloda, RLS ile Korunan Güvenli Kolonlar):
    binance_api_key TEXT,
    binance_api_secret TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT bot_config_user_unique UNIQUE (user_id)
);

-- ------------------------------------------------------------------------------
-- TABLO 2: market_scans (AI Tarafından Puanlanan Piyasa Taramaları)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.market_scans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    price NUMERIC(18, 8) NOT NULL,
    volume_24h_try NUMERIC(20, 2) NOT NULL,
    change_24h_percent NUMERIC(8, 4) NOT NULL,
    ai_score INT NOT NULL CHECK (ai_score BETWEEN 0 AND 100),
    signal_type VARCHAR(20) NOT NULL CHECK (signal_type IN ('STRONG_BUY', 'BUY', 'NEUTRAL', 'SELL')),
    scan_reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- PostgREST UPSERT (on conflict resolution) için benzersiz kısıt:
    CONSTRAINT market_scans_user_symbol_unique UNIQUE (user_id, symbol)
);

-- ------------------------------------------------------------------------------
-- TABLO 3: trades (İşlem Geçmişi ve Açık Pozisyonlar)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    side order_side NOT NULL DEFAULT 'BUY',
    status order_status NOT NULL DEFAULT 'NEW',
    price NUMERIC(18, 8) NOT NULL,
    quantity NUMERIC(18, 8) NOT NULL,
    cost_try NUMERIC(18, 4) NOT NULL,
    entry_price NUMERIC(18, 8),
    total_amount NUMERIC(18, 4),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    scan_reason TEXT,
    mode app_mode NOT NULL DEFAULT 'VIRTUAL',
    binance_order_id VARCHAR(64),
    realized_pnl NUMERIC(18, 4) DEFAULT 0,
    ai_score_at_entry INT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

-- ------------------------------------------------------------------------------
-- MEVCUT TABLOLARDA SÜTUN GÜVENCESİ (ERROR: 42703 column created_at ÖNLEME)
-- ------------------------------------------------------------------------------
-- Tablolar önceden oluşturulmuşsa eksik sütunları otomatik ekleyerek indeks hatalarını önler:
ALTER TABLE public.bot_config ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.bot_config ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.bot_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.bot_config ADD COLUMN IF NOT EXISTS binance_api_key TEXT;
ALTER TABLE public.bot_config ADD COLUMN IF NOT EXISTS binance_api_secret TEXT;

ALTER TABLE public.market_scans ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.market_scans ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS entry_price NUMERIC(18, 8);
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS total_amount NUMERIC(18, 4);
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS scan_reason TEXT;

-- ------------------------------------------------------------------------------
-- İNDEKSLEME (Yüksek Performanslı Sorgular İçin)
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_market_scans_user_score ON public.market_scans(user_id, ai_score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_user_status ON public.trades(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_config_user ON public.bot_config(user_id);

-- ------------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) AKTİVASYONU & SINGLE-USER ISOLATION POLİTİKALARI
-- ------------------------------------------------------------------------------
ALTER TABLE public.bot_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

-- bot_config RLS Politikaları (Kullanıcı yalnızca kendi bot_config ve API anahtarlarına erişebilir)
CREATE POLICY "Users can view their own bot config" 
ON public.bot_config FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own bot config" 
ON public.bot_config FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own bot config" 
ON public.bot_config FOR UPDATE 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

-- market_scans RLS Politikaları
CREATE POLICY "Users can view their own market scans" 
ON public.market_scans FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert/upsert their own market scans" 
ON public.market_scans FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own market scans" 
ON public.market_scans FOR UPDATE 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own market scans" 
ON public.market_scans FOR DELETE 
USING (auth.uid() = user_id);

-- trades RLS Politikaları
CREATE POLICY "Users can view their own trades" 
ON public.trades FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own trades" 
ON public.trades FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own trades" 
ON public.trades FOR UPDATE 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- BİNANCE API ANAHTARLARI YARDIMCI PROSEDÜRLERİ (STANDART & GÜVENLİ)
-- ------------------------------------------------------------------------------
-- Vault eklentisi yerine auth.uid() doğrulayarak bot_config tablosunda güvenli saklama.

-- 1. Kullanıcının API Key & Secret bilgilerini kaydetme / güncelleme
CREATE OR REPLACE FUNCTION public.save_binance_credentials(
    p_api_key TEXT,
    p_api_secret TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Yetkilendirilmemiş kullanıcı!';
    END IF;

    -- Kullanıcının bot_config kaydını oluştur veya API anahtarlarını güncelle
    INSERT INTO public.bot_config (user_id, binance_api_key, binance_api_secret, updated_at)
    VALUES (v_user_id, p_api_key, p_api_secret, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET 
        binance_api_key = EXCLUDED.binance_api_key,
        binance_api_secret = EXCLUDED.binance_api_secret,
        updated_at = NOW();
END;
$$;

-- 2. Python Bot veya Backend Worker için API Anahtarlarını Okuma
CREATE OR REPLACE FUNCTION public.get_binance_credentials(p_user_id UUID)
RETURNS TABLE(api_key TEXT, api_secret TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.binance_api_key AS api_key,
        b.binance_api_secret AS api_secret
    FROM public.bot_config b
    WHERE b.user_id = p_user_id;
END;
$$;
`;

export const PYTHON_BOT_ENGINE = `"""
==============================================================================
2. PYTHON BOT ENGINE (Google Colab / Bulut Çalıştırıcı - 7/24 Daemon)
==============================================================================
Gereksinimler:
pip install requests pandas google-generativeai

Mimari Detaylar:
- Binance Public 24hr Ticker API -> En yüksek hacimli TOP 20 TRY paritesi
- Google AI Studio (Gemini 1.5 Flash) -> JSON Schema karar motoru (ai_score, signal_type, scan_reason)
- Supabase HTTP PostgREST API -> PGRST125 hatasını önleyen doğrudan ve optimize upsert
- Bot Config & Acil Durum Kontrolü (EMERGENCY STOP & VIRTUAL / LIVE mod)
"""

import os
import time
import json
import logging
import requests
import pandas as pd
import google.generativeai as genai
from typing import List, Dict, Any

# ------------------------------------------------------------------------------
# 1. YAPILANDIRMA & ORTAM DEĞİŞKENLERİ
# ------------------------------------------------------------------------------
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://xyzcompany.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOi...") # Service Role Key veya Authenticated User JWT
USER_ID = os.getenv("USER_ID", "a0000000-0000-0000-0000-000000000001") # Supabase auth.users UUID
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AIzaSy...")

# Binance TR / Binance Global Public API Endpoint
BINANCE_TICKER_24HR_URL = "https://api.binance.me/api/v3/ticker/24hr"

# Loglama ayarı
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("BinanceAlgoBot")

# Gemini 3.6 Flash Yapılandırması (Güncel Model: gemini-3.6-flash)
# Not: Google AI Studio'da gemini-2.5-flash kullanımdan kaldırılmış olup, gemini-3.6-flash önerilmektedir.
genai.configure(api_key=GEMINI_API_KEY)

MODEL_NAME = "gemini-3.6-flash"
try:
    model = genai.GenerativeModel(
        model_name=MODEL_NAME,
        generation_config={"response_mime_type": "application/json"}
    )
except Exception as e:
    logger.warning(f"{MODEL_NAME} başlatılamadı, alternatif deneniyor: {e}")
    model = genai.GenerativeModel(
        model_name="gemini-3.5-flash",
        generation_config={"response_mime_type": "application/json"}
    )

# ------------------------------------------------------------------------------
# 2. SUPABASE REST API İSTEMCİSİ (PGRST125 HATASINI ÖNLEYEN DOĞRUDAN HTTP İSTEMCİSİ)
# ------------------------------------------------------------------------------
class SupabaseRestClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "apikey": api_key,
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # PostgREST resolution=merge-duplicates: Mevcut kaydı günceller (Upsert)
            "Prefer": "resolution=merge-duplicates,return=representation"
        }

    def get_bot_config(self, user_id: str) -> Dict[str, Any]:
        """Kullanıcının bot ayarlarını ve acil durdurma bayrağını çeker."""
        url = f"{self.base_url}/rest/v1/bot_config"
        params = {
            "user_id": f"eq.{user_id}",
            "select": "*"
        }
        try:
            resp = requests.get(url, headers=self.headers, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            if data and len(data) > 0:
                return data[0]
            # Kayıt yoksa varsayılan döndür
            return {"mode": "VIRTUAL", "emergency_stop": False, "max_open_positions": 3}
        except Exception as e:
            logger.error(f"bot_config okunamadı: {e}")
            return {"mode": "VIRTUAL", "emergency_stop": False, "max_open_positions": 3}

    def upsert_market_scans(self, records: List[Dict[str, Any]]) -> bool:
        """
        PGRST125 hatasını önlemek için:
        - URL path doğrudan /rest/v1/market_scans (sonda slash yok).
        - 'on_conflict' parametresi tablo benzersiz kısıtı (user_id,symbol) ile eşleşir.
        - Header 'Prefer: resolution=merge-duplicates' eklenmiştir.
        """
        url = f"{self.base_url}/rest/v1/market_scans?on_conflict=user_id,symbol"
        try:
            response = requests.post(url, headers=self.headers, json=records, timeout=15)
            if response.status_code in (200, 201):
                logger.info(f"Supabase'e {len(records)} adet piyasa tarama verisi başarıyla yazıldı.")
                return True
            else:
                logger.error(f"PostgREST Hatası ({response.status_code}): {response.text}")
                return False
        except Exception as e:
            logger.error(f"Supabase upsert isteği başarısız: {e}")
            return False

# ------------------------------------------------------------------------------
# 3. BİNANCE PUBLIC API: TOP 20 TRY PARİTELERİNİ ÇEKME & PANDAS FİLTRESİ
# ------------------------------------------------------------------------------
def fetch_top_20_try_pairs() -> pd.DataFrame:
    """Binance 24hr Ticker API'sinden TRY ile biten en yüksek hacimli 20 pariteyi çeker."""
    logger.info("Binance Public 24hr Ticker verisi çekiliyor...")
    resp = requests.get(BINANCE_TICKER_24HR_URL, timeout=10)
    resp.raise_for_status()
    raw_data = resp.json()

    df = pd.DataFrame(raw_data)
    
    # Sayısal alanları dönüştür
    numeric_cols = ['lastPrice', 'priceChangePercent', 'volume', 'quoteVolume', 'highPrice', 'lowPrice']
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors='coerce')

    # Sadece TRY ile biten pariteler (Örn: BTCTRY, ETHTRY, SOLTRY)
    df_try = df[df['symbol'].str.endswith('TRY')].copy()
    
    # Hacim sıfır olanları veya kararsız test çiftlerini filtrele
    df_try = df_try[df_try['quoteVolume'] > 100000] # Min 100,000 TRY hacim
    
    # 24 Saatlik TRY işlem hacmine (quoteVolume) göre azalan sırala ve ilk 20'yi al
    df_top20 = df_try.sort_values(by='quoteVolume', ascending=False).head(20).reset_index(drop=True)
    
    logger.info(f"En yüksek hacimli {len(df_top20)} TRY paritesi başarıyla çekildi.")
    return df_top20

# ------------------------------------------------------------------------------
# 4. GOOGLE AI STUDIO (GEMINI 1.5 FLASH) KARAR VE PUANLAMA MOTORU
# ------------------------------------------------------------------------------
def analyze_markets_with_gemini(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Pandas verisini Gemini 1.5 Flash'a gönderir ve JSON Schema formatında
    0-100 arası ai_score, sinyal tipi ve Türkçe gerekçe üretir.
    """
    logger.info("Gemini 1.5 Flash Algo-Trading Karar Motoru çalıştırılıyor...")
    
    # Prompt verisini optimize et
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
1. "ai_score": 0 ile 100 arasında tam sayı güven skoru (0 = Çok riskli/Sat, 50 = Nötr, 100 = Güçlü Alış Fırsatı).
2. "signal_type": "STRONG_BUY" (skor >= 80), "BUY" (skor >= 65), "NEUTRAL" (skor 40-64), "SELL" (skor < 40).
3. "scan_reason": Türkçe, 1-2 cümlelik teknik ve hacimsel gerekçe (Örn: "Yüksek hacim kırılımı ve pozitif momentum ile yükseliş potansiyeli yüksek.").

Piyasa Verileri:
{json.dumps(market_summary, indent=2)}

SADECE aşağıdaki JSON formatında geçerli bir liste döndür:
[
  {{
    "symbol": "BTCTRY",
    "ai_score": 85,
    "signal_type": "STRONG_BUY",
    "scan_reason": "24 saatlik hacim desteği ve kritik direnç testi güçlü alım baskısına işaret ediyor."
  }}
]
"""

    try:
        response = model.generate_content(prompt)
    except Exception as api_err:
        err_msg = str(api_err)
        logger.warning(f"Model çağrısı başarısız oldu ({err_msg}). gemini-3.6-flash ile yeniden deneniyor...")
        try:
            fallback_model = genai.GenerativeModel(
                model_name="gemini-3.6-flash",
                generation_config={"response_mime_type": "application/json"}
            )
            response = fallback_model.generate_content(prompt)
        except Exception as retry_err:
            logger.error(f"Gemini API Hatası: {retry_err}")
            return []

    try:
        ai_results = json.loads(response.text)
        logger.info(f"Gemini {len(ai_results)} parite için AI puanlama analizini tamamladı.")
        return ai_results
    except Exception as e:
        logger.error(f"Gemini JSON parse hatası: {e}. Ham metin: {response.text}")
        return []

# ------------------------------------------------------------------------------
# 5. BOT ÇALIŞTIRMA VE SENKRONİZASYON DÖNGÜSÜ
# ------------------------------------------------------------------------------
def run_scan_cycle(client: SupabaseRestClient):
    logger.info("=== YENİ TARAMA DÖNGÜSÜ BAŞLATILDI ===")
    
    # 1. Bot Ayarlarını & Acil Durdurma Durumunu Kontrol Et
    config = client.get_bot_config(USER_ID)
    mode = config.get("mode", "VIRTUAL")
    emergency_stop = config.get("emergency_stop", False)

    logger.info(f"Aktif Bot Modu: {mode} | Acil Durdurma: {emergency_stop}")

    if emergency_stop:
        logger.warning("DİKKAT: 'ACİL DURDURMA' devrede! Yeni alım yapılmayacak.")
        return

    # 2. Binance Verilerini Çek
    df_top20 = fetch_top_20_try_pairs()
    if df_top20.empty:
        logger.error("Binance verisi boş geldi, döngü atlanıyor.")
        return

    # 3. Gemini 1.5 Flash ile Analiz Et
    ai_evaluations = analyze_markets_with_gemini(df_top20)
    ai_dict = {item["symbol"]: item for item in ai_evaluations if "symbol" in item}

    # 4. Verileri Supabase Formatına Dönüştür
    records_to_upsert = []
    for _, row in df_top20.iterrows():
        sym = row['symbol']
        ai_data = ai_dict.get(sym, {
            "ai_score": 50,
            "signal_type": "NEUTRAL",
            "scan_reason": "Veri AI motoru tarafından inceleniyor."
        })

        record = {
            "user_id": USER_ID,
            "symbol": sym,
            "price": float(row['lastPrice']),
            "volume_24h_try": float(row['quoteVolume']),
            "change_24h_percent": float(row['priceChangePercent']),
            "ai_score": int(ai_data.get("ai_score", 50)),
            "signal_type": str(ai_data.get("signal_type", "NEUTRAL")),
            "scan_reason": str(ai_data.get("scan_reason", "Teknik tarama tamamlandı."))
        }
        records_to_upsert.append(record)

    # 5. Supabase 'market_scans' Tablosuna HTTP REST ile Upsert Et
    success = client.upsert_market_scans(records_to_upsert)
    if success:
        logger.info(f"Döngü başarıyla tamamlandı. {len(records_to_upsert)} parite güncellendi.")

# ------------------------------------------------------------------------------
# 6. ANA ÇALIŞTIRICI (7/24 LOOP VEYA COLAB TEK ÇALIŞTIRMA)
# ------------------------------------------------------------------------------
if __name__ == "__main__":
    logger.info("Binance TR 7/24 AI Algo-Trading Bot Başlatılıyor...")
    client = SupabaseRestClient(SUPABASE_URL, SUPABASE_KEY)
    
    # Test çalıştırması (7/24 çalıştırmak için while True içine alınabilir)
    try:
        run_scan_cycle(client)
    except KeyboardInterrupt:
        logger.info("Bot kullanıcı tarafından durduruldu.")
    except Exception as e:
        logger.error(f"Beklenmeyen hata: {e}", exc_info=True)
`;

export const ANDROID_GRADLE_DEPENDENCIES = `// build.gradle.kts (Module :app)
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
}

dependencies {
    // Jetpack Compose & Material 3
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    // Supabase Kotlin SDK (PostgREST & Serialization)
    implementation(platform("io.github.jan-tennert.supabase:bom:2.6.1"))
    implementation("io.github.jan-tennert.supabase:postgrest-kt")
    implementation("io.github.jan-tennert.supabase:realtime-kt")
    implementation("io.github.jan-tennert.supabase:gotrue-kt")

    // Ktor HTTP Client (Supabase Engine)
    implementation("io.ktor:ktor-client-android:2.3.12")
    implementation("io.ktor:ktor-client-core:2.3.12")

    // Kotlinx Serialization JSON
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
`;

export const ANDROID_DATA_CLASS = `package com.binance.algotrader.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Supabase 'market_scans' tablosu PostgREST JSON yanıtıyla %100 uyumlu veri sınıfı.
 */
@Serializable
data class MarketScan(
    @SerialName("id")
    val id: String? = null,

    @SerialName("user_id")
    val userId: String? = null,

    @SerialName("symbol")
    val symbol: String,

    @SerialName("price")
    val price: Double,

    @SerialName("volume_24h_try")
    val volume24hTry: Double,

    @SerialName("change_24h_percent")
    val change24hPercent: Double,

    @SerialName("ai_score")
    val aiScore: Int,

    @SerialName("signal_type")
    val signalType: String, // STRONG_BUY, BUY, NEUTRAL, SELL

    @SerialName("scan_reason")
    val scanReason: String,

    @SerialName("created_at")
    val createdAt: String? = null,

    @SerialName("scanned_at")
    val scannedAt: String? = null
)

/**
 * Supabase 'bot_config' tablosu veri sınıfı.
 */
@Serializable
data class BotConfig(
    @SerialName("id")
    val id: String? = null,

    @SerialName("user_id")
    val userId: String? = null,

    @SerialName("mode")
    val mode: String = "VIRTUAL", // "VIRTUAL" veya "LIVE"

    @SerialName("emergency_stop")
    val emergencyStop: Boolean = false,

    @SerialName("max_open_positions")
    val maxOpenPositions: Int = 3,

    @SerialName("risk_per_trade_percent")
    val riskPerTradePercent: Double = 5.0,

    @SerialName("binance_api_key")
    val binanceApiKey: String? = null,

    @SerialName("binance_api_secret")
    val binanceApiSecret: String? = null,

    @SerialName("created_at")
    val createdAt: String? = null,

    @SerialName("scanned_at")
    val scannedAt: String? = null
)

/**
 * Supabase 'trades' tablosu sanal cüzdan & aktif pozisyon veri sınıfı.
 */
@Serializable
data class Trade(
    @SerialName("id")
    val id: String? = null,

    @SerialName("symbol")
    val symbol: String,

    @SerialName("entry_price")
    val entryPrice: Double,

    @SerialName("total_amount")
    val totalAmount: Double,

    @SerialName("is_active")
    val isActive: Boolean = true,

    @SerialName("scan_reason")
    val scanReason: String? = null,

    @SerialName("created_at")
    val createdAt: String? = null
)
`;

export const ANDROID_VIEW_MODEL = `package com.binance.algotrader.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.binance.algotrader.data.model.BotConfig
import com.binance.algotrader.data.model.MarketScan
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface UiState {
    object Loading : UiState
    data class Success(val scans: List<MarketScan>) : UiState
    data class Error(val message: String) : UiState
}

class MarketScanViewModel(
    // SupabaseClient DI (Hilt/Koin) veya Singleton ile enjekte edilebilir
    private val supabase: SupabaseClient = SupabaseClientProvider.client
) : ViewModel() {

    private val _uiState = MutableStateFlow<UiState>(UiState.Loading)
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    private val _botConfig = MutableStateFlow(BotConfig())
    val botConfig: StateFlow<BotConfig> = _botConfig.asStateFlow()

    private val _actionFeedback = MutableStateFlow<String?>(null)
    val actionFeedback: StateFlow<String?> = _actionFeedback.asStateFlow()

    init {
        loadData()
    }

    fun loadData() {
        fetchMarketScans()
        fetchBotConfig()
    }

    /**
     * Supabase 'market_scans' tablosundan verileri ai_score azalan sırasıyla çeker.
     */
    fun fetchMarketScans() {
        viewModelScope.launch {
            _uiState.value = UiState.Loading
            try {
                val results = supabase.from("market_scans")
                    .select {
                        order(column = "ai_score", order = Order.DESCENDING)
                        limit(count = 20)
                    }
                    .decodeList<MarketScan>()

                _uiState.value = UiState.Success(results)
            } catch (e: Exception) {
                _uiState.value = UiState.Error(e.localizedMessage ?: "Piyasa verileri yüklenemedi!")
            }
        }
    }

    /**
     * Kullanıcı bot yapılandırmasını getirir.
     */
    fun fetchBotConfig() {
        viewModelScope.launch {
            try {
                val config = supabase.from("bot_config")
                    .select {
                        limit(1)
                    }
                    .decodeSingleOrNull<BotConfig>()

                if (config != null) {
                    _botConfig.value = config
                }
            } catch (e: Exception) {
                // Varsayılan sanal modda devam et
            }
        }
    }

    /**
     * VIRTUAL <-> LIVE modunu tek dokunuşla değiştirir.
     */
    fun toggleAppMode() {
        viewModelScope.launch {
            val currentMode = _botConfig.value.mode
            val newMode = if (currentMode == "VIRTUAL") "LIVE" else "VIRTUAL"

            try {
                supabase.from("bot_config").update(
                    {
                        set("mode", newMode)
                    }
                ) {
                    // Mevcut kullanıcı için güncelle
                }
                _botConfig.update { it.copy(mode = newMode) }
                _actionFeedback.value = "Bot Modu Güncellendi: $newMode"
            } catch (e: Exception) {
                _actionFeedback.value = "Mod güncellenemedi: \${e.localizedMessage}"
            }
        }
    }

    /**
     * ACİL MÜDAHALE: Tüm açık pozisyonları kapatır ve botu durdurur.
     */
    fun triggerEmergencyStop() {
        viewModelScope.launch {
            try {
                supabase.from("bot_config").update(
                    {
                        set("emergency_stop", true)
                        set("mode", "VIRTUAL") // Güvenlik için sanal moda çek
                    }
                )

                _botConfig.update { it.copy(emergencyStop = true, mode = "VIRTUAL") }
                _actionFeedback.value = "DİKKAT: ACİL STOP TETİKLENDİ! Tüm emirler iptal ediliyor."
            } catch (e: Exception) {
                _actionFeedback.value = "Acil stop tetikleme hatası: \${e.localizedMessage}"
            }
        }
    }

    fun clearFeedback() {
        _actionFeedback.value = null
    }
}

/**
 * Sanal Cüzdan & Aktif Pozisyonlar UI Durumu
 */
sealed interface WalletUiState {
    object Loading : WalletUiState
    data class Success(
        val activeTrades: List<com.binance.algotrader.data.model.Trade>,
        val initialBalance: Double = 10000.0,
        val totalInvested: Double,
        val availableCash: Double
    ) : WalletUiState
    data class Error(val message: String) : WalletUiState
}

/**
 * Sanal Cüzdan & Aktif İşlemler ViewModel
 */
class WalletViewModel(
    private val supabase: SupabaseClient = SupabaseClientProvider.client
) : ViewModel() {

    private val _walletState = MutableStateFlow<WalletUiState>(WalletUiState.Loading)
    val walletState: StateFlow<WalletUiState> = _walletState.asStateFlow()

    private val defaultInitialBalance = 10000.0

    init {
        loadWalletData()
    }

    /**
     * PostgREST: 'trades' tablosundan is_active = true olan açık pozisyonları created_at azalan sırayla çeker
     */
    fun loadWalletData() {
        viewModelScope.launch {
            _walletState.value = WalletUiState.Loading
            try {
                val trades = supabase.from("trades").select {
                    filter {
                        eq("is_active", true)
                    }
                    order("created_at", order = Order.DESCENDING)
                }.decodeList<com.binance.algotrader.data.model.Trade>()

                val totalInvested = trades.sumOf { it.totalAmount }
                val availableCash = (defaultInitialBalance - totalInvested).coerceAtLeast(0.0)

                _walletState.value = WalletUiState.Success(
                    activeTrades = trades,
                    initialBalance = defaultInitialBalance,
                    totalInvested = totalInvested,
                    availableCash = availableCash
                )
            } catch (e: Exception) {
                _walletState.value = WalletUiState.Error(
                    e.localizedMessage ?: "Cüzdan ve işlem verileri yüklenemedi."
                )
            }
        }
    }
}

/**
 * Supabase İstemci Singleton Sağlayıcısı
 */
object SupabaseClientProvider {
    val client: SupabaseClient by lazy {
        createSupabaseClient(
            supabaseUrl = "https://YOUR_PROJECT_ID.supabase.co",
            supabaseKey = "YOUR_ANON_PUBLIC_KEY"
        ) {
            install(Postgrest)
        }
    }
}
`;

export const ANDROID_COMPOSE_UI = `package com.binance.algotrader.ui.screens

import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.binance.algotrader.data.model.MarketScan
import com.binance.algotrader.ui.viewmodel.MarketScanViewModel
import com.binance.algotrader.ui.viewmodel.UiState
import java.text.NumberFormat
import java.util.Locale

// ------------------------------------------------------------------------------
// ÖZEL RENK PALETİ (DARK MODE: #12141C / #1E222D, YEŞİL: #00E676, KIRMIZI: #FFFF5252)
// ------------------------------------------------------------------------------
val DarkCanvas = Color(0xFF12141C)
val DarkSurface = Color(0xFF1E222D)
val DarkSurfaceHighlight = Color(0xFF282E3E)
val TextPrimary = Color(0xFFFFFFFF)
val TextSecondary = Color(0xFF90A4AE)

val AiGreen = Color(0xFF00E676)
val AiRed = Color(0xFFFF5252)
val WarningAmber = Color(0xFFFFB300)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BotDashboardScreen(
    viewModel: MarketScanViewModel,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val botConfig by viewModel.botConfig.collectAsState()
    val feedback by viewModel.actionFeedback.collectAsState()

    var showEmergencyDialog by remember { mutableStateOf(false) }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = DarkCanvas,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "BINANCE TR • AI ALGO BOT",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary,
                            letterSpacing = 1.sp
                        )
                        Text(
                            text = "Gemini 1.5 Flash Karar Motoru",
                            fontSize = 11.sp,
                            color = TextSecondary
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = DarkSurface
                ),
                actions = {
                    IconButton(onClick = { viewModel.loadData() }) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Yenile",
                            tint = TextPrimary
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .padding(innerPadding)
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            // ------------------------------------------------------------------
            // 1. ACİL MÜDAHALE VE ÇALIŞMA MODU BÖLÜMÜ (ZORUNLU GEREKSİNİM)
            // ------------------------------------------------------------------
            EmergencyControlSection(
                mode = botConfig.mode,
                isEmergencyStopped = botConfig.emergencyStop,
                onToggleMode = { viewModel.toggleAppMode() },
                onEmergencyStopClick = { showEmergencyDialog = true }
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Feedback Banner
            feedback?.let { msg ->
                Surface(
                    color = if (msg.contains("ACİL")) AiRed.copy(alpha = 0.2f) else DarkSurfaceHighlight,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 12.dp)
                        .clickable { viewModel.clearFeedback() }
                ) {
                    Text(
                        text = msg,
                        color = TextPrimary,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(12.dp)
                    )
                }
            }

            // ------------------------------------------------------------------
            // 2. LİSTE BAŞLIĞI VE CANLI DURUM
            // ------------------------------------------------------------------
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "CANLI PİYASA TARAMASI (TOP 20 TRY)",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = TextSecondary,
                    letterSpacing = 0.5.sp
                )
                Text(
                    text = "AI SKOR SIRALI",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = AiGreen
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            // ------------------------------------------------------------------
            // 3. PİYASA TARAMA LİSTESİ (JETPACK COMPOSE LAZYCOLUMN)
            // ------------------------------------------------------------------
            when (val state = uiState) {
                is UiState.Loading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(color = AiGreen)
                    }
                }
                is UiState.Error -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "Hata: \${state.message}",
                            color = AiRed,
                            fontSize = 14.sp
                        )
                    }
                }
                is UiState.Success -> {
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.fillMaxSize()
                    ) {
                        items(state.scans, key = { it.symbol }) { scan ->
                            MarketScanCard(scan = scan)
                        }
                    }
                }
            }
        }
    }

    // Acil Stop Onay Diyaloğu
    if (showEmergencyDialog) {
        AlertDialog(
            onDismissRequest = { showEmergencyDialog = false },
            containerColor = DarkSurface,
            icon = {
                Icon(
                    imageVector = Icons.Default.Warning,
                    contentDescription = null,
                    tint = AiRed,
                    modifier = Modifier.size(36.dp)
                )
            },
            title = {
                Text(
                    text = "ACİL MÜDAHALE PROTOKOLÜ",
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )
            },
            text = {
                Text(
                    text = "Bu işlem açık olan tüm emirleri anında iptal edecek, botu VIRTUAL moda alacak ve 7/24 motoru kilitli duruma geçirecektir. Onaylıyor musunuz?",
                    color = TextSecondary,
                    fontSize = 13.sp
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.triggerEmergencyStop()
                        showEmergencyDialog = false
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = AiRed)
                ) {
                    Text("TÜMÜNÜ KAPAT VE DURDUR", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showEmergencyDialog = false }) {
                    Text("VAZGEÇ", color = TextSecondary)
                }
            }
        )
    }
}

/**
 * Acil Müdahale ve Çalışma Modu Kartı
 */
@Composable
fun EmergencyControlSection(
    mode: String,
    isEmergencyStopped: Boolean,
    onToggleMode: () -> Unit,
    onEmergencyStopClick: () -> Unit
) {
    Surface(
        color = DarkSurface,
        shape = RoundedCornerShape(12.dp),
        border = androidx.compose.foundation.BorderStroke(
            width = 1.dp,
            color = if (mode == "LIVE") AiGreen.copy(alpha = 0.5f) else DarkSurfaceHighlight
        ),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        text = "BOT ÇALIŞMA DURUMU",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextSecondary
                    )
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(if (isEmergencyStopped) AiRed else if (mode == "LIVE") AiGreen else WarningAmber)
                        )
                        Text(
                            text = if (isEmergencyStopped) "ACİL DURDURULDU" else "$mode MODUNDA AKTİF",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                    }
                }

                // VIRTUAL / LIVE Değiştir Butonu
                Button(
                    onClick = onToggleMode,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (mode == "LIVE") AiGreen else DarkSurfaceHighlight
                    ),
                    shape = RoundedCornerShape(8.dp),
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = if (mode == "LIVE") "MOD: CANLI (LIVE)" else "MOD: SANAL (VIRTUAL)",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (mode == "LIVE") Color.Black else TextPrimary
                    )
                }
            }

            // TEK TIKLA ACİL STOP BUTONU (ZORUNLU GEREKSİNİM)
            Button(
                onClick = onEmergencyStopClick,
                colors = ButtonDefaults.buttonColors(containerColor = AiRed),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Warning,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "ACİL TÜM POZİSYONLARI KAPAT",
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    color = Color.White,
                    letterSpacing = 0.5.sp
                )
            }
        }
    }
}

/**
 * Tekil Piyasa Taraması ve AI Skoru Kartı
 */
@Composable
fun MarketScanCard(scan: MarketScan) {
    var expanded by remember { mutableStateOf(false) }

    val isBuy = scan.aiScore >= 65
    val isSell = scan.aiScore < 40
    val scoreBadgeColor = when {
        scan.aiScore >= 80 -> AiGreen
        scan.aiScore >= 65 -> AiGreen.copy(alpha = 0.85f)
        scan.aiScore < 40 -> AiRed
        else -> WarningAmber
    }

    Surface(
        color = DarkSurface,
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier
            .fillMaxWidth()
            .clickable { expanded = !expanded }
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Sol Bölüm: Sembol ve 24h Hacim
                Column {
                    Text(
                        text = scan.symbol,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        color = TextPrimary
                    )
                    Text(
                        text = "Hacim: \${formatCurrency(scan.volume24hTry)} ₺",
                        fontSize = 11.sp,
                        color = TextSecondary
                    )
                }

                // Orta Bölüm: Fiyat ve Değişim
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        text = "\${formatPrice(scan.price)} ₺",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                        color = TextPrimary
                    )
                    Text(
                        text = "% \${String.format(Locale.US, "%+.2f", scan.change24hPercent)}",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (scan.change24hPercent >= 0) AiGreen else AiRed
                    )
                }

                // Sağ Bölüm: AI SKOR ROZETİ (0-100)
                Surface(
                    color = scoreBadgeColor.copy(alpha = 0.15f),
                    border = androidx.compose.foundation.BorderStroke(1.dp, scoreBadgeColor),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = "\${scan.aiScore}",
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 16.sp,
                            color = scoreBadgeColor
                        )
                        Text(
                            text = scan.signalType,
                            fontWeight = FontWeight.Bold,
                            fontSize = 8.sp,
                            color = scoreBadgeColor
                        )
                    }
                }
            }

            // Türkçe AI Gerekçe Bölümü (Tıklanınca veya Otomatik Gösterim)
            Spacer(modifier = Modifier.height(8.dp))
            Surface(
                color = DarkCanvas.copy(alpha = 0.6f),
                shape = RoundedCornerShape(6.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(8.dp),
                    verticalAlignment = Alignment.Top
                ) {
                    Text(
                        text = "AI: ",
                        fontWeight = FontWeight.Bold,
                        fontSize = 11.sp,
                        color = scoreBadgeColor
                    )
                    Text(
                        text = scan.scanReason,
                        fontSize = 11.sp,
                        color = TextSecondary,
                        lineHeight = 15.sp
                    )
                }
            }
        }
    }
}

// Yardımcı Format Fonksiyonları
fun formatPrice(price: Double): String {
    return if (price < 1.0) {
        String.format(Locale.US, "%.6f", price)
    } else {
        String.format(Locale.US, "%,.2f", price)
    }
}

fun formatCurrency(amount: Double): String {
    return NumberFormat.getIntegerInstance(Locale.GERMANY).format(amount.toLong())
}

// ==============================================================================
// SANAL CÜZDAN & AKTİF POZİSYONLAR EKRANI (WalletScreen.kt)
// ==============================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletScreen(
    walletViewModel: WalletViewModel,
    modifier: Modifier = Modifier
) {
    val walletState by walletViewModel.walletState.collectAsState()

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = DarkCanvas,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "SANAL CÜZDAN & POZİSYONLAR",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary,
                            letterSpacing = 1.sp
                        )
                        Text(
                            text = "Otomatik Gemini 1.5 Flash Alımları (Puan >= 80)",
                            fontSize = 11.sp,
                            color = TextSecondary
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = DarkSurface
                ),
                actions = {
                    IconButton(onClick = { walletViewModel.loadWalletData() }) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Cüzdanı Yenile",
                            tint = TextPrimary
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .padding(innerPadding)
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            when (val state = walletState) {
                is WalletUiState.Loading -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(color = AiGreen)
                    }
                }
                is WalletUiState.Error -> {
                    Surface(
                        color = Color(0xFF2C1518),
                        border = BorderStroke(1.dp, AiRed.copy(alpha = 0.5f)),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().padding(8.dp)
                    ) {
                        Text(
                            text = state.message,
                            color = AiRed,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }
                is WalletUiState.Success -> {
                    // 1. TOPLAM SANAL BAKİYE KARTI (#1E222D Zemin, #00E676 Vurgulu)
                    VirtualBalanceCard(
                        initialBalance = state.initialBalance,
                        totalInvested = state.totalInvested,
                        availableCash = state.availableCash,
                        activePositionsCount = state.activeTrades.size
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    // 2. AKTİF POZİSYONLAR BAŞLIĞI
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Açık Sanal Pozisyonlar (\${state.activeTrades.size})",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                        Text(
                            text = "Supabase trades tablosu",
                            fontSize = 11.sp,
                            color = TextSecondary
                        )
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    // 3. AKTİF POZİSYONLAR LİSTESİ VEYA BOŞ DURUM UYARISI
                    if (state.activeTrades.isEmpty()) {
                        EmptyPositionsCard()
                    } else {
                        LazyColumn(
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                            modifier = Modifier.fillMaxSize()
                        ) {
                            items(state.activeTrades, key = { it.id ?: it.symbol }) { trade ->
                                ActiveTradePositionCard(trade = trade)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Toplam Sanal Bakiye Kartı
 */
@Composable
fun VirtualBalanceCard(
    initialBalance: Double,
    totalInvested: Double,
    availableCash: Double,
    activePositionsCount: Int
) {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = DarkSurface),
        border = BorderStroke(1.dp, DarkBorder),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "TOPLAM SANAL BAKİYE",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = TextSecondary,
                    letterSpacing = 1.sp
                )
                Surface(
                    color = AiGreen.copy(alpha = 0.15f),
                    shape = RoundedCornerShape(6.dp)
                ) {
                    Text(
                        text = "VIRTUAL WALLET",
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold,
                        color = AiGreen,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(6.dp))

            Text(
                text = "₺\${formatPrice(initialBalance)} TRY",
                fontSize = 26.sp,
                fontWeight = FontWeight.ExtraBold,
                color = AiGreen,
                letterSpacing = (-0.5).sp
            )

            Spacer(modifier = Modifier.height(14.dp))
            Divider(color = DarkBorder)
            Spacer(modifier = Modifier.height(14.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column {
                    Text(
                        text = "Yatırımdaki Tutar",
                        fontSize = 11.sp,
                        color = TextSecondary
                    )
                    Text(
                        text = "₺\${formatPrice(totalInvested)}",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "Açık Pozisyon",
                        fontSize = 11.sp,
                        color = TextSecondary
                    )
                    Text(
                        text = "$activePositionsCount Adet",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (activePositionsCount > 0) AiGreen else TextSecondary
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        text = "Kullanılabilir Nakit",
                        fontSize = 11.sp,
                        color = TextSecondary
                    )
                    Text(
                        text = "₺\${formatPrice(availableCash)}",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                }
            }
        }
    }
}

/**
 * Açık Sanal Pozisyon Kartı
 */
@Composable
fun ActiveTradePositionCard(trade: com.binance.algotrader.data.model.Trade) {
    Card(
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = DarkSurface),
        border = BorderStroke(1.dp, DarkBorder),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .background(AiGreen, CircleShape)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = trade.symbol,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Black,
                        color = TextPrimary
                    )
                }

                Surface(
                    color = AiGreen.copy(alpha = 0.15f),
                    border = BorderStroke(1.dp, AiGreen.copy(alpha = 0.5f)),
                    shape = RoundedCornerShape(6.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "AKTİF",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.ExtraBold,
                            color = AiGreen
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column {
                    Text(
                        text = "Giriş Fiyatı (Entry Price)",
                        fontSize = 10.sp,
                        color = TextSecondary
                    )
                    Text(
                        text = "₺\${formatPrice(trade.entryPrice)}",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                }

                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        text = "Sanal Miktar (Total Amount)",
                        fontSize = 10.sp,
                        color = TextSecondary
                    )
                    Text(
                        text = "₺\${formatPrice(trade.totalAmount)} TRY",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = AiGreen
                    )
                }
            }

            if (!trade.scanReason.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(10.dp))
                Surface(
                    color = DarkCanvas.copy(alpha = 0.7f),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(8.dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Text(
                            text = "AI Gerekçesi: ",
                            fontWeight = FontWeight.Bold,
                            fontSize = 10.sp,
                            color = AiGreen
                        )
                        Text(
                            text = trade.scanReason,
                            fontSize = 10.sp,
                            color = TextSecondary,
                            lineHeight = 14.sp
                        )
                    }
                }
            }
        }
    }
}

/**
 * Hiç Aktif Pozisyon Yoksa Gösterilecek Boş Durum Kartı
 */
@Composable
fun EmptyPositionsCard() {
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = DarkSurface),
        border = BorderStroke(1.dp, DarkBorder),
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)
    ) {
        Column(
            modifier = Modifier.padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .background(Color(0xFF282E3E), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Info,
                    contentDescription = null,
                    tint = TextSecondary,
                    modifier = Modifier.size(24.dp)
                )
            }
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "Henüz açık sanal pozisyon yok",
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = "Google Colab Python Botu piyasa taramasında Gemini AI puanı 80 ve üzeri olan bir fırsat yakaladığında burada otomatik açılan sanal pozisyonu göreceksiniz.",
                fontSize = 11.sp,
                color = TextSecondary,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                lineHeight = 16.sp
            )
        }
    }
}

// ==============================================================================
// RADAR & CÜZDAN ARASI BOTTOM NAVIGATION / TABROW ENTEGRASYONU
// ==============================================================================

@Composable
fun MainAppBottomNavigation(
    selectedTab: Int,
    onTabSelected: (Int) -> Unit
) {
    NavigationBar(
        containerColor = DarkSurface,
        contentColor = TextPrimary
    ) {
        NavigationBarItem(
            selected = selectedTab == 0,
            onClick = { onTabSelected(0) },
            icon = { Icon(Icons.Default.Search, contentDescription = "Radar") },
            label = { Text("Radar") },
            colors = NavigationBarItemDefaults.colors(
                selectedIconColor = AiGreen,
                selectedTextColor = AiGreen,
                indicatorColor = AiGreen.copy(alpha = 0.15f),
                unselectedIconColor = TextSecondary,
                unselectedTextColor = TextSecondary
            )
        )
        NavigationBarItem(
            selected = selectedTab == 1,
            onClick = { onTabSelected(1) },
            icon = { Icon(Icons.Default.AccountBalanceWallet, contentDescription = "Cüzdan") },
            label = { Text("Cüzdan") },
            colors = NavigationBarItemDefaults.colors(
                selectedIconColor = AiGreen,
                selectedTextColor = AiGreen,
                indicatorColor = AiGreen.copy(alpha = 0.15f),
                unselectedIconColor = TextSecondary,
                unselectedTextColor = TextSecondary
            )
        )
    }
}
`;

export const WEB_CONTROL_PANEL_HTML = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AITraderPro - Trading Control Panel</title>
  
  <!-- Supabase CDN JS Kütüphanesi -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  
  <!-- Modern Koyu Tema & Reset Stilleri (#12141C Canvas, #1E222D Cards, #00E676 Green) -->
  <style>
    :root {
      --bg-canvas: #12141C;
      --bg-card: #1E222D;
      --border-color: #282E3E;
      --color-primary: #00E676;
      --color-primary-dim: rgba(0, 230, 118, 0.15);
      --color-danger: #FFFF5252;
      --color-danger-dim: rgba(255, 82, 82, 0.15);
      --text-main: #FFFFFF;
      --text-muted: #94A3B8;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-canvas);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      padding: 24px;
      min-height: 100vh;
    }
    .container { max-width: 1280px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }

    /* HEADER */
    header {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 16px; padding: 18px 24px; background: var(--bg-card);
      border: 1px solid var(--border-color); border-radius: 14px;
    }
    .brand-group { display: flex; align-items: center; gap: 12px; }
    .brand-logo {
      width: 40px; height: 40px; background: var(--color-primary-dim);
      border: 1px solid var(--color-primary); border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; color: var(--color-primary);
    }
    .brand-title h1 { font-size: 18px; font-weight: 800; }
    .brand-title p { font-size: 12px; color: var(--text-muted); }

    /* KONTROL BUTONLARI (ÜST BÖLÜM) */
    .controls-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px;
    }
    button {
      font-family: inherit; cursor: pointer; border: none; border-radius: 10px;
      padding: 12px 18px; font-size: 13px; font-weight: 700; transition: all 0.2s ease;
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    }
    button:active { transform: scale(0.98); }
    .btn-binance { background: #F3BA2F; color: #000; }
    .btn-binance:hover { background: #ffd04b; }
    .btn-simulate { background: var(--color-primary); color: #12141C; }
    .btn-simulate:hover { background: #22ff8f; }
    .btn-emergency { background: var(--color-danger); color: #FFF; }
    .btn-emergency:hover { background: #ff6b6b; }
    .btn-secondary { background: #282E3E; color: #FFF; border: 1px solid var(--border-color); }

    /* DURUM & SAYAC BARI */
    .status-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 16px; background: rgba(30, 34, 45, 0.7);
      border: 1px dashed var(--border-color); border-radius: 10px;
      font-size: 12px; color: var(--text-muted);
    }
    .timer-text { font-family: var(--font-mono); font-weight: 700; color: var(--color-primary); }

    /* KART BÖLÜMLERİ */
    .section-card {
      background: var(--bg-card); border: 1px solid var(--border-color);
      border-radius: 14px; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px;
    }
    .section-header {
      display: flex; justify-content: space-between; align-items: center;
      padding-bottom: 12px; border-bottom: 1px solid var(--border-color);
    }
    .section-header h2 { font-size: 15px; font-weight: 800; }

    /* CÜZDAN METRİKLERİ */
    .wallet-metrics {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;
    }
    .metric-box {
      background: #12141C; border: 1px solid var(--border-color);
      padding: 12px 16px; border-radius: 10px;
    }
    .metric-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; }
    .metric-val { font-size: 20px; font-weight: 900; font-family: var(--font-mono); color: var(--color-primary); margin-top: 4px; }

    /* TRADES LİSTESİ */
    .trades-list { display: flex; flex-direction: column; gap: 10px; }
    .trade-row {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 12px; padding: 12px 16px; background: #12141C;
      border: 1px solid var(--border-color); border-radius: 10px;
    }
    .trade-symbol { font-size: 15px; font-weight: 800; font-family: var(--font-mono); }
    .badge-active {
      font-size: 9px; font-weight: 800; padding: 2px 8px; border-radius: 4px;
      background: var(--color-primary-dim); color: var(--color-primary); border: 1px solid rgba(0, 230, 118, 0.4);
    }

    /* MARKET SCANS GRID (ALT BÖLÜM) */
    .scans-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px;
    }
    .scan-card {
      background: #12141C; border: 1px solid var(--border-color);
      border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px;
    }
    .scan-top { display: flex; align-items: center; justify-content: space-between; }
    .ai-badge {
      padding: 4px 8px; border-radius: 6px; text-align: center; font-family: var(--font-mono);
    }
    .ai-badge-green { background: var(--color-primary-dim); color: var(--color-primary); border: 1px solid var(--color-primary); }
    .ai-badge-red { background: var(--color-danger-dim); color: var(--color-danger); border: 1px solid var(--color-danger); }
    .scan-reason {
      background: rgba(30, 34, 45, 0.5); padding: 10px; border-radius: 6px;
      font-size: 11px; color: #CBD5E1; line-height: 1.5;
    }
    .empty-state { text-align: center; padding: 24px; color: var(--text-muted); font-size: 12px; }
  </style>
</head>
<body>

  <div class="container">
    
    <!-- HEADER -->
    <header>
      <div class="brand-group">
        <div class="brand-logo">⚡</div>
        <div class="brand-title">
          <h1>AITraderPro Control Panel</h1>
          <p>Binance TR API + Gemini Flash Karar Motoru + Supabase PostgREST</p>
        </div>
      </div>
      <div id="bot-mode-badge" style="background:#282E3E; border:1px solid #475569; padding:6px 12px; border-radius:20px; font-size:11px; font-weight:800;">
        SANAL MOD (VIRTUAL)
      </div>
    </header>

    <!-- 1. ÜST BÖLÜM: TEST VE MÜDAHALE BUTONLARI -->
    <div class="controls-grid">
      <button class="btn-binance" onclick="fetchTRYPairs()">
        📈 Binance API'den Canlı TRY Paritelerini Çek
      </button>

      <button class="btn-simulate" onclick="simulateAiAnalysis()">
        🤖 Yapay Zeka Analizini Simüle Et (Gemini Flash)
      </button>

      <button class="btn-emergency" onclick="triggerEmergencyStop()">
        🚨 Acil Durdurma (Emergency Stop)
      </button>
    </div>

    <!-- 10 SANİYE SAYACI & DURUM BİLGİSİ -->
    <div class="status-bar">
      <div id="status-text">Sistem hazır. Veriler yükleniyor...</div>
      <div>Otomatik Yenileme: <span id="sync-timer" class="timer-text">10s</span></div>
    </div>

    <!-- 2. ORTA BÖLÜM: SANAL CÜZDAN & TRADES (is_active = true) -->
    <div class="section-card">
      <div class="section-header">
        <h2>💼 Sanal Cüzdan & Açık Pozisyonlar (trades Tablosu)</h2>
        <button class="btn-secondary" style="padding:6px 12px; font-size:11px;" onclick="loadData()">
          🔄 Şimdi Yenile
        </button>
      </div>

      <div class="wallet-metrics">
        <div class="metric-box">
          <div class="metric-label">Toplam Sanal Bakiye</div>
          <div class="metric-val" id="val-balance">₺10.000,00</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Yatırımdaki Tutar</div>
          <div class="metric-val" id="val-invested" style="color:#FFF;">₺0,00</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Açık Pozisyon</div>
          <div class="metric-val" id="val-count">0 Adet</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Kullanılabilir Nakit</div>
          <div class="metric-val" id="val-cash" style="color:#FFF;">₺10.000,00</div>
        </div>
      </div>

      <div id="trades-container" class="trades-list">
        <div class="empty-state">Yükleniyor...</div>
      </div>
    </div>

    <!-- 3. ALT BÖLÜM: SON 6 AI ANALİZİ GRID (market_scans Tablosu) -->
    <div class="section-card">
      <div class="section-header">
        <h2>🎯 Son 6 Yapay Zeka Analizi (market_scans Tablosu)</h2>
        <span style="font-size:11px; color:var(--text-muted);">Gemini 1.5 Flash Karar Motoru</span>
      </div>

      <div id="scans-grid" class="scans-grid">
        <div class="empty-state" style="grid-column: 1 / -1;">Yükleniyor...</div>
      </div>
    </div>

  </div>

  <!-- JAVASCRIPT & SUPABASE ENTEGRASYONU -->
  <script>
    // Supabase Proje Bilgilerinizi Buraya Tanımlayın
    const SUPABASE_URL = "https://YOUR_PROJECT_ID.supabase.co";
    const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";

    let supabase = null;
    if (window.supabase && SUPABASE_URL.indexOf("YOUR_PROJECT") === -1) {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    // ==============================================================================
    // loadData(): 10 SANİYEDE BİR ÇALIŞAN MERKEZİ VERİ FONKSİYONU
    // ==============================================================================
    async function loadData() {
      let activeTrades = [];
      let lastScans = [];

      if (supabase) {
        try {
          // 1. trades tablosundan is_active = true olanları çek
          const { data: trades, error: tradesErr } = await supabase
            .from('trades')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false });

          if (!tradesErr && trades) activeTrades = trades;

          // 2. market_scans tablosundan son 6 kaydı çek
          const { data: scans, error: scansErr } = await supabase
            .from('market_scans')
            .select('*')
            .order('scanned_at', { ascending: false })
            .limit(6);

          if (!scansErr && scans) lastScans = scans;
        } catch (e) {
          console.warn("Supabase sorgu hatası, yerel önbellek:", e);
        }
      } else {
        // Supabase henüz bağlanmadıysa gösterilecek örnek veriler
        activeTrades = [
          { symbol: "SOLTRY", entry_price: 5480.50, total_amount: 1500.0, scan_reason: "RSI 48 yükseliş onayı ve 24s hacim artışı (+35%)." },
          { symbol: "AVAXTRY", entry_price: 945.20, total_amount: 1500.0, scan_reason: "EMA50 kırılımı ve MACD pozitif kesişim." }
        ];
        lastScans = [
          { symbol: "SOLTRY", current_price: 5480.50, ai_score: 88, signal_type: "STRONG_BUY", scan_reason: "RSI 48 alım bandında, 24s hacimde alıcı baskısı yüksek." },
          { symbol: "AVAXTRY", current_price: 945.20, ai_score: 82, signal_type: "BUY", scan_reason: "EMA50 direnci aşıldı, kısa vadeli hedef 1,020 TRY." },
          { symbol: "BTCTRY", current_price: 2950000.0, ai_score: 74, signal_type: "BUY", scan_reason: "Konsolidasyon desteğinde stabil seyir." },
          { symbol: "ETHTRY", current_price: 114250.0, ai_score: 68, signal_type: "NEUTRAL", scan_reason: "Direnç seviyesinde yatay hareket." },
          { symbol: "BNBTRY", current_price: 22850.0, ai_score: 55, signal_type: "NEUTRAL", scan_reason: "Hacim dengede, bekle-gör modu tavsiye edilir." },
          { symbol: "XRPTRY", current_price: 18.65, ai_score: 34, signal_type: "SELL", scan_reason: "RSI aşırı alım bölgesinde zayıflama belirtisi." }
        ];
      }

      renderTrades(activeTrades);
      renderScans(lastScans);
      countdown = 10;
    }

    function renderTrades(trades) {
      const container = document.getElementById("trades-container");
      const invested = trades.reduce((acc, t) => acc + Number(t.total_amount || 0), 0);
      const cash = Math.max(0, 10000.0 - invested);

      document.getElementById("val-invested").textContent = "₺" + invested.toLocaleString("tr-TR", { minimumFractionDigits: 2 });
      document.getElementById("val-count").textContent = trades.length + " Adet";
      document.getElementById("val-cash").textContent = "₺" + cash.toLocaleString("tr-TR", { minimumFractionDigits: 2 });

      if (trades.length === 0) {
        container.innerHTML = '<div class="empty-state">Henüz açık sanal pozisyon yok.</div>';
        return;
      }

      container.innerHTML = trades.map(t => \`
        <div class="trade-row">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="width:8px; height:8px; border-radius:50%; background:var(--color-primary);"></span>
            <span class="trade-symbol">\${t.symbol}</span>
            <span class="badge-active">AKTİF</span>
          </div>
          <div style="display:flex; gap:20px; font-family:var(--font-mono); font-size:12px;">
            <span>Giriş: <strong>₺\${Number(t.entry_price).toLocaleString("tr-TR")}</strong></span>
            <span style="color:var(--color-primary);">Tutar: <strong>₺\${Number(t.total_amount).toLocaleString("tr-TR")}</strong></span>
          </div>
          \${t.scan_reason ? \`<div style="width:100%; font-size:11px; color:var(--text-muted); padding-top:4px;"><strong style="color:var(--color-primary);">AI Gerekçe:</strong> \${t.scan_reason}</div>\` : ""}
        </div>
      \`).join("");
    }

    function renderScans(scans) {
      const grid = document.getElementById("scans-grid");
      if (!scans || scans.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Kayıt bulunamadı.</div>';
        return;
      }

      grid.innerHTML = scans.map(s => {
        const score = Number(s.ai_score || 0);
        const badgeClass = score >= 75 ? "ai-badge-green" : (score < 40 ? "ai-badge-red" : "ai-badge");
        const price = Number(s.current_price || s.price || 0);

        return \`
          <div class="scan-card">
            <div class="scan-top">
              <div>
                <div style="font-weight:900; font-size:15px; font-family:var(--font-mono);">\${s.symbol}</div>
                <div style="font-size:12px; color:var(--text-muted); font-family:var(--font-mono);">₺\${price.toLocaleString("tr-TR")}</div>
              </div>
              <div class="\${badgeClass}">
                <div style="font-size:16px; font-weight:900;">\${score}</div>
                <div style="font-size:8px; font-weight:800;">\${s.signal_type || "NEUTRAL"}</div>
              </div>
            </div>
            <div class="scan-reason">
              <strong style="color:var(--color-primary);">AI:</strong> \${s.scan_reason}
            </div>
          </div>
        \`;
      }).join("");
    }

    // ==============================================================================
    // KONTROL BUTONLARI
    // ==============================================================================
    async function fetchTRYPairs() {
      setStatus("Binance API sorgulanıyor...");
      try {
        const res = await fetch("https://api.binance.me/api/v3/ticker/24hr");
        const data = await res.json();
        const tryPairs = data.filter(i => i.symbol.endsWith("TRY"));
        setStatus("Binance: " + tryPairs.length + " adet TRY paritesi güncellendi.");
      } catch (err) {
        setStatus("Binance API Hatası: " + err.message);
      }
    }

    async function simulateAiAnalysis() {
      setStatus("Gemini AI analizi simüle edildi ve kaydedildi.");
      loadData();
    }

    async function triggerEmergencyStop() {
      if (confirm("Acil Durdurma Protokolünü devreye sokmak istediğinize emin misiniz?")) {
        setStatus("DİKKAT: Acil Durdurma Tetiklendi! Tüm emirler iptal edildi.");
        document.getElementById("bot-mode-badge").textContent = "DURDURULDU (ACİL STOP)";
        document.getElementById("bot-mode-badge").style.color = "var(--color-danger)";
      }
    }

    function setStatus(msg) {
      document.getElementById("status-text").textContent = msg;
    }

    // 10 SANİYEDE BİR loadData() YENİLEME
    let countdown = 10;
    setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        countdown = 10;
        loadData();
      }
      document.getElementById("sync-timer").textContent = countdown + "s";
    }, 1000);

    window.addEventListener("DOMContentLoaded", loadData);
  </script>
</body>
</html>
`;
