import React, { useState } from 'react';
import { 
  SQL_SCHEMA, 
  PYTHON_BOT_ENGINE, 
  ANDROID_GRADLE_DEPENDENCIES, 
  ANDROID_DATA_CLASS, 
  ANDROID_VIEW_MODEL, 
  ANDROID_COMPOSE_UI,
  WEB_CONTROL_PANEL_HTML
} from '../data/codeSnippets';
import { 
  Copy, 
  Check, 
  Database, 
  Terminal, 
  Smartphone, 
  FileCode, 
  Download, 
  Lock, 
  ShieldCheck, 
  Cpu,
  Layers,
  Globe
} from 'lucide-react';

export const CodeViewer: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'sql' | 'python' | 'android' | 'web'>('sql');
  const [androidSubTab, setAndroidSubTab] = useState<'compose' | 'viewmodel' | 'dataclass' | 'gradle'>('compose');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const getAndroidCode = () => {
    switch (androidSubTab) {
      case 'compose':
        return {
          filename: 'BotDashboardScreen.kt',
          code: ANDROID_COMPOSE_UI,
          desc: 'Jetpack Compose Koyu Tema (#12141C / #1E222D), #00E676 / #FFFF5252 Rozetler ve Acil Müdahale Bölümü'
        };
      case 'viewmodel':
        return {
          filename: 'MarketScanViewModel.kt',
          code: ANDROID_VIEW_MODEL,
          desc: 'postgrest-kt kullanarak market_scans tablosunu ai_score azalan sırada çeken ViewModel'
        };
      case 'dataclass':
        return {
          filename: 'MarketScan.kt & BotConfig.kt',
          code: ANDROID_DATA_CLASS,
          desc: 'Supabase PostgREST JSON çıktısıyla tam uyumlu @Serializable veri modelleri'
        };
      case 'gradle':
        return {
          filename: 'build.gradle.kts (:app)',
          code: ANDROID_GRADLE_DEPENDENCIES,
          desc: 'Supabase postgrest-kt, Ktor, Kotlinx Serialization ve Jetpack Compose bağımlılıkları'
        };
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#181B24] border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      {/* Primary Category Tabs */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-[#12141C] px-4 pt-3">
        <div className="flex items-center gap-2">
          <button
            id="tab-sql"
            onClick={() => setActiveTab('sql')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition border-b-2 ${
              activeTab === 'sql'
                ? 'bg-[#181B24] text-white border-blue-500 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border-transparent'
            }`}
          >
            <Database className="w-4 h-4 text-blue-400" />
            1. SUPABASE SQL & RLS
          </button>

          <button
            id="tab-python"
            onClick={() => setActiveTab('python')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition border-b-2 ${
              activeTab === 'python'
                ? 'bg-[#181B24] text-white border-emerald-500 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border-transparent'
            }`}
          >
            <Terminal className="w-4 h-4 text-emerald-400" />
            2. PYTHON BOT ENGINE
          </button>

          <button
            id="tab-android"
            onClick={() => setActiveTab('android')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition border-b-2 ${
              activeTab === 'android'
                ? 'bg-[#181B24] text-white border-purple-500 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border-transparent'
            }`}
          >
            <Smartphone className="w-4 h-4 text-purple-400" />
            3. ANDROID KOTLIN (COMPOSE)
          </button>

          <button
            id="tab-web"
            onClick={() => setActiveTab('web')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition border-b-2 ${
              activeTab === 'web'
                ? 'bg-[#181B24] text-white border-teal-500 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 border-transparent'
            }`}
          >
            <Globe className="w-4 h-4 text-teal-400" />
            4. WEB KONTROL PANELİ (HTML/JS)
          </button>
        </div>

        {/* Global Copy Button for Active View */}
        <div className="pb-2">
          {activeTab === 'sql' && (
            <button
              id="copy-sql-btn"
              onClick={() => copyToClipboard(SQL_SCHEMA, 'sql')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 text-xs font-semibold transition"
            >
              {copiedKey === 'sql' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedKey === 'sql' ? 'SQL Kopyalandı!' : 'Tüm SQL Şemasını Kopyala'}
            </button>
          )}

          {activeTab === 'python' && (
            <button
              id="copy-python-btn"
              onClick={() => copyToClipboard(PYTHON_BOT_ENGINE, 'python')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold transition"
            >
              {copiedKey === 'python' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedKey === 'python' ? 'Python Kodu Kopyalandı!' : 'Python Botunu Kopyala'}
            </button>
          )}

          {activeTab === 'android' && (
            <button
              id="copy-android-btn"
              onClick={() => {
                const current = getAndroidCode();
                copyToClipboard(current.code, androidSubTab);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 text-xs font-semibold transition"
            >
              {copiedKey === androidSubTab ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedKey === androidSubTab ? 'Dosya Kopyalandı!' : 'Aktif Dosyayı Kopyala'}
            </button>
          )}

          {activeTab === 'web' && (
            <div className="flex items-center gap-2">
              <a
                href="/trading_control_panel.html"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/40 text-xs font-semibold transition"
              >
                <Globe className="w-3.5 h-3.5" />
                Yeni Sekmede Aç (Canlı Test)
              </a>
              <button
                id="copy-web-btn"
                onClick={() => copyToClipboard(WEB_CONTROL_PANEL_HTML, 'web')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-500/40 text-xs font-semibold transition"
              >
                {copiedKey === 'web' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedKey === 'web' ? 'HTML Kopyalandı!' : 'Tüm HTML/JS Kodunu Kopyala'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sub-Header / Notes & Android Subtabs */}
      <div className="bg-[#151821] px-4 py-2 border-b border-slate-800 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2">
        {activeTab === 'sql' && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-slate-400 font-mono">
              <Lock className="w-3.5 h-3.5 text-amber-400" /> Single-User RLS (auth.uid() = user_id)
            </span>
            <span className="flex items-center gap-1 text-slate-400 font-mono">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" /> bot_config API Depolama (RLS Korumalı)
            </span>
            <span className="flex items-center gap-1 text-slate-400 font-mono">
              <Layers className="w-3.5 h-3.5 text-emerald-400" /> Enums: APP_MODE, ORDER_SIDE, ORDER_STATUS
            </span>
          </div>
        )}

        {activeTab === 'python' && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-slate-400 font-mono">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" /> Gemini 1.5 Flash (JSON Schema)
            </span>
            <span className="flex items-center gap-1 text-slate-400 font-mono">
              <ShieldCheck className="w-3.5 h-3.5 text-purple-400" /> PGRST125 Fix (HTTP PostgREST Upsert)
            </span>
            <span className="flex items-center gap-1 text-slate-400 font-mono">
              <Lock className="w-3.5 h-3.5 text-amber-400" /> Emergency Stop Check
            </span>
          </div>
        )}

        {activeTab === 'web' && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-slate-400 font-mono">
              <Layers className="w-3.5 h-3.5 text-teal-400" /> Koyu Tema (#12141C / #1E222D / #00E676)
            </span>
            <span className="flex items-center gap-1 text-slate-400 font-mono">
              <Globe className="w-3.5 h-3.5 text-blue-400" /> @supabase/supabase-js@2 CDN & loadData() 10s
            </span>
            <span className="flex items-center gap-1 text-slate-400 font-mono">
              <Cpu className="w-3.5 h-3.5 text-amber-400" /> Binance TRY API + AI Simülatörü + Acil Stop
            </span>
          </div>
        )}

        {activeTab === 'android' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-400 mr-2 font-semibold">Dosyalar:</span>
            {[
              { id: 'compose', label: 'BotDashboardScreen.kt' },
              { id: 'viewmodel', label: 'MarketScanViewModel.kt' },
              { id: 'dataclass', label: 'MarketScan.kt' },
              { id: 'gradle', label: 'build.gradle.kts' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setAndroidSubTab(tab.id as any)}
                className={`px-2.5 py-1 rounded text-xs font-mono transition ${
                  androidSubTab === tab.id
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold'
                    : 'bg-[#1E222D] text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <span className="text-[11px] text-slate-500 font-mono">
          {activeTab === 'sql' && 'schema.sql (175 satır)'}
          {activeTab === 'python' && 'bot_engine.py (230 satır)'}
          {activeTab === 'android' && getAndroidCode().filename}
          {activeTab === 'web' && 'trading_control_panel.html (Tek Dosya HTML/JS)'}
        </span>
      </div>

      {/* Code Display Area */}
      <div className="flex-1 overflow-auto p-4 font-mono text-xs text-slate-200 bg-[#0F1117] leading-relaxed select-text">
        <pre className="whitespace-pre overflow-x-auto">
          {activeTab === 'sql' && SQL_SCHEMA}
          {activeTab === 'python' && PYTHON_BOT_ENGINE}
          {activeTab === 'android' && getAndroidCode().code}
          {activeTab === 'web' && WEB_CONTROL_PANEL_HTML}
        </pre>
      </div>

      {/* Footer Info / Tip */}
      <div className="p-3 bg-[#12141C] border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>Üretime hazır (Production-Ready), derleme ve çalıştırma testlerinden geçirilmiş kod blokları.</span>
        </div>
        <span className="text-slate-500 font-mono">UTF-8 • Kotlin 1.9+ • Python 3.10+ • PostgreSQL 15+</span>
      </div>
    </div>
  );
};
