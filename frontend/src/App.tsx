import { useState, useRef } from 'react';

export default function App() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [liveStatus, setLiveStatus] = useState<{ step: string; message: string; state: string }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const startAnalysis = () => {
    if (!query.trim()) return;

    setLoading(true);
    setReport(null);
    setLiveStatus([]);

    const ws = new WebSocket('ws://127.0.0.1:8000/ws/analyze');
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ query }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'status') {
          setLiveStatus(prev => {
            const index = prev.findIndex(item => item.step === data.step);
            if (index !== -1) {
              const updated = [...prev];
              updated[index] = { ...updated[index], state: data.state };
              return updated;
            } else {
              return [...prev, { step: data.step, message: `Running ${data.step}...`, state: data.state }];
            }
          });
        } else if (data.type === 'progress') {
          setLiveStatus(prev => {
            const index = prev.findIndex(item => item.step === data.step);
            if (index !== -1) {
              const updated = [...prev];
              updated[index] = { ...updated[index], message: data.message };
              return updated;
            } else {
              return [...prev, { step: data.step, message: data.message, state: 'running' }];
            }
          });
        } else if (data.type === 'result') {
          setReport(data.report);
          setLoading(false);
          ws.close();
        } else if (data.type === 'error') {
          setLiveStatus(prev => [...prev, { step: 'error', message: data.message, state: 'error' }]);
          setLoading(false);
          ws.close();
        }
      } catch (e) {
        console.error("Failed to parse WS message", e);
      }
    };

    ws.onerror = () => {
      setLiveStatus(prev => [...prev, { step: 'connection', message: 'Backend connection failed.', state: 'error' }]);
      setLoading(false);
    };
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans p-8 md:p-16">
      <div className="max-w-2xl mx-auto">
        
        {/* Simple Header */}
        <div className="mb-8">
          <h1 className="text-xl font-bold text-black tracking-tight mb-1">Litmus</h1>
          <p className="text-sm text-gray-500">Autonomous company verification and job authenticity engine.</p>
        </div>

        {/* Input Form */}
        <div className="space-y-3 mb-8">
          <input 
            type="text" 
            className="w-full px-4 py-3 rounded border border-gray-300 text-sm focus:outline-none focus:border-black transition-colors"
            placeholder="Enter company name (e.g. Zomato) or job URL..." 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && startAnalysis()}
          />
          <button 
            onClick={startAnalysis} 
            className="w-full bg-black text-white py-3 rounded text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
            disabled={loading}
          >
            {loading ? 'Scanning public records...' : 'Run Verification'}
          </button>
        </div>

        {/* Terminal Logs during loading */}
        {loading && (
          <div className="bg-gray-50 border border-gray-200 p-4 rounded text-xs font-mono text-gray-700 space-y-2 mb-8">
            <div className="text-gray-400 pb-1 border-b border-gray-200">Execution Logs</div>
            {liveStatus.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center">
                <span>[{item.step}] {item.message}</span>
                <span className="text-gray-400 capitalize">{item.state}</span>
              </div>
            ))}
          </div>
        )}

        {/* Results Section */}
        {report && !loading && (
          <div className="space-y-6 pt-4 border-t border-gray-100">
            
            {/* Main Score Box */}
            <div className="flex justify-between items-baseline">
              <div>
                <h2 className="text-lg font-bold text-black">{report.company}</h2>
                <p className="text-xs text-gray-500 mt-0.5">Status: <span className="text-black font-medium">{report.verdict}</span></p>
              </div>
              <div className="text-right">
                <span className="text-3xl font-bold text-black">{report.total}</span>
                <span className="text-sm text-gray-400"> / 100</span>
              </div>
            </div>

            {/* Metrics List */}
            <div className="grid grid-cols-3 gap-4 py-4 border-y border-gray-100 text-xs">
              <div>
                <div className="text-gray-400 mb-1">Legal / MCA</div>
                <div className="font-bold text-black">{report.breakdown.legal ? `${report.breakdown.legal.score}/${report.breakdown.legal.max}` : 'N/A'}</div>
                <div className="text-gray-500 truncate mt-0.5">{report.details?.legal?.found ? report.details.legal.cin : 'Unregistered'}</div>
              </div>
              <div>
                <div className="text-gray-400 mb-1">Hiring Velocity</div>
                <div className="font-bold text-black">{report.breakdown.velocity ? `${report.breakdown.velocity.score}/${report.breakdown.velocity.max}` : 'N/A'}</div>
                <div className="text-gray-500 mt-0.5">{report.details?.velocity?.openings_listed || 0} openings</div>
              </div>
              <div>
                <div className="text-gray-400 mb-1">Sentiment</div>
                <div className="font-bold text-black">{report.breakdown.sentiment ? `${report.breakdown.sentiment.score}/${report.breakdown.sentiment.max}` : 'N/A'}</div>
                <div className="text-gray-500 mt-0.5">{Object.keys(report.details?.sentiment?.risk_hits || {}).length} risk flags</div>
              </div>
            </div>

            {/* Flags */}
            {report.flags && report.flags.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-black uppercase tracking-wider mb-2">Flags</h3>
                <ul className="text-xs text-gray-600 space-y-1">
                  {report.flags.map((flag: string, idx: number) => (
                    <li key={idx}>- {flag}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Sources */}
            {report.sources && report.sources.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-black uppercase tracking-wider mb-2">Sources</h3>
                <div className="space-y-1">
                  {report.sources.map((src: any, idx: number) => (
                    <div key={idx} className="text-xs truncate">
                      <a href={src.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                        {src.label}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

      </div>
    </div>
  );
}