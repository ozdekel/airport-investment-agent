'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Plane, Loader2, Bot, BarChart3, Plus, MessageSquare, AlertCircle, TrendingUp, Lightbulb } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  analyzedData?: any[];
};

type Session = {
  id: string;
  title: string;
  messages: Message[];
};

const LOADING_MESSAGES = [
  'Fetching live telemetry data...',
  'Running deterministic scoring engine...',
  'Applying AI safety guardrails...',
  'Generating analytical insights...',
];

const LIVE_ALERTS = [
  { id: 1, type: 'alert', text: 'DXB delayed flights spiked by 4% in the last hour. Network score downgraded.', icon: AlertCircle, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-100' },
  { id: 2, type: 'opportunity', text: 'JFK infrastructure upgrades completed. Score increased to 70.', icon: Lightbulb, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' },
  { id: 3, type: 'trending', text: 'Long-haul flights in Europe are up. Compare LHR vs CDG.', icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' }
];

export default function Dashboard() {
  const [sessions, setSessions] = useState<Session[]>([
    {
      id: 'session-1',
      title: 'Initial Analysis',
      messages: [{ id: 'welcome', role: 'assistant', content: 'Welcome to **AeroInvest AI**. I am your enterprise aviation analyst. How can I assist you today?' }]
    }
  ]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('session-1');
  
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingTextIdx, setLoadingTextIdx] = useState(0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentSession = sessions.find(s => s.id === currentSessionId)!;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession.messages]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      interval = setInterval(() => {
        setLoadingTextIdx((prev) => (prev + 1) % LOADING_MESSAGES.length);
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const handleNewSession = () => {
    const newId = `session-${Date.now()}`;
    setSessions([
      { id: newId, title: 'New Analysis', messages: [{ id: 'welcome', role: 'assistant', content: 'New session started. What would you like to analyze?' }] },
      ...sessions
    ]);
    setCurrentSessionId(newId);
  };

  const updateCurrentSession = (newMessages: Message[], title?: string) => {
    setSessions(sessions.map(s => {
      if (s.id === currentSessionId) {
        return { ...s, messages: newMessages, title: title || s.title };
      }
      return s;
    }));
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim()) return;

    const userText = inputValue;
    setInputValue('');

    const newTitle = currentSession.messages.length === 1 ? userText.slice(0, 20) + '...' : currentSession.title;
    const newMessages = [...currentSession.messages, { id: Date.now().toString(), role: 'user' as const, content: userText }];
    updateCurrentSession(newMessages, newTitle);
    
    setLoading(true);
    setLoadingTextIdx(0);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userQuery: userText }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Failed to fetch analysis');

      updateCurrentSession([...newMessages, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.aiResponse || 'No text response generated.',
        analyzedData: data.analyzedData
      }]);
    } catch (err: any) {
      updateCurrentSession([...newMessages, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${err.message}`
      }]);
    } finally {
      setLoading(false);
    }
  };

  const latestDataMessage = [...currentSession.messages].reverse().find(m => m.analyzedData && m.analyzedData.length > 0);
  const currentData = latestDataMessage?.analyzedData || null;

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col flex-none border-r border-slate-800 z-20">
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center gap-3 mb-6 mt-2 px-2">
            <div className="bg-blue-600 p-1.5 rounded-lg text-white">
              <Plane size={20} />
            </div>
            <div>
              <h1 className="text-base font-bold text-white leading-tight">AeroInvest AI</h1>
              <p className="text-[9px] text-slate-400 font-semibold tracking-wider">ENTERPRISE ANALYTICS</p>
            </div>
          </div>
          <button 
            onClick={handleNewSession}
            className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white py-2.5 rounded-xl text-sm font-medium transition-colors border border-slate-700"
          >
            <Plus size={16} /> New Analysis
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-3 mb-2 mt-2">Recent Sessions</p>
          {sessions.map(session => (
            <button
              key={session.id}
              onClick={() => setCurrentSessionId(session.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                session.id === currentSessionId 
                  ? 'bg-blue-600 text-white' 
                  : 'hover:bg-slate-800 text-slate-400'
              }`}
            >
              <MessageSquare size={16} className="flex-shrink-0" />
              <span className="truncate text-left">{session.title}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex overflow-hidden p-4 md:p-6 gap-6">
        
        {/* Left Column: Chat */}
        <div className="w-full lg:w-[45%] flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {currentSession.messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0 mt-1">
                    <Bot size={15} />
                  </div>
                )}
                <div className={`px-4 py-3 rounded-2xl max-w-[85%] text-xs leading-relaxed ${
                  msg.role === 'user' 
                    ? 'bg-blue-600 text-white rounded-br-none font-medium' 
                    : 'bg-slate-50 text-slate-700 rounded-bl-none border border-slate-100 shadow-2xs prose prose-slate prose-xs'
                }`}>
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              </div>
            ))}
            
            {loading && (
              <div className="flex gap-3 justify-start">
                <div className="w-7 h-7 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0 mt-1">
                  <Loader2 size={15} className="animate-spin" />
                </div>
                <div className="px-4 py-3 rounded-2xl bg-slate-50 text-slate-500 rounded-bl-none border border-slate-100 shadow-2xs flex items-center gap-2 text-xs">
                  <span className="animate-pulse">{LOADING_MESSAGES[loadingTextIdx]}</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 bg-white border-t border-slate-100">
            <form onSubmit={handleSend} className="relative flex items-center">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask about an airport or compare (e.g. LHR vs DXB)..."
                className="w-full pl-4 pr-12 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all text-xs bg-slate-50/50"
              />
              <button type="submit" disabled={loading || !inputValue.trim()}>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white p-2 rounded-lg transition-colors flex items-center justify-center cursor-pointer">
                  <Send size={16} />
                </div>
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Dashboard */}
        <div className="hidden lg:flex flex-1 flex-col overflow-hidden bg-slate-50/50">
          
          <div className="mb-4 bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
            <h2 className="font-bold text-[11px] uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
              Live Market Intelligence
            </h2>
            <div className="flex flex-col gap-2">
              {LIVE_ALERTS.map(alert => {
                const Icon = alert.icon;
                return (
                  <div key={alert.id} className={`flex items-start gap-3 p-3 rounded-xl border ${alert.bg} ${alert.border}`}>
                    <Icon size={16} className={`${alert.color} mt-0.5`} />
                    <p className={`text-xs font-medium ${alert.color}`}>{alert.text}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <BarChart3 size={16} className="text-blue-600" />
                <h2 className="font-bold text-xs uppercase tracking-wider text-slate-700">Asset Score Visualizer</h2>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5">
              {!currentData ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3">
                  <BarChart3 size={40} className="opacity-20" />
                  <p className="text-xs">Run an analysis in the chat to view graphical data here.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {currentData.map((data: any, idx: number) => (
                    <div key={idx} className="bg-white p-5 rounded-2xl shadow-xs border border-slate-200 hover:shadow-md transition-shadow flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start mb-5 border-b border-slate-100 pb-4">
                          <div>
                            <h3 className="text-sm font-bold text-slate-800">
                              {data.airport.name} ({data.airport.airportCode})
                            </h3>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              {data.airport.country}, {data.airport.continent}
                            </p>
                          </div>
                          <div className={`text-lg font-black w-12 h-12 rounded-xl flex items-center justify-center shadow-2xs ${
                            data.finalScore >= 70 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            data.finalScore >= 50 ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                            'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}>
                            {data.finalScore}
                          </div>
                        </div>
                        
                        {/* Graphical Progress Bars */}
                        <div className="space-y-4">
                          {/* Infrastructure Graph */}
                          <div>
                            <div className="flex justify-between text-[11px] font-semibold mb-1.5">
                              <span className="text-slate-500 uppercase tracking-wider">Infrastructure</span>
                              <span className="text-slate-800">{data.scoreBreakdown.infrastructureScore} / 100</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                              <div className="bg-blue-500 h-2 rounded-full transition-all duration-1000 ease-out" style={{ width: `${data.scoreBreakdown.infrastructureScore}%` }}></div>
                            </div>
                          </div>
                          
                          {/* Revenue Graph */}
                          <div>
                            <div className="flex justify-between text-[11px] font-semibold mb-1.5">
                              <span className="text-slate-500 uppercase tracking-wider">Revenue</span>
                              <span className="text-slate-800">{data.scoreBreakdown.revenueScore} / 100</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                              <div className="bg-emerald-500 h-2 rounded-full transition-all duration-1000 ease-out" style={{ width: `${data.scoreBreakdown.revenueScore}%` }}></div>
                            </div>
                          </div>

                          {/* Network Graph */}
                          <div>
                            <div className="flex justify-between text-[11px] font-semibold mb-1.5">
                              <span className="text-slate-500 uppercase tracking-wider">Network</span>
                              <span className="text-slate-800">{data.scoreBreakdown.networkScore} / 100</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                              <div className="bg-purple-500 h-2 rounded-full transition-all duration-1000 ease-out" style={{ width: `${data.scoreBreakdown.networkScore}%` }}></div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 pt-3 border-t border-slate-100 flex justify-between text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                        <span>Flights: {data.metrics.totalDailyFlights}</span>
                        <span>Delays: {Math.round(data.metrics.delayedFlightsPercentage * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}