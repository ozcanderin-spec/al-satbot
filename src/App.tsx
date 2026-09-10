import React, { useState } from 'react';
import { MarketScan, BotConfig } from './types/market';
import { AndroidDeviceSimulator } from './components/AndroidDeviceSimulator';
import { ArchitectureOverview } from './components/ArchitectureOverview';
import { CodeViewer } from './components/CodeViewer';
import { InstallPhoneModal } from './components/InstallPhoneModal';
import { TradingDashboard } from './components/TradingDashboard';
import { useTradingEngine } from './hooks/useTradingEngine';
import { 
  RefreshCw, 
  Globe, 
  ShieldCheck, 
  Smartphone, 
  AlertTriangle,
  Download,
  CheckCircle2,
  Lock,
  Zap,
  Activity,
  Code2,
  Database,
  LayoutDashboard,
  Layers,
  Wallet as WalletIcon
} from 'lucide-react';

export default function App() {
  const [mainView, setMainView] = useState<'dashboard' | 'simulator' | 'architecture' | 'code'>('dashboard');
  const [activeRightTab, setActiveRightTab] = useState<'architecture' | 'code'>('architecture');
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);

  // Centralized Trading & Wallet Engine
  const {
    marketScans,
    trades,
    closedTrades,
    wallet,
    botConfig,
    isLoading,
    statusMessage,
    lastSyncedTime,
    isLiveConnected,
    setStatusMessage,
    buyPosition,
    closePosition,
    closeAllPositions,
    resetWallet,
    handleToggleMode,
    handleEmergencyStop,
    handleLiveBinanceFetch,
    handleSimulateFreshScan,
  } = useTradingEngine();

  return (
    <div className="min-h-screen bg-[#0E1118] text-slate-100 flex flex-col font-sans select-none antialiased">
      
      {/* Top Navigation & App Suite Bar */}
      <header className="sticky top-0 z-40 bg-[#151821]/95 backdrop-blur-md border-b border-slate-800 px-4 py-3 shadow-lg">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          
          {/* Brand Logo & Description */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-inner">
              <Zap className="w-5 h-5 fill-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-black tracking-wide text-white">
                  Binance TR AI Algo-Trading Suite
                </h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-[#00E676] border border-emerald-500/30">
                  Gemini 1.5 Flash
                </span>
              </div>
              <p className="text-xs text-slate-400">
                7/24 Otonom Al-Sat Botu, Web Kontrol Paneli & Android Mimarisi
              </p>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Live Portfolio Value Chip */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1E222D] border border-slate-700 text-xs font-mono">
              <WalletIcon className="w-3.5 h-3.5 text-[#00E676]" />
              <span className="text-slate-400 font-sans">Cüzdan:</span>
              <span className="font-bold text-[#00E676]">₺{wallet.total_portfolio_value.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
              <span className={`text-[10px] font-bold ${wallet.total_unrealized_pnl >= 0 ? 'text-[#00E676]' : 'text-red-400'}`}>
                ({wallet.total_unrealized_pnl >= 0 ? '+' : ''}%{wallet.total_unrealized_pnl_percent.toFixed(2)})
              </span>
            </div>

            {/* Status Pill */}
            <div className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${
              botConfig.emergency_stop
                ? 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse'
                : botConfig.mode === 'LIVE'
                  ? 'bg-emerald-500/20 text-[#00E676] border-emerald-500/40'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
            }`}>
              <span className={`w-2 h-2 rounded-full ${
                botConfig.emergency_stop ? 'bg-red-500' : botConfig.mode === 'LIVE' ? 'bg-[#00E676]' : 'bg-amber-400'
              }`} />
              MOD: {botConfig.emergency_stop ? 'ACİL DURDURULDU' : botConfig.mode}
            </div>

            {/* Live Binance Fetch Button */}
            <button
              id="btn-suite-live-binance"
              onClick={handleLiveBinanceFetch}
              disabled={isLoading}
              className="py-1.5 px-3 rounded-xl bg-[#1E222D] hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50"
              title="Binance TR Canlı 24s Ticker verilerini sorgula"
            >
              <Globe className="w-3.5 h-3.5 text-amber-400" />
              Canlı Binance
            </button>

            {/* AI Analysis Refresh Button */}
            <button
              id="btn-suite-ai-refresh"
              onClick={handleSimulateFreshScan}
              disabled={isLoading}
              className="py-1.5 px-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-xs font-bold text-[#00E676] flex items-center gap-1.5 transition active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              AI Yenile
            </button>

            {/* Mode Switcher */}
            <button
              id="btn-suite-toggle-mode"
              onClick={handleToggleMode}
              className={`py-1.5 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition active:scale-95 ${
                botConfig.mode === 'LIVE'
                  ? 'bg-[#00E676] text-slate-950 hover:bg-emerald-400 font-black'
                  : 'bg-[#1E222D] hover:bg-slate-700 text-slate-300 border border-slate-700'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {botConfig.mode === 'LIVE' ? 'CANLI MOD' : 'SANAL MOD'}
            </button>

            {/* Emergency Stop Button */}
            <button
              id="btn-suite-emergency-stop"
              onClick={handleEmergencyStop}
              className="py-1.5 px-3 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 text-xs font-bold flex items-center gap-1.5 transition active:scale-95"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              ACİL STOP
            </button>

            {/* Install on Mobile Modal Trigger */}
            <button
              id="btn-suite-install-modal"
              onClick={() => setIsInstallModalOpen(true)}
              className="py-1.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-md shadow-emerald-500/20 transition active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              Telefona Yükle
            </button>
          </div>

        </div>
      </header>

      {/* View Switcher Navigation Bar (Eski Arayüz / Android Simülatör / Mimari / Kodlar) */}
      <nav className="bg-[#12141C] border-b border-slate-800 px-4 py-2 sticky top-[65px] z-30 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          
          <div className="flex items-center gap-1.5 p-1 bg-[#181C26] rounded-xl border border-slate-800">
            {/* Eski Arayüz (Web Kontrol Paneli) */}
            <button
              id="nav-btn-dashboard"
              onClick={() => setMainView('dashboard')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition active:scale-95 ${
                mainView === 'dashboard'
                  ? 'bg-[#00E676] text-slate-950 font-black shadow-md shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Eski Arayüz (Web Kontrol Paneli)</span>
            </button>

            {/* Android Cihaz Simülatörü */}
            <button
              id="nav-btn-simulator"
              onClick={() => setMainView('simulator')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition active:scale-95 ${
                mainView === 'simulator'
                  ? 'bg-amber-400 text-slate-950 font-black shadow-md shadow-amber-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              <span>Android Cihaz Simülatörü</span>
            </button>

            {/* Sistem Mimarisi */}
            <button
              id="nav-btn-architecture"
              onClick={() => setMainView('architecture')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition active:scale-95 ${
                mainView === 'architecture'
                  ? 'bg-teal-400 text-slate-950 font-black shadow-md shadow-teal-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="w-4 h-4" />
              <span>Sistem Mimarisi & Akış</span>
            </button>

            {/* Kaynak Kodları */}
            <button
              id="nav-btn-code"
              onClick={() => setMainView('code')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition active:scale-95 ${
                mainView === 'code'
                  ? 'bg-purple-400 text-slate-950 font-black shadow-md shadow-purple-500/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Code2 className="w-4 h-4" />
              <span>Kaynak Kodları (4 Bölüm)</span>
            </button>
          </div>

          <div className="text-[11px] text-slate-400 hidden sm:flex items-center gap-2">
            <span>Seçili Görünüm:</span>
            <span className="font-semibold text-slate-200">
              {mainView === 'dashboard' && '📊 Orijinal Web Trading Masası (Cüzdan, Trades, Taramalar)'}
              {mainView === 'simulator' && '📱 Android Telefon Görünümü (Pixel 8 Pro)'}
              {mainView === 'architecture' && '⚡ 7/24 Supabase + Gemini Veri Pipeline'}
              {mainView === 'code' && '💻 Android Jetpack Compose & Python Bot Kodları'}
            </span>
          </div>

        </div>
      </nav>

      {/* Temporary Status Notification Bar */}
      {statusMessage && (
        <div className="bg-[#181C26] border-b border-slate-800 px-4 py-2 text-xs text-slate-300 flex items-center justify-between">
          <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-[#00E676]" />
              {statusMessage}
            </span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-slate-500 hover:text-slate-300 text-xs ml-4"
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {/* Main Dynamic View Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 lg:p-6">
        
        {/* VIEW 1: ESKİ ARAYÜZ - WEB TRADING KONTROL PANELİ */}
        {mainView === 'dashboard' && (
          <TradingDashboard
            scans={marketScans}
            config={botConfig}
            wallet={wallet}
            trades={trades}
            closedTrades={closedTrades}
            onToggleMode={handleToggleMode}
            onEmergencyStop={handleEmergencyStop}
            onRefreshLive={handleLiveBinanceFetch}
            onSimulateScan={handleSimulateFreshScan}
            onBuy={buyPosition}
            onClose={closePosition}
            onCloseAll={closeAllPositions}
            onResetWallet={resetWallet}
            isLoading={isLoading}
            onSwitchToMobile={() => setMainView('simulator')}
            lastSyncedTime={lastSyncedTime}
            isLiveConnected={isLiveConnected}
          />
        )}

        {/* VIEW 2: ANDROID CİHAZ SİMÜLATÖRÜ + YAN PANEL */}
        {mainView === 'simulator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-in fade-in">
            {/* Left Column: Android Device Simulator */}
            <div className="lg:col-span-5 flex flex-col items-center">
              <div className="w-full flex items-center justify-between mb-3 px-2">
                <div className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-[#00E676]" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Canlı Android Cihaz Simülatörü
                  </h2>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">
                  Pixel 8 Pro (Material 3)
                </span>
              </div>

              {/* Interactive Phone Frame Component */}
              <AndroidDeviceSimulator
                scans={marketScans}
                config={botConfig}
                wallet={wallet}
                trades={trades}
                closedTrades={closedTrades}
                onToggleMode={handleToggleMode}
                onEmergencyStop={handleEmergencyStop}
                onRefresh={handleLiveBinanceFetch}
                onBuy={buyPosition}
                onClose={closePosition}
                onCloseAll={closeAllPositions}
                onResetWallet={resetWallet}
                isLoading={isLoading}
                lastSyncedTime={lastSyncedTime}
                isLiveConnected={isLiveConnected}
              />

              <p className="mt-3 text-[11px] text-slate-500 text-center max-w-sm">
                Telefonda test etmek için üstteki <strong>"Telefona Yükle"</strong> butonuna basabilir veya doğrudan tarayıcınızın "Ana Ekrana Ekle" özelliğini kullanabilirsiniz.
              </p>
            </div>

            {/* Right Column: Architecture & Production Code Suite */}
            <div className="lg:col-span-7 flex flex-col space-y-4">
              {/* Tab Navigation */}
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <button
                  id="tab-btn-sim-architecture"
                  onClick={() => setActiveRightTab('architecture')}
                  className={`py-2 px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
                    activeRightTab === 'architecture'
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      : 'bg-[#1E222D] text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <Zap className="w-4 h-4 text-amber-400" />
                  Mimari & Canlı Veri Akışı
                </button>

                <button
                  id="tab-btn-sim-code"
                  onClick={() => setActiveRightTab('code')}
                  className={`py-2 px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
                    activeRightTab === 'code'
                      ? 'bg-emerald-500/15 text-[#00E676] border border-emerald-500/30'
                      : 'bg-[#1E222D] text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <Code2 className="w-4 h-4 text-[#00E676]" />
                  Android & Backend Kodları
                </button>
              </div>

              {activeRightTab === 'architecture' ? (
                <div className="rounded-2xl border border-slate-800 bg-[#151821] p-5 shadow-xl">
                  <ArchitectureOverview />
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-800 bg-[#151821] overflow-hidden shadow-xl">
                  <CodeViewer />
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 3: TAM EKRAN MİMARİ & CANLI AKIŞ */}
        {mainView === 'architecture' && (
          <div className="rounded-2xl border border-slate-800 bg-[#151821] p-6 shadow-xl animate-in fade-in space-y-4">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-lg font-black text-white flex items-center gap-2">
                  <Zap className="w-5 h-5 text-amber-400" />
                  7/24 Binance TR & Gemini 1.5 Flash Canlı Veri Akışı Mimarisi
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Binance Public API → Python AI Bot Motoru → Supabase Realtime → Android Jetpack Compose Uygulaması
                </p>
              </div>
              <button
                onClick={() => setMainView('dashboard')}
                className="py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold"
              >
                ← Web Kontrol Paneline Dön
              </button>
            </div>
            <ArchitectureOverview />
          </div>
        )}

        {/* VIEW 4: TAM EKRAN KAYNAK KODLARI */}
        {mainView === 'code' && (
          <div className="rounded-2xl border border-slate-800 bg-[#151821] overflow-hidden shadow-xl animate-in fade-in space-y-4 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h2 className="text-lg font-black text-white flex items-center gap-2">
                  <Code2 className="w-5 h-5 text-[#00E676]" />
                  Android & Backend Üretim Kodları Deposu (4 Bölüm)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Jetpack Compose UI, Supabase Servisleri, Python Trading Botu & PostgreSQL Veritabanı Şeması
                </p>
              </div>
              <button
                onClick={() => setMainView('dashboard')}
                className="py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold"
              >
                ← Web Kontrol Paneline Dön
              </button>
            </div>
            <CodeViewer />
          </div>
        )}

      </main>

      {/* Footer Bar */}
      <footer className="border-t border-slate-800/80 bg-[#12141C] py-3 px-4 text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <span>Binance TR AI Algo-Trading Suite © 2026 • Gemini 1.5 Flash Destekli</span>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-emerald-400/90">
              <span className="w-2 h-2 rounded-full bg-[#00E676] animate-pulse" />
              Supabase Gerçek Zamanlı Bağlantı Hazır
            </span>
            <span>API Güvenliği: HMAC-SHA256</span>
          </div>
        </div>
      </footer>

      {/* Modal for Mobile Phone Installation Guide */}
      <InstallPhoneModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
      />

    </div>
  );
}
