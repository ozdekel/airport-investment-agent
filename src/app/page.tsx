'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Plane, Loader2, Bot, BarChart3, Plus, MessageSquare, Terminal, ShieldCheck, ShieldAlert, Clock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAnalysis } from '@/lib/useAnalysis';
import { ScoreCard } from '@/components/ScoreCard';
import { MethodologyPanel } from '@/components/MethodologyPanel';

/** The four questions from the assignment brief, plus two follow-ups that
 *  demonstrate conversational memory and human-in-the-loop reweighting. */
const EXAMPLES = [
  'Which airports in New England are the strongest candidates for terminal expansion?',
  'Compare LHR and DXB on congestion',
  'What share of departures from TLV are long-haul?',
  'What percentage of demand goes unmet at BOS?',
  'And what about their carrier concentration?',
  'Care more about congestion, less about growth',
];

export default function Dashboard() {
  const [sessionId, setSessionId] = useState('session-1');
  const [tab, setTab] = useState<'dashboard' | 'trace' | 'methodology'>('dashboard');
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const { messages, scores, weights, stage, trace, busy, elapsedMs, send, reset } = useAnalysis(sessionId);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, stage]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    send(q);
  };

  const weightSummary = useMemo(
    () => weights ? Object.entries(weights).map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').trim()} ${(v * 100).toFixed(0)}%`).join(' | ') : null,
    [weights],
  );

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      <aside className="w-60 bg-slate-900 text-slate-300 flex flex-col flex-none border-r border-slate-800">
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center gap-3 mb-5 mt-1 px-1">
            <div className="bg-blue-600 p-1.5 rounded-lg text-white"><Plane size={18} /></div>
            <div>
              <h1 className="text-sm font-bold text-white leading-tight">AeroInvest</h1>
              <p className="text-[9px] text-slate-400 font-semibold tracking-wider">EXPANSION SCREENING</p>
            </div>
          </div>
          <button
            onClick={() => { const id = `session-${Date.now()}`; setSessionId(id); reset(); }}
            className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white py-2 rounded-xl text-xs font-medium transition-colors border border-slate-700"
          >
            <Plus size={14} /> New session
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div>
            <p className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider px-1 mb-2">Try asking</p>
            <div className="space-y-1">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => !busy && send(ex)}
                  disabled={busy}
                  className="w-full text-left px-2.5 py-2 rounded-lg text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors disabled:opacity-40 leading-snug"
                >
                  <MessageSquare size={11} className="inline mr-1.5 opacity-50" />{ex}
                </button>
              ))}
            </div>
          </div>

          {weightSummary && (
            <div className="px-1 pt-3 border-t border-slate-800">
              <p className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Active weights</p>
              <p className="text-[10px] text-slate-400 leading-relaxed capitalize">{weightSummary}</p>
              <p className="text-[9px] text-slate-600 mt-1.5 italic">Ask me to change these in plain English.</p>
            </div>
          )}
        </div>

        {elapsedMs !== null && (
          <div className="p-3 border-t border-slate-800 text-[10px] text-slate-500 flex items-center gap-1.5">
            <Clock size={11} /> last analysis {(elapsedMs / 1000).toFixed(1)}s
          </div>
        )}
      </aside>

      <main className="flex-1 flex overflow-hidden p-4 md:p-5 gap-5">
        <div className={`${tab === 'methodology' ? 'hidden' : 'w-full lg:w-[42%] flex'} flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden`}>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 flex-none mt-1">
                    <Bot size={14} />
                  </div>
                )}
                <div className={msg.role === 'user' ? 'max-w-[85%]' : 'max-w-full flex-1'}>
                  <div className={`px-4 py-3 rounded-2xl text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-none font-medium'
                      : 'bg-slate-50 text-slate-700 rounded-bl-none border border-slate-100 brief'
                  }`}>
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                  {msg.role === 'assistant' && msg.origin && (
                    <div className="flex items-center gap-1 mt-1 px-1 text-[9px] uppercase tracking-wider">
                      {msg.guardrail?.passed !== false ? (
                        <><ShieldCheck size={10} className="text-emerald-500" /><span className="text-slate-400">
                          {msg.origin === 'llm' ? 'LLM narration, grounded' : 'Deterministic summary'}
                        </span></>
                      ) : (
                        <><ShieldAlert size={10} className="text-amber-500" /><span className="text-amber-600">
                          Guardrail caught a hallucination - showing computed values
                        </span></>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {busy && stage && (
              <div className="flex gap-2.5 justify-start">
                <div className="w-7 h-7 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 flex-none mt-1">
                  <Loader2 size={14} className="animate-spin" />
                </div>
                <div className="px-3.5 py-2.5 rounded-2xl bg-slate-50 text-slate-500 rounded-bl-none border border-slate-100 text-xs">
                  {stage.message}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={submit} className="p-3 bg-white border-t border-slate-100 relative flex items-center">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about an airport, country or continent..."
              className="w-full pl-4 pr-12 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-xs bg-slate-50/50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="absolute right-5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white p-1.5 rounded-lg transition-colors"
            >
              <Send size={15} />
            </button>
          </form>
        </div>

        <div className={`${tab === 'methodology' ? 'flex' : 'hidden lg:flex'} flex-1 flex-col overflow-hidden gap-4`}>
          <div className="flex gap-1 bg-white p-1 rounded-2xl border border-slate-200 flex-none">
            {([['dashboard', 'Live Analytics'], ['trace', 'Pipeline Trace'], ['methodology', 'Methodology & Design']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 py-2 text-[11px] font-bold uppercase tracking-wider rounded-xl transition-all ${
                  tab === key ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            {tab === 'dashboard' && (
              <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50">
                  <BarChart3 size={15} className="text-blue-600" />
                  <h2 className="font-bold text-[11px] uppercase tracking-wider text-slate-700">Expansion Candidate Scores</h2>
                  {scores && <span className="ml-auto text-[10px] text-slate-400">ranked by risk-adjusted score</span>}
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  {!scores ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
                      <BarChart3 size={36} className="opacity-20" />
                      <p className="text-xs">Ask a question to populate the dashboard.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {scores.map((s) => <ScoreCard key={s.airport.iata} data={s} />)}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'trace' && (
              <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-800 p-4 overflow-y-auto">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-800 text-blue-400">
                  <Terminal size={14} />
                  <h3 className="text-[11px] font-bold uppercase tracking-wider">Pipeline trace</h3>
                </div>
                {trace.length === 0 ? (
                  <p className="text-slate-500 text-[11px]">Nothing yet. Every data-source decision, fallback and guardrail verdict from the last run shows up here.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {trace.map((line, i) => (
                      <li key={i} className="text-[10px] font-mono text-slate-300 leading-relaxed flex gap-2">
                        <span className="text-slate-600 flex-none">{String(i + 1).padStart(2, '0')}</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            {tab === 'methodology' && <MethodologyPanel />}
          </div>
        </div>
      </main>
    </div>
  );
}
