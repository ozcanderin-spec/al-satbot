import { MarketScan } from '../types/market';

export const INITIAL_MARKET_SCANS: MarketScan[] = [
  {
    symbol: 'SOLTRY',
    price: 5064.70,
    volume_24h_try: 151000000,
    change_24h_percent: 1.71,
    ai_score: 91,
    signal_type: 'STRONG_BUY',
    scan_reason: 'Binance TR: 5.000 TRY psikolojik eşiği üzerinde güçlü konsolidasyon ve EMA20 desteği onaylandı.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'BTCTRY',
    price: 3856539.00,
    volume_24h_try: 245700000,
    change_24h_percent: 1.66,
    ai_score: 88,
    signal_type: 'STRONG_BUY',
    scan_reason: 'Binance TR: 3.85M TRY seviyesinde istikrarlı kurumsal alım ve vadeli hacim desteği devam ediyor.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'ETHTRY',
    price: 121828.00,
    volume_24h_try: 354300000,
    change_24h_percent: 1.85,
    ai_score: 85,
    signal_type: 'STRONG_BUY',
    scan_reason: 'Binance TR: 120.000 TRY üzerinde kalıcılık sağlandı; RSI yükseliş trendini destekliyor.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'NEARTRY',
    price: 125.40,
    volume_24h_try: 91000000,
    change_24h_percent: 13.08,
    ai_score: 84,
    signal_type: 'STRONG_BUY',
    scan_reason: 'Binance TR: Günün en yüksek hacimli kırılımlarından biri; %13 prim ve pozitif momentum teyit edildi.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'DOTTRY',
    price: 56.70,
    volume_24h_try: 138600000,
    change_24h_percent: 9.67,
    ai_score: 82,
    signal_type: 'STRONG_BUY',
    scan_reason: 'Binance TR: 50 TRY direnci hacimle aşıldı, yukarı yönlü trend devam ediyor.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'AVAXTRY',
    price: 387.50,
    volume_24h_try: 103800000,
    change_24h_percent: -0.18,
    ai_score: 79,
    signal_type: 'BUY',
    scan_reason: 'Binance TR: 385 TRY taban seviyesinde güçlü alış emirleri toplanıyor, akümülasyon evresinde.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'XRPTRY',
    price: 69.51,
    volume_24h_try: 603200000,
    change_24h_percent: 2.58,
    ai_score: 77,
    signal_type: 'BUY',
    scan_reason: 'Binance TR: 600M+ TRY ile piyasanın en yüksek hacimli paritelerinden biri; alıcılar baskın.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'SUITRY',
    price: 39.55,
    volume_24h_try: 101400000,
    change_24h_percent: 0.79,
    ai_score: 75,
    signal_type: 'BUY',
    scan_reason: 'Binance TR: 39 TRY bandında sağlam destek oluşumu ve stabil hacim akışı.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'APTTRY',
    price: 32.80,
    volume_24h_try: 43600000,
    change_24h_percent: 5.81,
    ai_score: 73,
    signal_type: 'BUY',
    scan_reason: 'Binance TR: Düşen trend kırıldı, 30 TRY psikolojik desteği korundu.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'DOGETRY',
    price: 4.417,
    volume_24h_try: 101400000,
    change_24h_percent: 2.06,
    ai_score: 70,
    signal_type: 'BUY',
    scan_reason: 'Binance TR: Pozitif kapanışlar serisi; 4.30 TRY üzerinde alım hacmi artıyor.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'PEPETRY',
    price: 0.0001803,
    volume_24h_try: 174600000,
    change_24h_percent: 3.25,
    ai_score: 68,
    signal_type: 'BUY',
    scan_reason: 'Binance TR: 170M+ TRY işlem hacmiyle hareketlilik yüksek, kısa vadeli tepki alımları güçlü.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'BNBTRY',
    price: 36366.00,
    volume_24h_try: 30900000,
    change_24h_percent: 0.02,
    ai_score: 64,
    signal_type: 'NEUTRAL',
    scan_reason: 'Binance TR: 36.000 TRY bandında yatay denge, yön tayini için hacim genişlemesi bekleniyor.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'RENDERTRY',
    price: 74.50,
    volume_24h_try: 21800000,
    change_24h_percent: 1.92,
    ai_score: 61,
    signal_type: 'NEUTRAL',
    scan_reason: 'Binance TR: 70-75 TRY aralığında konsolidasyon devam ediyor.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'ADATRY',
    price: 10.70,
    volume_24h_try: 98500000,
    change_24h_percent: 1.04,
    ai_score: 59,
    signal_type: 'NEUTRAL',
    scan_reason: 'Binance TR: 10.50 TRY bandında destek bulma çabası sürüyor.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'INJTRY',
    price: 303.60,
    volume_24h_try: 121900000,
    change_24h_percent: 0.26,
    ai_score: 55,
    signal_type: 'NEUTRAL',
    scan_reason: 'Binance TR: 300 TRY psikolojik sınırında dar bantta hareket izleniyor.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'TRXTRY',
    price: 16.41,
    volume_24h_try: 46900000,
    change_24h_percent: -0.04,
    ai_score: 52,
    signal_type: 'NEUTRAL',
    scan_reason: 'Binance TR: Yatay seyir ve düşük oynaklık mevcut.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'FETTRY',
    price: 8.67,
    volume_24h_try: 58000000,
    change_24h_percent: -0.23,
    ai_score: 48,
    signal_type: 'NEUTRAL',
    scan_reason: 'Binance TR: Direnç bölgesinde kâr realizasyonları görülüyor.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'LINKTRY',
    price: 591.70,
    volume_24h_try: 20300000,
    change_24h_percent: -2.00,
    ai_score: 42,
    signal_type: 'SELL',
    scan_reason: 'Binance TR: 600 TRY altına sarkma gerçekleşti; kısa vadeli düzeltme baskısı.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'ARBTRY',
    price: 8.08,
    volume_24h_try: 138200000,
    change_24h_percent: -2.42,
    ai_score: 38,
    signal_type: 'SELL',
    scan_reason: 'Binance TR: Satış baskısı ve zayıflayan alıcı desteği; stop seviyeleri yaklaştı.',
    created_at: new Date().toISOString()
  },
  {
    symbol: 'TIATRY',
    price: 19.40,
    volume_24h_try: 60100000,
    change_24h_percent: -3.96,
    ai_score: 32,
    signal_type: 'SELL',
    scan_reason: 'Binance TR: %4 civarı düşüş trendi, destek altı kapanış riski.',
    created_at: new Date().toISOString()
  }
];
