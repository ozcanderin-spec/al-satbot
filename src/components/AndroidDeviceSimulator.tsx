import React, { useState } from 'react';
import { MarketScan, BotConfig, Trade, ClosedTrade, WalletState } from '../types/market';
import { 
  AlertTriangle, 
  RefreshCw, 
  ShieldCheck, 
  Wifi, 
  Battery, 
  Signal, 
  ChevronDown, 
  ChevronUp, 
  TrendingUp, 
  TrendingDown, 
  Zap, 
  CheckCircle2, 
  Wallet, 
  Compass, 
  Info,
  CircleDollarSign,
  History,
  RotateCcw,
  ArrowUpRight,
  Copy,
  FileText,
  Check,
  Sparkles,
  X
} from 'lucide-react';

interface Props {
  scans: MarketScan[];
  config: BotConfig;
  wallet: WalletState;
  trades: Trade[];
  closedTrades: ClosedTrade[];
  onToggleMode: () => void;
  onEmergencyStop: () => void;
  onRefresh: () => void;
  isLoading: boolean;
  onBuy: (scan: MarketScan) => void;
  onClose: (tradeId: string) => void;
  onCloseAll: () => void;
  onResetWallet: () => void;
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

export const AndroidDeviceSimulator: React.FC<Props> = ({
  scans,
  config,
  wallet,
  trades,
  closedTrades,
  onToggleMode,
  onEmergencyStop,
  onRefresh,
  isLoading,
  onBuy,
  onClose,
  onCloseAll,
  onResetWallet,
  lastSyncedTime,
  isLiveConnected = true,
}) => {
  const [activeTab, setActiveTab] = useState<'radar' | 'wallet'>('radar');
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [showClosedHistory, setShowClosedHistory] = useState(false);
  const [filterSignal, setFilterSignal] = useState<'ALL' | 'BUY' | 'NEUTRAL' | 'SELL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
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

  const filteredScans = scans
    .filter(scan => {
      if (filterSignal === 'BUY') return scan.signal_type.includes('BUY');
      if (filterSignal === 'NEUTRAL') return scan.signal_type === 'NEUTRAL';
      if (filterSignal === 'SELL') return scan.signal_type === 'SELL';
      return true;
    })
    .filter(scan => scan.symbol.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleConfirmEmergencyStop = () => {
    onCloseAll();
    onEmergencyStop();
    setShowEmergencyModal(false);
  };

  return (
    <div className="relative mx-auto w-full max-w-[420px] rounded-[42px] border-[10px] border-[#2A2E3D] bg-[#12141C] p-2 shadow-2xl shadow-black/80 ring-1 ring-white/10">
      {/* Device Speaker & Camera Notch */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-20">
        <div className="h-1.5 w-12 rounded-full bg-[#3A3F50]" />
        <div className="h-3 w-3 rounded-full bg-[#202432] ring-1 ring-[#3A3F50]" />
      </div>

      {/* Screen Frame */}
      <div className="relative flex flex-col h-[780px] overflow-hidden rounded-[32px] bg-[#12141C] text-white">
        
        {/* Android Status Bar */}
        <div className="flex items-center justify-between px-6 pt-3 pb-1 text-xs text-slate-400 select-none z-10 bg-[#1E222D]">
          <span className="font-semibold tracking-wider text-slate-200">12:30</span>
          <div className="flex items-center gap-2 text-slate-400">
            <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-400">5G</span>
            <Signal className="w-3.5 h-3.5" />
            <Wifi className="w-3.5 h-3.5" />
            <Battery className="w-4 h-4 text-slate-200" />
          </div>
        </div>

        {/* TopAppBar (Jetpack Compose dark style) */}
        <div className="bg-[#1E222D] px-4 py-3 border-b border-slate-800/80 flex items-center justify-between shadow-md">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black tracking-wider text-white">BINANCE TR</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                PRO ENGINE
              </span>
            </div>
            <p className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${isLiveConnected ? 'bg-[#00E676] animate-pulse' : 'bg-amber-400'}`} />
              <span className="text-[#00E676] font-semibold">Canlı Binance TR:</span>
              <span className="font-mono text-slate-300">{lastSyncedTime || 'Senkronize'}</span>
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {/* AI Report Button */}
            <button
              id="btn-android-report"
              onClick={() => setShowReportModal(true)}
              className="p-2 rounded-lg bg-gradient-to-r from-amber-500/20 to-emerald-500/20 text-amber-300 hover:text-white border border-amber-500/30 transition active:scale-95 flex items-center justify-center"
              title="AI Analiz Raporu Al"
            >
              <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
            </button>

            <button
              id="btn-android-refresh"
              onClick={onRefresh}
              disabled={isLoading}
              className="p-2 rounded-lg bg-[#282E3E] text-slate-200 hover:text-white hover:bg-slate-700 transition active:scale-95 disabled:opacity-50"
              title="Yenile"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#00E676]' : ''}`} />
            </button>
          </div>
        </div>

        {/* Scrollable Content (Compose Screen Content) */}
        <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3.5 scrollbar-thin scrollbar-thumb-slate-700">
          {activeTab === 'wallet' ? (
            /* SANAL CÜZDAN & AKTİF İŞLEMLER EKRANI */
            <div className="space-y-3.5 animate-in fade-in">
              {/* Toplam Sanal Bakiye Kartı (#1E222D Zemin, #00E676 Vurgulu) */}
              <div className="rounded-2xl border border-slate-700 bg-[#1E222D] p-4 shadow-lg shadow-black/40">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    TOPLAM PORTFÖY DEĞERİ
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-bold border ${
                      wallet.total_unrealized_pnl >= 0 
                        ? 'bg-[#00E676]/15 text-[#00E676] border-[#00E676]/30' 
                        : 'bg-red-500/15 text-red-400 border-red-500/30'
                    }`}>
                      {wallet.total_unrealized_pnl >= 0 ? '+' : ''}₺{wallet.total_unrealized_pnl.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="mt-1 text-2xl font-black text-[#00E676] font-mono flex items-baseline justify-between">
                  <span>₺{wallet.total_portfolio_value.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
                  <span className="text-xs text-slate-400 font-sans font-normal">TRY</span>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                  <div className="flex items-center gap-1">
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

                  <button
                    onClick={onResetWallet}
                    className="text-[9px] text-slate-400 hover:text-white flex items-center gap-1 underline"
                    title="10.000 TL sanal bakiyeye sıfırla"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    Sıfırla (₺10k)
                  </button>
                </div>

                <div className="my-3 border-t border-slate-800" />

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-[#12141C]/80 p-2 rounded-xl border border-slate-800/80">
                    <div className="text-[9px] text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">Yatırımdaki</div>
                    <div className="text-xs font-bold text-amber-400 font-mono mt-0.5">
                      ₺{Math.round(wallet.invested_amount).toLocaleString('tr-TR')}
                    </div>
                  </div>
                  <div className="bg-[#12141C]/80 p-2 rounded-xl border border-slate-800/80">
                    <div className="text-[9px] text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">Açık Pozisyon</div>
                    <div className="text-xs font-bold text-cyan-400 font-mono mt-0.5">
                      {trades.length} / {config.max_open_positions}
                    </div>
                  </div>
                  <div className="bg-[#12141C]/80 p-2 rounded-xl border border-slate-800/80">
                    <div className="text-[9px] text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">Serbest Nakit</div>
                    <div className="text-xs font-bold text-emerald-300 font-mono mt-0.5">
                      ₺{Math.round(wallet.cash_balance).toLocaleString('tr-TR')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Aktif Pozisyonlar Başlığı & Kapat Butonları */}
              <div className="flex items-center justify-between px-1">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-200">
                    Açık Sanal Pozisyonlar ({trades.length})
                  </span>
                  <span className="text-[9px] text-slate-500 font-medium">
                    (İz Süren SL: -%{config.stop_loss_percent} • Kâr Al: +%{config.take_profit_percent})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowClosedHistory(!showClosedHistory)}
                    className="text-[10px] text-slate-400 hover:text-white flex items-center gap-0.5"
                  >
                    <History className="w-3 h-3" />
                    Geçmiş ({closedTrades.length})
                  </button>
                  {trades.length > 0 && (
                    <button
                      onClick={onCloseAll}
                      className="text-[10px] text-red-400 hover:text-red-300 underline font-semibold"
                    >
                      Tümünü Kapat
                    </button>
                  )}
                </div>
              </div>

              {/* Geçmiş Kapanan İşlemler */}
              {showClosedHistory && (
                <div className="rounded-xl border border-slate-800 bg-[#151822] p-2.5 space-y-2 text-xs">
                  <div className="text-[10px] font-bold text-slate-400 border-b border-slate-800 pb-1 flex justify-between">
                    <span>Tamamlanan İşlemler</span>
                    <span className="text-[#00E676] font-mono">
                      Net: {wallet.total_realized_pnl >= 0 ? '+' : ''}₺{wallet.total_realized_pnl.toFixed(2)}
                    </span>
                  </div>
                  {closedTrades.length === 0 ? (
                    <div className="text-[10px] text-slate-500 py-1 text-center">Henüz geçmiş işlem yok.</div>
                  ) : (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {closedTrades.map(c => (
                        <div key={c.id} className="bg-[#12141C] p-2 rounded-lg border border-slate-800/80 flex items-center justify-between text-[10px]">
                          <div>
                            <span className="font-bold text-white font-mono mr-1.5">{c.symbol}</span>
                            <span className="text-slate-500">{c.exit_reason === 'TAKE_PROFIT' ? '🎯 TP' : c.exit_reason === 'STOP_LOSS' ? '🛑 SL' : 'KAPANDI'}</span>
                          </div>
                          <span className={`font-mono font-bold ${c.realized_pnl >= 0 ? 'text-[#00E676]' : 'text-red-400'}`}>
                            {c.realized_pnl >= 0 ? '+' : ''}₺{c.realized_pnl.toFixed(2)} ({c.realized_pnl_percent >= 0 ? '+' : ''}%{c.realized_pnl_percent.toFixed(2)})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Pozisyon Listesi veya Boş Durum */}
              {trades.length === 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-[#1E222D] p-6 text-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                    <Info className="w-5 h-5" />
                  </div>
                  <div className="text-xs font-bold text-slate-200">Henüz açık sanal pozisyon yok</div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Radar sekmesinden beğendiğiniz bir pariteye dokunarak sanal alım yapabilir veya otomatik botun alım yapmasını bekleyebilirsiniz.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {trades.map((trade) => {
                    const isProfit = trade.unrealized_pnl >= 0;
                    return (
                      <div
                        key={trade.id}
                        className="rounded-xl border border-slate-800 bg-[#1E222D] p-3 shadow-md space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full bg-[#00E676] animate-pulse" />
                            <span className="text-xs font-black text-white">{trade.symbol}</span>
                            {trade.trend_15m && (
                              <span className={`text-[8px] font-bold px-1 rounded ${
                                trade.trend_15m === 'UP' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                              }`}>
                                15d {trade.trend_15m === 'UP' ? '▲' : '▼'}
                              </span>
                            )}
                            {trade.is_volume_dropping && (
                              <span className="text-[8px] font-bold px-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                📉 Koru
                              </span>
                            )}
                            <span className="text-[9px] text-slate-400 font-mono">
                              {trade.quantity < 1 ? trade.quantity.toFixed(4) : trade.quantity.toFixed(2)} adet
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-md text-[9px] font-mono font-black border ${
                              isProfit 
                                ? 'bg-emerald-500/15 text-[#00E676] border-emerald-500/30' 
                                : 'bg-red-500/15 text-red-400 border-red-500/30'
                            }`}>
                              {isProfit ? '+' : ''}₺{trade.unrealized_pnl.toFixed(2)} ({isProfit ? '+' : ''}%{trade.unrealized_pnl_percent.toFixed(2)})
                            </span>

                            <button
                              onClick={() => onClose(trade.id)}
                              className="px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 text-[9px] font-bold border border-red-500/30 transition active:scale-95"
                            >
                              Sat
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5 bg-[#12141C]/80 p-2.5 rounded-lg border border-slate-800 text-[11px]">
                          <div className="space-y-0.5">
                            <div className="flex items-center justify-between text-[9px] text-slate-400">
                              <span>Giriş:</span>
                              <span className="font-mono text-slate-300 font-medium">{formatCryptoPrice(trade.entry_price)}</span>
                            </div>
                            <div className="flex items-center justify-between text-[9px] text-slate-400">
                              <span>Anlık:</span>
                              <strong className="font-mono text-white font-bold">{formatCryptoPrice(trade.current_price)}</strong>
                            </div>
                          </div>
                          <div className="space-y-0.5 border-l border-slate-800/80 pl-2.5">
                            <div className="flex items-center justify-between text-[9px] text-slate-400">
                              <span>Yatırılan:</span>
                              <span className="font-mono text-amber-300 font-medium">₺{Math.round(trade.total_amount).toLocaleString('tr-TR')}</span>
                            </div>
                            <div className="flex items-center justify-between text-[9px] text-slate-400">
                              <span>Değer:</span>
                              <strong className="font-mono text-amber-400 font-bold">₺{trade.current_value.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</strong>
                            </div>
                          </div>
                        </div>

                        {trade.scan_reason && (
                          <div className="rounded-lg bg-[#12141C]/50 p-2 text-[10px] text-slate-300 border border-slate-800/80 line-clamp-1">
                            <span className="font-bold text-[#00E676] mr-1">AI:</span>
                            {trade.scan_reason}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* ACİL MÜDAHALE & ÇALIŞMA MODU BÖLÜMÜ */}
              <div className={`rounded-xl border p-3 transition-all ${
                config.mode === 'LIVE' 
                  ? 'bg-[#1E222D] border-emerald-500/40 shadow-lg shadow-emerald-950/30' 
                  : 'bg-[#1E222D] border-slate-700/60'
              }`}>
            <div className="flex items-center justify-between pb-2.5">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  BOT ÇALIŞMA DURUMU
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`w-2.5 h-2.5 rounded-full animate-pulse ${
                    config.emergency_stop 
                      ? 'bg-[#FFFF5252]' 
                      : config.mode === 'LIVE' 
                        ? 'bg-[#00E676]' 
                        : 'bg-amber-400'
                  }`} />
                  <span className="text-xs font-bold text-white tracking-wide">
                    {config.emergency_stop ? (
                      <span className="text-[#FFFF5252]">ACİL DURDURULDU</span>
                    ) : (
                      `${config.mode} MODUNDA AKTİF`
                    )}
                  </span>
                </div>
              </div>

              {/* VIRTUAL / LIVE Toggle */}
              <button
                id="btn-android-toggle-mode"
                onClick={onToggleMode}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm active:scale-95 ${
                  config.mode === 'LIVE'
                    ? 'bg-[#00E676] text-black hover:bg-emerald-400 ring-2 ring-emerald-500/50'
                    : 'bg-[#282E3E] text-slate-200 hover:bg-slate-700 border border-slate-600'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                MOD: {config.mode === 'LIVE' ? 'CANLI (LIVE)' : 'SANAL (VIRTUAL)'}
              </button>
            </div>

            {/* TEK TIKLA ACİL STOP BUTONU (ZORUNLU GEREKSİNİM) */}
            <button
              id="btn-android-emergency-stop"
              onClick={() => setShowEmergencyModal(true)}
              className="w-full py-2.5 px-3 rounded-lg bg-[#FFFF5252] hover:bg-red-600 text-white text-xs font-black tracking-wider flex items-center justify-center gap-2 shadow-md shadow-red-950/50 transition active:scale-98"
            >
              <AlertTriangle className="w-4 h-4 fill-white text-[#FFFF5252]" />
              ACİL TÜM POZİSYONLARI KAPAT
            </button>
          </div>

          {/* Filtre ve Arama Çubuğu */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">
                PİYASA TARAMASI <span className="text-slate-500 font-normal">({filteredScans.length}/20 TRY)</span>
              </span>
              <span className="text-[10px] font-bold text-[#00E676] tracking-wider uppercase">
                AI SKOR SIRALI
              </span>
            </div>

            <div className="grid grid-cols-4 gap-1 text-[10px] font-bold">
              {(['ALL', 'BUY', 'NEUTRAL', 'SELL'] as const).map((sig) => (
                <button
                  key={sig}
                  onClick={() => setFilterSignal(sig)}
                  className={`py-1 rounded-md transition ${
                    filterSignal === sig
                      ? 'bg-[#282E3E] text-white ring-1 ring-slate-500'
                      : 'bg-[#181B24] text-slate-400 hover:bg-[#1E222D]'
                  }`}
                >
                  {sig === 'ALL' ? 'TÜMÜ' : sig}
                </button>
              ))}
            </div>
          </div>

          {/* Market List (Jetpack Compose LazyColumn items) */}
          <div className="space-y-2 pb-6">
            {filteredScans.map((scan) => {
              const isExpanded = expandedSymbol === scan.symbol;
              const isHigh = scan.ai_score >= 80;
              const isBuy = scan.ai_score >= 65;
              const isSell = scan.ai_score < 40;

              const badgeColor = isHigh 
                ? 'text-[#00E676] border-[#00E676] bg-[#00E676]/10' 
                : isBuy 
                  ? 'text-emerald-400 border-emerald-400 bg-emerald-400/10'
                  : isSell 
                    ? 'text-[#FFFF5252] border-[#FFFF5252] bg-[#FFFF5252]/10'
                    : 'text-amber-400 border-amber-400 bg-amber-400/10';

              return (
                <div
                  key={scan.symbol}
                  onClick={() => setExpandedSymbol(isExpanded ? null : scan.symbol)}
                  className="rounded-xl bg-[#1E222D] hover:bg-[#252A38] border border-slate-800/80 p-3 transition cursor-pointer active:scale-[0.99]"
                >
                  <div className="grid grid-cols-12 gap-2 items-center">
                    {/* Symbol & Volume */}
                    <div className="col-span-5 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-sm text-white tracking-wide truncate">
                          {scan.symbol}
                        </span>
                        <span className="text-[8px] px-1 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                          TRY
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 block mt-0.5 truncate">
                        Hacim: {(scan.volume_24h_try / 1000000).toFixed(1)}M ₺
                      </span>
                    </div>

                    {/* Price & 24h Change */}
                    <div className="col-span-4 text-right min-w-0 pr-1">
                      <div className="text-xs font-bold text-white font-mono truncate">
                        {formatCryptoPrice(scan.price)}
                      </div>
                      <div className={`text-[10px] font-bold flex items-center justify-end gap-0.5 mt-0.5 ${
                        scan.change_24h_percent >= 0 ? 'text-[#00E676]' : 'text-[#FFFF5252]'
                      }`}>
                        {scan.change_24h_percent >= 0 ? (
                          <TrendingUp className="w-2.5 h-2.5 shrink-0" />
                        ) : (
                          <TrendingDown className="w-2.5 h-2.5 shrink-0" />
                        )}
                        <span className="font-mono">{scan.change_24h_percent >= 0 ? '+' : ''}{scan.change_24h_percent.toFixed(2)}%</span>
                      </div>
                    </div>

                    {/* AI Score Badge */}
                    <div className="col-span-3 flex justify-end">
                      <div className={`flex flex-col items-center justify-center w-full max-w-[62px] py-1 rounded-lg border font-mono ${badgeColor}`}>
                        <span className="text-sm font-black leading-none">{scan.ai_score}</span>
                        <span className="text-[8px] font-bold tracking-tighter mt-0.5 uppercase leading-none truncate w-full text-center">
                          {scan.signal_type}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* AI Reason Preview & Drawer */}
                  <div className="mt-2 rounded-lg bg-[#12141C]/80 border border-slate-800 p-2 text-[11px] text-slate-300">
                    <div className="flex items-start gap-1.5">
                      <span className="font-bold text-[10px] uppercase text-[#00E676] shrink-0 mt-0.5">
                        AI ANALİZ:
                      </span>
                      <p className={`line-clamp-${isExpanded ? 'none' : '2'} text-slate-300 leading-relaxed text-[11px]`}>
                        {scan.scan_reason}
                      </p>
                    </div>

                    {isExpanded && (
                      <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                        <span className="text-[10px] text-slate-400">Risk: %5 (₺1.500)</span>
                        {trades.some(t => t.symbol === scan.symbol) ? (
                          <span className="text-[10px] text-[#00E676] font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Portföyde Açık
                          </span>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onBuy(scan);
                            }}
                            disabled={config.emergency_stop || wallet.cash_balance < 1500 || trades.length >= config.max_open_positions}
                            className="px-2.5 py-1 rounded-lg bg-[#00E676] hover:bg-emerald-400 text-slate-950 font-black text-[10px] flex items-center gap-1 transition disabled:opacity-50"
                          >
                            <span>Al (₺1.500)</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-1 pt-1 border-t border-slate-800 text-[9px] text-slate-500">
                      <span>PostgREST Synced</span>
                      <span className="flex items-center gap-0.5 text-slate-400">
                        {isExpanded ? 'Gizle' : 'Detay & Alış'}
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
            </>
          )}
        </div>

        {/* Compose Bottom Navigation Bar (Radar & Cüzdan) */}
        <div className="bg-[#1E222D] border-t border-slate-800 px-6 py-1.5 flex items-center justify-around select-none">
          <button
            id="btn-tab-radar"
            onClick={() => setActiveTab('radar')}
            className={`flex flex-col items-center gap-0.5 py-1 px-4 rounded-xl transition cursor-pointer ${
              activeTab === 'radar' 
                ? 'text-[#00E676] bg-[#00E676]/10 font-bold' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span className="text-[10px]">Radar</span>
          </button>
          <button
            id="btn-tab-wallet"
            onClick={() => setActiveTab('wallet')}
            className={`flex flex-col items-center gap-0.5 py-1 px-4 rounded-xl transition cursor-pointer ${
              activeTab === 'wallet' 
                ? 'text-[#00E676] bg-[#00E676]/10 font-bold' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="relative">
              <Wallet className="w-4 h-4" />
              {trades.length > 0 && (
                <span className="absolute -top-1.5 -right-2 w-3.5 h-3.5 bg-[#00E676] text-[#12141C] text-[9px] font-black rounded-full flex items-center justify-center">
                  {trades.length}
                </span>
              )}
            </div>
            <span className="text-[10px]">Cüzdan</span>
          </button>
        </div>

        {/* Android Navigation Bar */}
        <div className="bg-[#1E222D] py-2 px-8 flex items-center justify-around border-t border-slate-800/80">
          <div className="w-3.5 h-3.5 border-2 border-slate-400 rounded-sm opacity-60" />
          <div className="w-3.5 h-3.5 border-2 border-slate-400 rounded-full opacity-60" />
          <div className="w-0 h-0 border-y-[6px] border-y-transparent border-r-[10px] border-r-slate-400 opacity-60" />
        </div>
      </div>

      {/* Emergency Modal Dialog */}
      {showEmergencyModal && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 rounded-[32px] flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-[#1E222D] border border-red-500/40 rounded-2xl p-5 shadow-2xl max-w-[320px] text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-500/20 text-[#FFFF5252] flex items-center justify-center mx-auto ring-4 ring-red-500/10">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div>
              <h3 className="text-base font-black text-white uppercase tracking-wide">
                ACİL MÜDAHALE PROTOKOLÜ
              </h3>
              <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                Bu işlem <strong className="text-red-400">açık olan tüm emirleri anında iptal edecek</strong>, botu VIRTUAL moda çekecek ve 7/24 motoru durduracaktır.
              </p>
            </div>

            <div className="space-y-2 pt-1">
              <button
                id="btn-confirm-emergency-stop"
                onClick={handleConfirmEmergencyStop}
                className="w-full py-2.5 rounded-xl bg-[#FFFF5252] hover:bg-red-600 text-white font-bold text-xs shadow-lg shadow-red-950/60 active:scale-95 transition"
              >
                TÜMÜNÜ KAPAT VE DURDUR
              </button>

              <button
                onClick={() => setShowEmergencyModal(false)}
                className="w-full py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-semibold text-xs transition"
              >
                VAZGEÇ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Report Bottom Sheet / Modal for Mobile */}
      {showReportModal && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 rounded-[32px] flex items-end justify-center animate-in fade-in">
          <div className="bg-[#1E222D] border-t border-slate-700 rounded-t-3xl w-full max-h-[85%] flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-300">
            {/* Header */}
            <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between bg-[#151821]">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400 fill-amber-400" />
                <span className="text-xs font-black text-white">AI İşlem Raporu</span>
              </div>
              <button 
                onClick={() => setShowReportModal(false)}
                className="p-1 rounded-lg bg-[#12141C] hover:bg-slate-800 text-slate-400 hover:text-white transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 overflow-y-auto space-y-3.5 text-xs text-slate-300">
              <p className="text-[10px] text-slate-400 leading-normal">
                Aşağıdaki detaylı Markdown raporunu kopyalayıp Gemini, ChatGPT veya Claude'a göndererek analiz alabilirsiniz.
              </p>

              <div className="relative">
                <pre className="font-mono text-[9px] text-slate-300 whitespace-pre-wrap bg-[#0E1118] border border-slate-800/80 rounded-xl p-3 max-h-[350px] overflow-y-auto leading-relaxed select-all scrollbar-none">
                  {generateMarkdownReport()}
                </pre>
                <div className="absolute top-2 right-2 opacity-95">
                  <button
                    onClick={handleCopyReport}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#00E676] text-slate-950 font-black text-[10px] shadow-lg transition active:scale-95"
                  >
                    {copiedReport ? (
                      <>
                        <Check className="w-3 h-3" />
                        <span>Kopyalandı!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Kopyala</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-3.5 border-t border-slate-800 bg-[#151821] flex justify-end gap-2">
              <button
                onClick={() => setShowReportModal(false)}
                className="py-1.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold transition active:scale-95"
              >
                Kapat
              </button>
              <button
                onClick={handleCopyReport}
                className="py-1.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-extrabold text-[11px] shadow-md transition active:scale-95"
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
