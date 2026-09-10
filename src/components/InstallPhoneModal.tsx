import React, { useState } from 'react';
import { 
  Smartphone, 
  Download, 
  X, 
  Check, 
  Copy, 
  ExternalLink, 
  Layers, 
  Sparkles, 
  ShieldCheck,
  Code2
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface InstallPhoneModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InstallPhoneModal: React.FC<InstallPhoneModalProps> = ({ isOpen, onClose }) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, isInIframe, install } = usePWAInstall();
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'pwa' | 'apk'>('pwa');

  if (!isOpen) return null;

  const appUrl = window.location.href;

  const handleCopy = () => {
    navigator.clipboard.writeText(appUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleOpenDirect = () => {
    window.open(appUrl, '_blank');
  };

  const handleInstallClick = async () => {
    if (isInstallable) {
      await install();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-lg rounded-2xl bg-[#151821] border border-slate-700 shadow-2xl text-slate-200 overflow-hidden my-4">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 bg-[#12141C]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-[#00E676]">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Android Telefona Yükle</h3>
              <p className="text-xs text-slate-400">Binance TR AlgoTrader AI Mobil Kurulum</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-800 bg-[#10121A]">
          <button
            onClick={() => setActiveTab('pwa')}
            className={`flex-1 py-3 px-4 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition ${
              activeTab === 'pwa'
                ? 'border-[#00E676] text-[#00E676] bg-[#00E676]/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            1. Yöntem: Anında Yükle (PWA Android App)
          </button>
          <button
            onClick={() => setActiveTab('apk')}
            className={`flex-1 py-3 px-4 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition ${
              activeTab === 'apk'
                ? 'border-blue-500 text-blue-400 bg-blue-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-4 h-4" />
            2. Yöntem: Yerel Android APK (Kotlin)
          </button>
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {activeTab === 'pwa' ? (
            <>
              {/* If in iframe banner */}
              {isInIframe && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-amber-200">
                    <span>💡 Neden Şimdi Yüklenmiyor?</span>
                  </div>
                  <p className="leading-relaxed text-slate-300 text-[11px]">
                    Uygulama şu an Google AI Studio önizleme çerçevesi (iframe) içinde çalışıyor. Tarayıcı güvenlik kuralları gereği <strong>"Ana Ekrana Ekle / Uygulamayı Yükle"</strong> penceresi sadece doğrudan açılan sekmelerde tetiklenir.
                  </p>
                  <button
                    onClick={handleOpenDirect}
                    className="w-full py-2.5 px-3 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow transition"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Yeni Sekmede Doğrudan Aç ve Telefona Yükle
                  </button>
                </div>
              )}

              <div className="p-3.5 rounded-xl bg-emerald-950/25 border border-emerald-800/40 text-xs text-emerald-300 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-[#00E676] shrink-0 mt-0.5" />
                <div>
                  <strong>APK indirmeye gerek yok!</strong> Uygulama Progressive Web App (PWA) olarak hazırlandı. Android telefonunuzun ana ekranına tek dokunuşla yerel uygulama gibi kurulur ve çevrimdışı önbellekle tam ekran çalışır.
                </div>
              </div>

              {isInstalled ? (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center">
                  <span className="text-[#00E676] font-semibold text-sm flex items-center justify-center gap-2">
                    <Check className="w-5 h-5" /> Uygulama Cihazınızda Zaten Yüklü!
                  </span>
                  <p className="text-xs text-slate-400 mt-1">Ana ekranınızdaki AlgoTrader simgesine dokunarak tam ekran kullanabilirsiniz.</p>
                </div>
              ) : isInstallable ? (
                <div className="space-y-3">
                  <button
                    onClick={handleInstallClick}
                    className="w-full py-3.5 px-4 rounded-xl bg-[#00E676] hover:bg-[#22ff8f] text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#00E676]/20 transition cursor-pointer active:scale-95"
                  >
                    <Download className="w-5 h-5" />
                    Şimdi Telefona Yükle (Tek Tıkla Kur)
                  </button>
                  <p className="text-[11px] text-center text-slate-400">
                    Tarayıcınızın "Uygulamayı Yükle" onay penceresini açar.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <span>📱 Android Chrome veya Samsung Internet ile 3 Adımda Kurulum:</span>
                  </div>

                  <div className="space-y-2 bg-[#10121A] p-4 rounded-xl border border-slate-800 text-xs text-slate-300">
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-[#00E676] flex items-center justify-center font-bold text-[11px] shrink-0">1</span>
                      <div>Telefonunuzun Chrome tarayıcısında bu bağlantıyı açın.</div>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-[#00E676] flex items-center justify-center font-bold text-[11px] shrink-0">2</span>
                      <div>Sağ üstteki <strong>üç nokta (⋮)</strong> menüsüne dokunun.</div>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-[#00E676] flex items-center justify-center font-bold text-[11px] shrink-0">3</span>
                      <div>
                        Menüdeki <strong>"Uygulamayı Yükle"</strong> veya <strong>"Ana Ekrana Ekle"</strong> seçeneğine basın ve <strong>"Yükle"</strong>yi onaylayın.
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 text-center">
                    Artık telefonunuzun ana ekranındaki <strong>AlgoTrader</strong> simgesiyle tam ekran Android uygulaması olarak açılır.
                  </p>
                </div>
              )}

              {/* Link Share Box */}
              <div className="pt-2 border-t border-slate-800/80">
                <label className="text-xs font-medium text-slate-400 block mb-1.5">
                  Telefonda Açmak İçin Doğrudan Bağlantı Linki:
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={appUrl}
                    className="w-full bg-[#10121A] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-300 select-all"
                  />
                  <button
                    onClick={handleCopy}
                    className="shrink-0 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white flex items-center gap-1.5 transition"
                  >
                    {copied ? <Check className="w-4 h-4 text-[#00E676]" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Kopyalandı' : 'Kopyala'}
                  </button>
                  <button
                    onClick={handleOpenDirect}
                    title="Yeni Sekmede Aç"
                    className="shrink-0 px-3 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-[#00E676] border border-emerald-500/30 text-xs font-semibold flex items-center gap-1 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4 text-xs leading-relaxed text-slate-300">
              <div className="p-3.5 rounded-xl bg-blue-950/20 border border-blue-800/40 text-blue-300 flex items-start gap-2.5">
                <Code2 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <strong>Tam Yerel Kotlin & Jetpack Compose APK:</strong> Uygulamanın tüm kaynak kodları projenizde hazırdır.
                </div>
              </div>

              <div className="space-y-2">
                <div className="font-semibold text-white">APK Derleyip Telefona Yükleme Adımları:</div>
                <ol className="list-decimal list-inside space-y-2 bg-[#10121A] p-4 rounded-xl border border-slate-800">
                  <li>
                    Bilgisayarınızda <strong>Android Studio</strong> uygulamasını açın.
                  </li>
                  <li>
                    <strong>New Project &gt; Empty Compose Activity</strong> seçin ve paket adını <code className="text-blue-300 font-mono">com.binance.algotrader</code> yapın.
                  </li>
                  <li>
                    Projenin <strong>"Android Kotlin Kodları"</strong> sekmesindeki <code className="text-emerald-400 font-mono">build.gradle.kts</code>, <code className="text-emerald-400 font-mono">MarketScan.kt</code>, <code className="text-emerald-400 font-mono">TradingDashboardScreen.kt</code> dosyalarını yapıştırın.
                  </li>
                  <li>
                    Telefonunuzu USB kablosuyla bağlayıp <strong>USB Hata Ayıklama</strong>yı açın ya da menüden <strong>Build &gt; Build Bundle(s) / APK(s) &gt; Build APK(s)</strong> seçeneğine tıklayın.
                  </li>
                  <li>
                    Oluşan <code className="text-amber-300 font-mono">app-debug.apk</code> dosyasını telefonunuza gönderip üzerine dokunarak doğrudan yükleyin.
                  </li>
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-[#12141C] flex items-center justify-between">
          <span className="text-[11px] text-slate-500">Android PWA & Compose Suite</span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition"
          >
            Kapat
          </button>
        </div>

      </div>
    </div>
  );
};
