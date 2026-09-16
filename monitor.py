"""
==============================================================================
Hafif Pozisyon İzleme Scripti (monitor.py)
==============================================================================
trading_bot.py'nin tam tarama+alım döngüsü 10 dakikada bir çalışıyor. Bu
script SADECE açık pozisyonları stop-loss / trailing-stop kurallarına göre
izleyip kapatır — yeni alım YAPMAZ, Gemini'yi çağırmaz (maliyetsiz ve hızlı).

Amaç: iz süren stop gibi zamana duyarlı çıkışların, 10 dakikalık tarama
aralığı içinde oluşup geri dönen fiyat hareketleri yüzünden kaçırılmasını
önlemek — bunun için bu script çok daha sık (örn. 5 dakikada bir) ayrı bir
GitHub Actions workflow'u (.github/workflows/monitor.yml) ile çalıştırılır.

NOT: Bu dosya, repodaki orijinal monitor.py paylaşılmadığı için, repo
denetim raporunda tarif edilen akışa (bot config oku → emergency_stop
kontrolü → monitor_and_close_positions çağır) göre yeniden oluşturulmuştur.
Eğer gerçek monitor.py'niz farklı ek mantık içeriyorsa (örn. farklı
loglama, farklı hata yönetimi), bu dosyayı onun yerine kullanmadan önce
karşılaştırın.
==============================================================================
"""

from trading_bot import SupabaseRestClient, monitor_and_close_positions, SUPABASE_URL, SUPABASE_KEY, logger

if __name__ == "__main__":
    logger.info("=== HAFİF POZİSYON İZLEME BAŞLADI (monitor.py) ===")
    client = SupabaseRestClient(SUPABASE_URL, SUPABASE_KEY)
    config = client.get_bot_config()
    if config.get("emergency_stop", False):
        logger.warning("ACİL DURDURMA aktif, pozisyon izleme bu döngüde atlanıyor.")
    else:
        monitor_and_close_positions(client, config)
    logger.info("=== HAFİF POZİSYON İZLEME TAMAMLANDI ===")
