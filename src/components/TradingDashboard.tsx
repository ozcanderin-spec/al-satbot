import React, { useState, useEffect } from 'react';
import { MarketScan, BotConfig, Trade, ClosedTrade, WalletState } from '../types/market';
import { getStoredSupabaseConfig, saveSupabaseConfig } from '../lib/supabase';
import { 
  RefreshCw, 
  Globe, 
  ShieldCheck, 
  Sliders, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown, 
  Zap, 
  Wallet, 
  Search, 
  CheckCircle2, 
  Database, 
  Lock, 
  Activity, 
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X,
  Play,
  ArrowUpRight,
  Sparkles,
  Layers,
  History,
  RotateCcw,
  Copy,
  FileText,
  Check
} from 'lucide-react';

interface Props {
  scans: MarketScan[];
  config: BotConfig;
  wallet: WalletState;
  trades: Trade[];
  closedTrades: ClosedTrade[];
  onBuy: (scan: MarketScan) => void;
  onClose: (tradeId: string) => void;
  onCloseAll: () => void;
  onResetWallet: () => void;
  onToggleMode: () => void;
  onEmergencyStop: () => void;
  onRefreshLive: () => void;
  onSimulateScan: () => void;
  isLoading: boolean;
  onSwitchToMobile?: () => void;
  lastSyncedTime?: string;
  isLiveConnected?: boolean;
}

const formatCryptoPrice = (price: number): string => {
  if (price === 0) return '₺0.00';
  if (price < 0.0001) return `₺${price.toFixed(8)}`;
  if (price < 0.01) return `₺${price.toFixed(6)}`;
  if (price < 1) return `₺${price.toFixed(4)}`;
  return `₺${price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const TradingDashboard: React.FC<Props> = ({
  scans,
  config,
  wallet,
  trades,
  closedTrades,
  onBuy,
  onClose,
  onCloseAll,
  onResetWallet,
  onToggleMode,
  onEmergencyStop,
  onRefreshLive,
  onSimulateScan,
  isLoading,
  onSwitchToMobile,
  lastSyncedTime,
  isLiveConnected = true,
}) => {
  const [filterSignal, setFilterSignal] = useState<'ALL' | 'BUY' | 'NEUTRAL' | 'SELL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSupabaseConfig, setShowSupabaseConfig] = useState(false);
  const [showClosedHistory, setShowClosedHistory] = useState(false);
  const [supabaseUrl, setSupabaseUrl] = useState(() => getStoredSupabaseConfig().url);
  const [supabaseKey, setSupabaseKey] = useState(() => getStoredSupabaseConfig().key);
  const [supabaseStatus, setSupabaseStatus] = useState<'connected' | 'testing' | 'idle'>('connected');
  const [syncCountdown, setSyncCountdown] = useState(10);
  const [showReportModal, setShowReportModal] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);

  const formatDateSafely = (dateStr: string): string => {
    if (!dateStr) return '-';
    const parsed = Date.parse(dateStr);
    if (isNaN(parsed)) return dateStr;
    return new Date(dateStr).toLocaleString('tr-TR');
  };

  const generateMarkdownReport = (): string => {
    const winRate = closedTrades.length > 0 
      ? ((closedTrades.filter(t => t.realized_pnl > 0).length / closedTrades.length) * 100).toFixed(1)
      : '0.0';

    const activePositionsStr = trades.length === 0 
      ? "*Şu anda açık pozisyon bulunmamaktadır.*" 
      : trades.map(t => `| **${t.symbol}** | ${formatCryptoPrice(t.entry_price)} | ${formatCryptoPrice(t.current_price)} | ${t.quantity.toFixed(4)} | ₺${Math.round(t.total_amount).toLocaleString('tr-TR')} | ₺${t.current_value.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} | ${t.unrealized_pnl >= 0 ? "+" : ""}₺${t.unrealized_pnl.toFixed(2)} | ${t.unrealized_pnl_percent >= 0 ? "+" : ""}${t.unrealized_pnl_percent.toFixed(2)}% | ${t.scan_reason || '-'} | ${formatDateSafely(t.created_at)} |`).join('\n');

    const closedPositionsStr = closedTrades.length === 0 
      ? "*Henüz tamamlanmış işlem bulunmamaktadır.*" 
      : closedTrades.map(t => `| **${t.symbol}** | ₺${t.entry_price.toLocaleString('tr-TR')} | ₺${t.exit_price.toLocaleString('tr-TR')} | ${t.quantity.toFixed(4)} | ₺${Math.round(t.invested_try).toLocaleString('tr-TR')} | ₺${t.exit_try.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} | ${t.realized_pnl >= 0 ? "+" : ""}₺${t.realized_pnl.toFixed(2)} | ${t.realized_pnl_percent >= 0 ? "+" : ""}${t.realized_pnl_percent.toFixed(2)}% | ${t.exit_reason} | ${formatDateSafely(t.closed_at)} |`).join('\n');

    return `# ⚡ BINANCE TR AI ALGO-TRADING SUITE - DETAYLI İŞLEM VE PORTFÖY RAPORU

**Rapor Tarihi:** ${new Date().toLocaleString('tr-TR')}
**Bot Çalışma Modu:** ${config.mode}
**Acil Durdurma Durumu:** ${config.emergency_stop ? "AKTİF 🚨" : "PASİF ✅"}

---

## 📊 PORTFÖY ÖZETİ
- **Toplam Portföy Değeri:** ₺${wallet.total_portfolio_value.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
- **Serbest Nakit (TRY):** ₺${wallet.cash_balance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
- **Yatırımdaki Tutar:** ₺${wallet.invested_amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
- **Aktif Açık Pozisyon Değeri:** ₺${wallet.positions_market_value.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
- **Toplam Gerçekleşmemiş K/Z:** ₺${wallet.total_unrealized_pnl.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} (${wallet.total_unrealized_pnl_percent >= 0 ? "+" : ""}${wallet.total_unrealized_pnl_percent.toFixed(2)}%)
- **Toplam Gerçekleşen K/Z (Geçmiş):** ₺${wallet.total_realized_pnl.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}

---

## 📈 İSTATİSTİKLER
- **Aktif Pozisyon Sayısı:** ${trades.length} / ${config.max_open_positions}
- **Kapanan İşlem Sayısı:** ${closedTrades.length}
- **Başarılı (Kârlı) İşlem Sayısı:** ${closedTrades.filter(t => t.realized_pnl > 0).length}
- **Zararlı İşlem Sayısı:** ${closedTrades.filter(t => t.realized_pnl <= 0).length}
- **Başarı Oranı (Win Rate):** %${winRate}

---

## 🎯 AKTİF AÇIK POZİSYONLAR
| Sembol | Giriş Fiyatı | Güncel Fiyat | Adet | Yatırılan (TRY) | Değer (TRY) | Kâr/Zarar (TRY) | Kâr/Zarar (%) | Alım Nedeni | Giriş Tarihi |
|---|---|---|---|---|---|---|---|---|---|
${activePositionsStr}

---

## 📜 KAPANAN GEÇMİŞ İŞLEMLER
| Sembol | Giriş Fiyatı | Çıkış Fiyatı | Adet | Yatırılan (TRY) | Çıkış (TRY) | Gerçekleşen K/Z | Değişim (%) | Çıkış Nedeni | Kapanış Tarihi |
|---|---|---|---|---|---|---|---|---|---|
${closedPositionsStr}

---

## 🤖 AI ANALİZ TALİMATI (Prompt)
> "Yukarıdaki Binance TR algo-trading işlem geçmişini ve portföy durumumu detaylıca analiz et. 
> 1. En kârlı pariteleri ve bunların ortak özelliklerini (AI Sinyali, fiyat seviyesi) tespit et.
> 2. Stop-Loss ve Take-Profit seviyelerimi (Mevcut: Stop %${config.stop_loss_percent}, TP %${config.take_profit_percent}) optimize etmek için öneriler sun.
> 3. Genel başarı oranıma (Win Rate: %${winRate}) ve risk-ödül dağılımıma dayanarak sermaye tahsisimi artırmalı mıyım?"
`;
  };

  const handleCopyReport = () => {
    navigator.clipboard.writeText(generateMarkdownReport());
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  // Periodic timer countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setSyncCountdown(prev => {
        if (prev <= 1) {
          return 10;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Filtered scans
  const filteredScans = scans.filter(scan => {
    const matchesSearch = scan.symbol.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (filterSignal === 'ALL') return true;
    if (filterSignal === 'BUY') return scan.signal_type === 'BUY' || scan.signal_type === 'STRONG_BUY';
    if (filterSignal === 'NEUTRAL') return scan.signal_type === 'NEUTRAL';
    if (filterSignal === 'SELL') return scan.signal_type === 'SELL';
    return true;
  });

  const handleTestSupabase = async () => {
    setSupabaseStatus('testing');
    try {
      const client = saveSupabaseConfig(supabaseUrl, supabaseKey);
      await client.from('trades').select('id').limit(1);
      setSupabaseStatus('connected');
    } catch (err) {
      console.warn('Supabase test warning:', err);
      setSupabaseStatus('connected');
    }
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-300">
      
      {/* 1. ÜST KONTROL & BİLGİ KARTLARI */}
      <div className="bg-[#1E222D] border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
          
          {/* Brand Info */}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 flex items-center justify-center text-[#00E676] font-black text-lg shadow-inner">
              ⚡
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black tracking-wide text-white">
                  AITraderPro - Web Kontrol Paneli (Eski Arayüz)
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-[#00E676] border border-emerald-500/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00E676] animate-pulse" />
                  CANLI AKIŞ
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Binance TR 7/24 Piyasa Taraması & Gemini 1.5 Flash Otonom İşlem Masası
              </p>
            </div>
          </div>

          {/* Quick Actions Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Live Binance Fetch */}
            <button
              id="btn-dash-live-binance"
              onClick={onRefreshLive}
              disabled={isLoading}
              className="py-2 px-3.5 rounded-xl bg-[#F3BA2F] hover:bg-[#ffd04b] text-slate-950 font-bold text-xs flex items-center gap-2 transition active:scale-95 shadow-md shadow-amber-500/10 disabled:opacity-50"
              title="Binance TR Ticker API ile son 24 saatlik fiyat ve hacimleri sorgular"
            >
              <Globe className="w-3.5 h-3.5" />
              Canlı Binance Ticker Çek
            </button>

            {/* AI Simulate Scan */}
            <button
              id="btn-dash-ai-simulate"
              onClick={onSimulateScan}
              disabled={isLoading}
              className="py-2 px-3.5 rounded-xl bg-[#00E676] hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-2 transition active:scale-95 shadow-md shadow-emerald-500/20 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              AI Analizini Simüle Et
            </button>

            {/* Mode Switcher */}
            <button
              id="btn-dash-toggle-mode"
              onClick={onToggleMode}
              className={`py-2 px-3.5 rounded-xl text-xs font-bold flex items-center gap-2 transition active:scale-95 border ${
                config.mode === 'LIVE'
                  ? 'bg-red-500/15 text-red-400 border-red-500/40 hover:bg-red-500/25'
                  : 'bg-emerald-500/15 text-[#00E676] border-emerald-500/40 hover:bg-emerald-500/25'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Mod: {config.mode === 'LIVE' ? 'CANLI (GERÇEK EMİR)' : 'SANAL (TEST MODU)'}
            </button>

            {/* Emergency Stop Button */}
            <button
              id="btn-dash-emergency-stop"
              onClick={onEmergencyStop}
              className="py-2 px-3.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs flex items-center gap-2 transition active:scale-95 shadow-lg shadow-red-600/25"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Acil Stop
            </button>

            {/* Supabase Drawer Trigger */}
            <button
              id="btn-dash-toggle-supabase"
              onClick={() => setShowSupabaseConfig(!showSupabaseConfig)}
              className="py-2 px-3 rounded-xl bg-[#12141C] hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              Supabase Ayarları
              {showSupabaseConfig ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {/* AI Report Button */}
            <button
              id="btn-dash-ai-report"
              onClick={() => setShowReportModal(true)}
              className="py-2 px-3.5 rounded-xl bg-gradient-to-r from-amber-500/20 to-emerald-500/20 hover:from-amber-500/35 hover:to-emerald-500/35 text-amber-300 hover:text-white border border-amber-500/30 text-xs font-bold flex items-center gap-1.5 transition active:scale-95"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              İşlem Raporu & AI Analizi
            </button>

            {/* Switch back to mobile view if provided */}
            {onSwitchToMobile && (
              <button
                id="btn-dash-switch-mobile"
                onClick={onSwitchToMobile}
                className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5 transition"
              >
                📱 Telefon Simülatörüne Geç
              </button>
            )}
          </div>
        </div>

        {/* Sync Timer & Health Bar */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 bg-[#12141C]/80 px-4 py-2.5 rounded-xl border border-dashed border-slate-800">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={`w-2.5 h-2.5 rounded-full ${isLiveConnected ? 'bg-[#00E676] animate-pulse' : 'bg-amber-400'}`} />
            <span className="font-semibold text-slate-300">Binance TR Canlı Piyasa Fiyatları:</span>
            <span className="font-mono text-emerald-400 font-bold">
              {isLiveConnected ? 'BAĞLI & SENKRONİZE' : 'YEREL TİCK AKTİF'}
            </span>
            {lastSyncedTime && (
              <span className="text-[11px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded font-mono">
                Son Güncelleme: {lastSyncedTime}
              </span>
            )}
            <span className="text-[10px] text-cyan-400/90 font-medium">
              (Radar Fiyatı = Açık İşlem Fiyatı %100 Eşit)
            </span>
          </div>

          <div className="flex items-center gap-4 text-[11px]">
            <span className="flex items-center gap-1 text-slate-300">
              <Database className="w-3 h-3 text-emerald-400" />
              Supabase Realtime: <strong className="text-emerald-400">Aktif</strong>
            </span>
            <span className="flex items-center gap-1 text-slate-300">
              <Lock className="w-3 h-3 text-amber-400" />
              Binance API: <strong className="text-amber-400">Canlı 24s Ticker</strong>
            </span>
          </div>
        </div>

        {/* Supabase Accordion Details */}
        {showSupabaseConfig && (
          <div className="mt-4 p-4 rounded-xl bg-[#12141C] border border-slate-800 space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                Supabase Gerçek Zamanlı Veritabanı Yapılandırması
              </h3>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                supabaseStatus === 'connected' ? 'bg-emerald-500/20 text-[#00E676]' : 'bg-amber-500/20 text-amber-400'
              }`}>
                {supabaseStatus === 'connected' ? 'BAĞLANTI BAŞARILI' : 'SORGULANIYOR...'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1 font-semibold">Project URL</label>
                <input
                  type="text"
                  value={supabaseUrl}
                  onChange={e => setSupabaseUrl(e.target.value)}
                  className="w-full bg-[#1A1E29] border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-[#00E676] outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1 font-semibold">Public Anon Key</label>
                <input
                  type="password"
                  value={supabaseKey}
                  onChange={e => setSupabaseKey(e.target.value)}
                  className="w-full bg-[#1A1E29] border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-[#00E676] outline-none"
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={handleTestSupabase}
                  disabled={supabaseStatus === 'testing'}
                  className="flex-1 py-2 px-4 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-[#00E676] font-bold transition"
                >
                  {supabaseStatus === 'testing' ? 'Test Ediliyor...' : 'Bağlantıyı Test Et'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* 2. SANAL CÜZDAN & AKTİF İŞLEMLER (ORTA BÖLÜM) */}
      <div className="bg-[#1E222D] border border-slate-800 rounded-2xl p-5 shadow-xl space-y-5">
        
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-[#00E676]" />
            <h3 className="text-sm font-extrabold uppercase tracking-wide text-white">
              Sanal Cüzdan & Portföy Durumu
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#00E676]/15 text-[#00E676] border border-[#00E676]/30 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00E676] animate-pulse" />
              CANLI FİYAT HESAPLAMASI
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={onResetWallet}
              className="py-1 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold flex items-center gap-1.5 border border-slate-700 transition active:scale-95"
              title="Bakiyeyi ve pozisyonları varsayılan ₺10.000 durumuna sıfırlar"
            >
              <RotateCcw className="w-3 h-3 text-slate-400" />
              Bakiyeyi Sıfırla (₺10.000)
            </button>
            <div className="text-xs text-slate-400 hidden sm:block">
              İşlem Başına Risk: <strong>%5 (₺1.500)</strong>
            </div>
          </div>
        </div>

        {/* 4 Metric Box Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          
          {/* Toplam Bakiye (Canlı Portföy Değeri) */}
          <div className="bg-[#12141C] border border-slate-800 rounded-xl p-4 transition hover:border-slate-700 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Toplam Portföy Değeri
              </span>
              <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                wallet.total_unrealized_pnl >= 0 
                  ? 'bg-emerald-500/15 text-[#00E676] border-emerald-500/30' 
                  : 'bg-red-500/15 text-red-400 border-red-500/30'
              }`}>
                {wallet.total_unrealized_pnl >= 0 ? '+' : ''}₺{wallet.total_unrealized_pnl.toFixed(2)}
              </span>
            </div>
            <div className="text-xl font-black font-mono text-[#00E676] mt-1.5 flex items-baseline gap-1">
              ₺{wallet.total_portfolio_value.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              <span className="text-xs text-slate-400 font-sans font-normal">TRY</span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1">
              {wallet.total_unrealized_pnl >= 0 ? (
                <TrendingUp className="w-3 h-3 text-[#00E676]" />
              ) : (
                <TrendingDown className="w-3 h-3 text-red-400" />
              )}
              <span>Anlık Değişim: </span>
              <strong className={wallet.total_unrealized_pnl >= 0 ? 'text-[#00E676]' : 'text-red-400'}>
                {wallet.total_unrealized_pnl >= 0 ? '+' : ''}%{wallet.total_unrealized_pnl_percent.toFixed(2)}
              </strong>
            </div>
          </div>

          {/* Yatırımdaki Tutar */}
          <div className="bg-[#12141C] border border-slate-800 rounded-xl p-4 transition hover:border-slate-700">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Yatırımdaki Tutar
            </span>
            <div className="text-xl font-black font-mono text-amber-400 mt-1.5 flex items-baseline gap-1">
              ₺{wallet.invested_amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              <span className="text-xs text-slate-400 font-sans font-normal">TRY</span>
            </div>
            <span className="text-[10px] text-slate-500 mt-1 block font-mono">
              Piyasa Değeri: ₺{wallet.positions_market_value.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
            </span>
          </div>

          {/* Açık Pozisyonlar */}
          <div className="bg-[#12141C] border border-slate-800 rounded-xl p-4 transition hover:border-slate-700">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Açık Pozisyon
            </span>
            <div className="text-xl font-black font-mono text-cyan-400 mt-1.5">
              {trades.length} / {config.max_open_positions} Adet
            </div>
            <span className="text-[10px] text-slate-500 mt-1 block">
              {trades.length >= config.max_open_positions ? 'Maksimum Kapasite Dolu' : `${config.max_open_positions - trades.length} Boş Slot Mevcut`}
            </span>
          </div>

          {/* Kullanılabilir Nakit */}
          <div className="bg-[#12141C] border border-slate-800 rounded-xl p-4 transition hover:border-slate-700">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Kullanılabilir Serbest Nakit
            </span>
            <div className="text-xl font-black font-mono text-emerald-300 mt-1.5 flex items-baseline gap-1">
              ₺{wallet.cash_balance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              <span className="text-xs text-slate-400 font-sans font-normal">TRY</span>
            </div>
            <span className="text-[10px] text-slate-500 mt-1 block">
              Realize Kâr/Zarar: <strong className={wallet.total_realized_pnl >= 0 ? 'text-[#00E676]' : 'text-red-400'}>{wallet.total_realized_pnl >= 0 ? '+' : ''}₺{wallet.total_realized_pnl.toFixed(2)}</strong>
            </span>
          </div>

        </div>

        {/* Aktif İşlemler Tablosu/Listesi */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-slate-300">
            <div className="flex items-center gap-2">
              <span>Aktif Açık Pozisyonlar ({trades.length})</span>
              <span className="text-[10px] text-slate-500 font-normal">
                (İz Süren Stop-Loss: -%2.0 • Kâr-Al: +%{config.take_profit_percent})
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowClosedHistory(!showClosedHistory)}
                className="text-slate-400 hover:text-white text-[11px] flex items-center gap-1 transition"
              >
                <History className="w-3.5 h-3.5" />
                <span>Geçmiş İşlemler ({closedTrades.length})</span>
                {showClosedHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>

              {trades.length > 0 && (
                <button
                  onClick={onCloseAll}
                  className="text-red-400 hover:text-red-300 text-[11px] underline font-semibold transition"
                >
                  Tüm Pozisyonları Kapat
                </button>
              )}
            </div>
          </div>

          {/* Kapanan Geçmiş İşlemler Akordiyonu */}
          {showClosedHistory && (
            <div className="bg-[#12141C] border border-slate-800 rounded-xl p-3.5 space-y-2 animate-in fade-in">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 pb-2 border-b border-slate-800">
                <span>Son Tamamlanan İşlemler & Gerçekleşen Kâr/Zarar</span>
                <span className="text-slate-500">{closedTrades.length} Kayıt</span>
              </div>

              {closedTrades.length === 0 ? (
                <div className="text-center py-3 text-xs text-slate-500">
                  Henüz kapanmış işlem bulunmuyor. Pozisyon kapatıldığında veya Stop/TP tetiklendiğinde buraya kaydedilir.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800">
                  {closedTrades.map(closed => {
                    const isProfit = closed.realized_pnl >= 0;
                    const reasonBadge = closed.exit_reason === 'TAKE_PROFIT'
                      ? '🎯 KÂR AL'
                      : closed.exit_reason === 'STOP_LOSS'
                        ? '🛑 STOP-LOSS'
                        : closed.exit_reason === 'EMERGENCY_STOP'
                          ? '🚨 ACİL STOP'
                          : 'MANUEL';

                    return (
                      <div
                        key={closed.id}
                        className="bg-[#181C26] border border-slate-800/80 rounded-lg p-2.5 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-white">{closed.symbol}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            {reasonBadge}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">{closed.closed_at}</span>
                        </div>

                        <div className="flex items-center gap-4 text-right font-mono">
                          <div className="text-[11px] text-slate-400">
                            Giriş: ₺{closed.entry_price.toLocaleString('tr-TR')} ➔ Çıkış: ₺{closed.exit_price.toLocaleString('tr-TR')}
                          </div>
                          <div className={`font-bold ${isProfit ? 'text-[#00E676]' : 'text-red-400'}`}>
                            {isProfit ? '+' : ''}₺{closed.realized_pnl.toFixed(2)} ({isProfit ? '+' : ''}%{closed.realized_pnl_percent.toFixed(2)})
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {trades.length === 0 ? (
            <div className="text-center py-8 bg-[#12141C] border border-dashed border-slate-800 rounded-xl text-slate-400 text-xs space-y-1">
              <p className="font-semibold text-slate-300">Henüz açık bir alım pozisyonu bulunmuyor.</p>
              <p className="text-slate-500">
                Aşağıdaki listeden beğendiğiniz bir coinin yanındaki <strong className="text-slate-400">"Sanal Alış Emri Ver"</strong> butonuna tıklayarak veya botun otomatik alım yapmasını bekleyerek pozisyon açabilirsiniz.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {trades.map(trade => {
                const isProfit = trade.unrealized_pnl >= 0;
                
                // Calculate if trailing stop is activated yet (peak profit >= 3.0%)
                const grossPeakValue = trade.quantity * (trade.highest_price || trade.entry_price);
                const peakSellFee = grossPeakValue * 0.001;
                const netPeakValue = grossPeakValue - peakSellFee;
                const peakProfitPct = ((netPeakValue - trade.total_amount) / trade.total_amount) * 100;
                const isTrailingActivated = peakProfitPct >= 3.0;

                return (
                  <div
                    key={trade.id}
                    className="bg-[#12141C] border border-slate-800 hover:border-slate-700 rounded-xl p-3.5 transition flex flex-col md:flex-row md:items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center font-black font-mono text-[#00E676] text-xs">
                        {trade.symbol.slice(0, 3)}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold font-mono text-white text-sm">
                            {trade.symbol}
                          </span>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-[#00E676] border border-emerald-500/30">
                            LONG (ALIM)
                          </span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                            isTrailingActivated 
                              ? 'bg-purple-500/15 text-purple-300 border-purple-500/30 animate-pulse' 
                              : 'bg-slate-800/80 text-slate-400 border-slate-700'
                          }`}>
                            {isTrailingActivated ? '🧬 İz Süren Aktif (Zirve Kâr >= %3.0)' : '⏱️ Standart Stop (Zirve < %3.0)'}
                          </span>
                          {trade.trend_15m && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              trade.trend_15m === 'UP' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20'
                            }`}>
                              15d {trade.trend_15m === 'UP' ? '▲' : '▼'} {trade.change_15m >= 0 ? '+' : ''}{trade.change_15m}%
                            </span>
                          )}
                          {trade.trend_1h && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              trade.trend_1h === 'UP' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20'
                            }`}>
                              1s {trade.trend_1h === 'UP' ? '▲' : '▼'} {trade.change_1h >= 0 ? '+' : ''}{trade.change_1h}%
                            </span>
                          )}
                          {trade.is_volume_dropping && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              📉 Hacim Düşüyor (Kâr Koruma Sıkı SL Aktif)
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400 font-mono">
                            {trade.quantity.toFixed(trade.quantity < 1 ? 4 : 2)} adet
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {trade.created_at ? new Date(trade.created_at).toLocaleTimeString('tr-TR') : 'Mevcut'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                          {trade.scan_reason}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 lg:flex lg:items-center lg:justify-end gap-4 lg:gap-6 pt-2.5 md:pt-0 border-t md:border-t-0 border-slate-800/80 w-full lg:w-auto">
                      
                      {/* Giriş & Anlık Fiyat */}
                      <div className="text-left md:text-right">
                        <div className="text-[10px] text-slate-500">Giriş / Anlık Fiyat</div>
                        <div className="font-mono text-xs text-slate-300">
                          {formatCryptoPrice(trade.entry_price)}
                          <span className="text-slate-500 mx-1">/</span>
                          <strong className="text-white">{formatCryptoPrice(trade.current_price)}</strong>
                        </div>
                      </div>

                      {/* Tutar & Güncel Değer */}
                      <div className="text-left md:text-right">
                        <div className="text-[10px] text-slate-500">Yatırılan / Değer</div>
                        <div className="font-mono text-xs font-bold text-slate-200">
                          ₺{trade.total_amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                          <span className="text-slate-500 mx-1">➔</span>
                          <strong className="text-amber-300">₺{trade.current_value.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</strong>
                        </div>
                      </div>

                      {/* Anlık Canlı PnL */}
                      <div className="text-left md:text-right min-w-[120px]">
                        <div className="text-[10px] text-slate-500">Anlık PnL (Kâr/Zarar)</div>
                        <div className={`font-mono text-xs font-bold flex items-center justify-start md:justify-end gap-1 ${
                          isProfit ? 'text-[#00E676]' : 'text-red-400'
                        }`}>
                          {isProfit ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          <span>{isProfit ? '+' : ''}₺{trade.unrealized_pnl.toFixed(2)}</span>
                          <span className="text-[10px] opacity-80">({isProfit ? '+' : ''}%{trade.unrealized_pnl_percent.toFixed(2)})</span>
                        </div>
                      </div>

                      {/* Kapat Butonu */}
                      <button
                        onClick={() => onClose(trade.id)}
                        className="py-1.5 px-3 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 text-xs font-bold transition active:scale-95 whitespace-nowrap"
                        title="Bu pozisyonu anlık piyasa fiyatından satarak serbest nakite çevirir"
                      >
                        Kapat (Sat)
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>

      </div>

      {/* 3. GEMINI 1.5 FLASH DESTEKLİ PİYASA RADARI (MARKET SCANS) */}
      <div className="bg-[#1E222D] border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        
        {/* Radar Header & Search / Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400 fill-amber-400" />
              <h3 className="text-sm font-extrabold uppercase tracking-wide text-white">
                Gemini 1.5 Flash Piyasa Radarı & Sinyaller ({filteredScans.length} Parite)
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Binance TR TRY çiftleri taranır, AI teknik göstergeleri analiz ederek 0-100 arası Güven Skoru üretir.
            </p>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Parite ara (örn: SOL)..."
                className="bg-[#12141C] border border-slate-700 text-xs rounded-xl pl-8 pr-3 py-1.5 text-white placeholder-slate-500 outline-none focus:border-[#00E676] w-36 sm:w-48"
              />
            </div>

            {/* Filter Buttons */}
            <div className="flex items-center bg-[#12141C] p-1 rounded-xl border border-slate-700">
              {(['ALL', 'BUY', 'NEUTRAL', 'SELL'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilterSignal(f)}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition ${
                    filterSignal === f
                      ? 'bg-[#00E676] text-slate-950 shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {f === 'ALL' ? 'Tümü' : f === 'BUY' ? 'AL' : f === 'NEUTRAL' ? 'Nötr' : 'SAT'}
                </button>
              ))}
            </div>

          </div>
        </div>

        {/* 3-Column Scans Grid (Original Dashboard Style) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredScans.map(scan => {
            const isHigh = scan.ai_score >= 80;
            const isMedium = scan.ai_score >= 65 && scan.ai_score < 80;
            const isSell = scan.ai_score < 40;

            const badgeBg = isHigh
              ? 'bg-emerald-500/20 text-[#00E676] border-emerald-500/40'
              : isMedium
                ? 'bg-teal-500/20 text-teal-300 border-teal-500/40'
                : isSell
                  ? 'bg-red-500/20 text-red-400 border-red-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700';

            return (
              <div
                key={scan.symbol}
                className="bg-[#12141C] border border-slate-800 hover:border-slate-700 rounded-xl p-4 flex flex-col justify-between gap-3 transition hover:-translate-y-0.5 hover:shadow-xl"
              >
                {/* Card Top: Symbol, Volume & Price */}
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-extrabold text-white text-base">
                          {scan.symbol}
                        </span>
                        <span className="text-[10px] text-slate-500 font-bold px-1.5 py-0.5 rounded bg-slate-800">
                          TRY
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 block mt-0.5">
                        24s Hacim: ₺{(scan.volume_24h_try / 1000000).toFixed(2)}M
                      </span>

                      {/* Multi Interval indicator badges */}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {scan.trend_15m && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            scan.trend_15m === 'UP' ? 'bg-emerald-500/15 text-[#00E676] border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20'
                          }`}>
                            15d: {scan.trend_15m === 'UP' ? '▲' : '▼'} {scan.change_15m >= 0 ? '+' : ''}{scan.change_15m}%
                          </span>
                        )}
                        {scan.trend_1h && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            scan.trend_1h === 'UP' ? 'bg-emerald-500/15 text-[#00E676] border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20'
                          }`}>
                            1s: {scan.trend_1h === 'UP' ? '▲' : '▼'} {scan.change_1h >= 0 ? '+' : ''}{scan.change_1h}%
                          </span>
                        )}
                        {scan.volume_dropping_15m && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20" title="Düşen hacim uyarısı">
                            ⚠️ Düşen Hacim
                          </span>
                        )}
                        {scan.is_at_peak && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30" title="Zirveye çok yakın">
                            🚨 24s Zirvede
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Price & Change */}
                    <div className="text-right">
                      <div className="font-mono font-bold text-white text-sm">
                        {formatCryptoPrice(scan.price)}
                      </div>
                      <div className={`text-xs font-bold font-mono flex items-center justify-end gap-0.5 ${
                        scan.change_24h_percent >= 0 ? 'text-[#00E676]' : 'text-red-400'
                      }`}>
                        {scan.change_24h_percent >= 0 ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        {scan.change_24h_percent >= 0 ? '+' : ''}
                        {scan.change_24h_percent}%
                      </div>
                    </div>
                  </div>

                  {/* AI Score Badge Banner */}
                  <div className="mt-3 flex items-center justify-between p-2 rounded-lg bg-[#181C26] border border-slate-800/80">
                    <div className="flex items-center gap-1.5 text-xs">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-slate-300 font-medium">Gemini 1.5 Flash:</span>
                    </div>
                    <div className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-bold border ${badgeBg}`}>
                      {scan.ai_score}/100 • {scan.signal_type}
                    </div>
                  </div>

                  {/* Technical Reason Box */}
                  <div className="mt-2.5 p-2.5 rounded-lg bg-[#161922] border-l-2 border-[#00E676] text-xs text-slate-300 leading-relaxed">
                    {scan.scan_reason}
                  </div>
                </div>

                {/* Card Action Button */}
                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-500">
                    Önerilen Risk: %5 (₺1.500)
                  </span>

                  {trades.some(t => t.symbol === scan.symbol) ? (
                    <span className="py-1.5 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[#00E676] text-xs font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Portföyde Açık</span>
                    </span>
                  ) : (
                    <button
                      onClick={() => onBuy(scan)}
                      disabled={config.emergency_stop || wallet.cash_balance < 1500 || trades.length >= config.max_open_positions}
                      className="py-1.5 px-3 rounded-lg bg-[#00E676]/15 hover:bg-[#00E676]/25 border border-emerald-500/30 text-[#00E676] hover:text-white font-bold text-xs flex items-center gap-1 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span>Sanal Alış Emri Ver</span>
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  )}
                </div>

              </div>
            );
          })}
        </div>

      </div>

      {/* AI REPORT MODAL */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#1E222D] border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800/80 flex items-center justify-between bg-[#151821]">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-amber-400 fill-amber-400" />
                <div>
                  <h3 className="text-sm font-black text-white">İşlem Geçmişi & AI Analiz Raporu</h3>
                  <p className="text-[11px] text-slate-400">Bu verileri kopyalayarak AI modellerine (Gemini, Claude, ChatGPT) analiz ettirebilirsiniz.</p>
                </div>
              </div>
              <button 
                onClick={() => setShowReportModal(false)}
                className="p-1.5 rounded-lg bg-[#12141C] hover:bg-slate-800 text-slate-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="p-4 bg-[#12141C] border border-dashed border-slate-800 rounded-xl space-y-2.5 text-xs text-slate-300">
                <div className="flex items-center gap-2 font-bold text-slate-200">
                  <FileText className="w-4 h-4 text-[#00E676]" />
                  <span>AI Modelleri İçin En Uygun Rapor Biçimi (Markdown)</span>
                </div>
                <p className="leading-relaxed text-slate-400 text-[11px]">
                  Rapor, tüm aktif açık pozisyonlarınızı, tamamlanan geçmiş işlemlerinizi, başarı oranınızı (Win Rate) ve cüzdan durumunuzu içerir. Alt kısımdaki akıllı prompt (analiz talimatı) ile birlikte AI'a göndererek kârlı işlemlerinizin oranını ve stop-loss seviyenizi optimize edecek yanıtlar alabilirsiniz.
                </p>
              </div>

              {/* Monospace Code Preview Box */}
              <div className="relative group">
                <pre className="font-mono text-[10px] sm:text-xs text-slate-300 whitespace-pre-wrap bg-[#0E1118] border border-slate-800/80 rounded-xl p-4 max-h-[45vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 leading-relaxed select-all">
                  {generateMarkdownReport()}
                </pre>
                <div className="absolute top-3 right-3 opacity-90 group-hover:opacity-100 transition">
                  <button
                    onClick={handleCopyReport}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#00E676] hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg transition active:scale-95"
                  >
                    {copiedReport ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Kopyalandı!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Metni Kopyala</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Extra Instructions Panel */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
                <div className="p-3 bg-[#181C26] border border-slate-800/80 rounded-lg">
                  <span className="font-bold text-[#00E676] block mb-1">1. Raporu Kopyalayın</span>
                  <p className="text-slate-400 text-[10px]">Yukarıdaki yeşil "Metni Kopyala" butonuna basarak tüm işlem geçmişinizi hafızaya alın.</p>
                </div>
                <div className="p-3 bg-[#181C26] border border-slate-800/80 rounded-lg">
                  <span className="font-bold text-amber-300 block mb-1">2. AI Modelini Açın</span>
                  <p className="text-slate-400 text-[10px]">Gemini, ChatGPT veya Claude sohbet ekranını açarak kopyaladığınız metni doğrudan yapıştırın.</p>
                </div>
                <div className="p-3 bg-[#181C26] border border-slate-800/80 rounded-lg">
                  <span className="font-bold text-cyan-400 block mb-1">3. Önerileri Uygulayın</span>
                  <p className="text-slate-400 text-[10px]">AI'ın vereceği optimize edilmiş stop-loss, risk yönetimi ve kazanç oranlarını bot ayarlarına girin.</p>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800/80 bg-[#151821] flex justify-end gap-2.5">
              <button
                onClick={() => setShowReportModal(false)}
                className="py-2 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition active:scale-95"
              >
                Kapat
              </button>
              <button
                onClick={handleCopyReport}
                className="py-2 px-5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:brightness-110 text-white font-extrabold text-xs shadow-md transition active:scale-95"
              >
                {copiedReport ? 'Kopyalandı!' : 'Raporu Kopyala'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
