import React from 'react';
import { 
  Database, 
  Terminal, 
  Smartphone, 
  ShieldCheck, 
  KeyRound, 
  Cpu, 
  Zap, 
  ArrowRight,
  AlertOctagon,
  CheckCircle2,
  Lock
} from 'lucide-react';

export const ArchitectureOverview: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Visual Pipeline Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* Step 1 */}
        <div className="p-4 rounded-xl bg-[#1E222D] border border-slate-800 flex flex-col justify-between relative">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono">
                ADIM 1
              </span>
              <span className="text-xs text-slate-500">Public API</span>
            </div>
            <h4 className="font-bold text-sm text-white mt-2">Binance TR Ticker</h4>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              24 saatlik hacme göre filtrelenen en yüksek likiditeli ilk 20 TRY paritesi çekilir (BTCTRY, SOLTRY...).
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800 text-[11px] text-amber-400 font-mono">
            requests + pandas
          </div>
        </div>

        {/* Step 2 */}
        <div className="p-4 rounded-xl bg-[#1E222D] border border-slate-800 flex flex-col justify-between relative">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono">
                ADIM 2
              </span>
              <span className="text-xs text-slate-500">AI Karar Motoru</span>
            </div>
            <h4 className="font-bold text-sm text-white mt-2">Gemini 1.5 Flash</h4>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Fiyat, değişim ve hacim verileri analiz edilip katı JSON şemasıyla <code className="text-emerald-400 font-mono">ai_score</code> (0-100) ve Türkçe gerekçe üretir.
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800 text-[11px] text-emerald-400 font-mono">
            google-generativeai
          </div>
        </div>

        {/* Step 3 */}
        <div className="p-4 rounded-xl bg-[#1E222D] border border-slate-800 flex flex-col justify-between relative">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">
                ADIM 3
              </span>
              <span className="text-xs text-slate-500">Veritabanı & Kasa</span>
            </div>
            <h4 className="font-bold text-sm text-white mt-2">Supabase PostgREST</h4>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              PGRST125 hatasız doğrudan HTTP Upsert yapılır. RLS <code className="text-blue-400 font-mono">auth.uid() = user_id</code> ve bot_config API anahtarlarını korur.
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800 text-[11px] text-blue-400 font-mono">
            bot_config + RLS
          </div>
        </div>

        {/* Step 4 */}
        <div className="p-4 rounded-xl bg-[#1E222D] border border-slate-800 flex flex-col justify-between relative">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 font-mono">
                ADIM 4
              </span>
              <span className="text-xs text-slate-500">Android İstemci</span>
            </div>
            <h4 className="font-bold text-sm text-white mt-2">Jetpack Compose</h4>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Koyu tema (#12141C), Yeşil/Kırmızı rozetler, tek dokunuşla VIRTUAL/LIVE geçişi ve ACİL TÜM POZİSYONLARI KAPAT butonu.
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-800 text-[11px] text-purple-400 font-mono">
            postgrest-kt + StateFlow
          </div>
        </div>
      </div>

      {/* Critical Architecture Rules Highlight */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Rule 1 */}
        <div className="p-4 rounded-xl bg-[#151821] border border-blue-900/40 space-y-2">
          <div className="flex items-center gap-2 text-blue-400">
            <Lock className="w-4 h-4" />
            <h5 className="text-xs font-bold uppercase tracking-wider">Single-User Isolation & API Güvenliği</h5>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            <code className="text-blue-300 font-mono">auth.uid() = user_id</code> politikalarıyla <code className="text-blue-300 font-mono">bot_config</code>, <code className="text-blue-300 font-mono">market_scans</code> ve <code className="text-blue-300 font-mono">trades</code> tabloları RLS ile kilitlidir. Binance API Key/Secret doğrudan <code className="text-blue-300 font-mono">bot_config</code> tablosunda kullanıcıya özel izole saklanır.
          </p>
        </div>

        {/* Rule 2 */}
        <div className="p-4 rounded-xl bg-[#151821] border border-emerald-900/40 space-y-2">
          <div className="flex items-center gap-2 text-emerald-400">
            <ShieldCheck className="w-4 h-4" />
            <h5 className="text-xs font-bold uppercase tracking-wider">PGRST125 Hatasını Önleme</h5>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Python botu, PostgREST URL path hatalarını önlemek için doğrudan HTTP REST API kullanarak <code className="text-emerald-300 font-mono">on_conflict=user_id,symbol</code> ve <code className="text-emerald-300 font-mono">Prefer: resolution=merge-duplicates</code> başlıklarıyla upsert atar.
          </p>
        </div>

        {/* Rule 3 */}
        <div className="p-4 rounded-xl bg-[#151821] border border-red-900/40 space-y-2">
          <div className="flex items-center gap-2 text-red-400">
            <AlertOctagon className="w-4 h-4" />
            <h5 className="text-xs font-bold uppercase tracking-wider">Acil Müdahale Protokolü</h5>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Android mobil arayüzün üst kısmında yer alan acil durdurma butonu ile <code className="text-red-300 font-mono">emergency_stop = true</code> bayrağı tetiklenir, açık tüm limit/piyasa emirleri anında iptal edilir ve bot güvenli sanal moda çekilir.
          </p>
        </div>
      </div>
    </div>
  );
};
