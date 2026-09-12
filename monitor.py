"""
==============================================================================
POZİSYON İZLEME (Hafif, Sık Çalışan Script)
==============================================================================
trading_bot.py'nin tam tarama+alım döngüsü 10 dakikada bir çalışıyor.
Ama stop-loss/iz süren stop kararlarının daha hızlı tepki vermesi için,
bu script SADECE pozisyon izleme/kapatma kısmını daha sık (5 dakikada bir)
çalıştırır. Yeni alım yapmaz, sadece mevcut pozisyonları kontrol eder.

Not: Gerçek "30 saniyede bir" izleme, sürekli çalışan bir sunucu gerektirir;
GitHub Actions'ın ücretsiz katmanında pratik minimum ~5 dakikadır. Tarayıcı
açıkken zaten çok daha sık (birkaç saniyede bir) izleme yapılıyor; bu script
sadece tarayıcı kapalıyken de makul bir tepki hızı sağlamak içindir.
==============================================================================
"""

from trading_bot import SupabaseRestClient, fetch_all_try_data, monitor_and_close_positions, logger, SUPABASE_URL, SUPABASE_KEY

if __name__ == "__main__":
    logger.info("=== HAFİF POZİSYON İZLEME BAŞLIYOR ===")
    client = SupabaseRestClient(SUPABASE_URL, SUPABASE_KEY)
    try:
        config = client.get_bot_config()
        if config.get("emergency_stop"):
            logger.warning("ACİL DURDURMA aktif, izleme yine de yapılıyor (kapatma için).")

        df_all = fetch_all_try_data()
        if df_all.empty:
            logger.error("Binance verisi boş geldi, izleme atlanıyor.")
        else:
            price_lookup = dict(zip(df_all['symbol'], df_all['lastPrice']))
            monitor_and_close_positions(client, price_lookup, config)
    except Exception as e:
        logger.error(f"Beklenmeyen hata: {e}", exc_info=True)
        raise
