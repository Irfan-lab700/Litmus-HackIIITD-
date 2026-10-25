import { useState, useRef } from 'react';

export default function App() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [entityChoices, setEntityChoices] = useState<any[] | null>(null);
  const [report, setReport] = useState<any>(null);
  const [liveStatus, setLiveStatus] = useState<{ step: string; message: string; state: string }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const handleVerifyClick = async () => {
    if (!query.trim()) return;

    if (query.trim().startsWith("http://") || query.trim().startsWith("https://")) {
      runAnalysis(query.trim());
      return;
    }

    setLoading(true);
    setEntityChoices(null);
    setReport(null);

    try {
      const res = await fetch('http://127.0.0.1:8000/api/search-entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      
      if (data.type === 'choices' && data.entities && data.entities.length > 0) {
        setEntityChoices(data.entities);
        setLoading(false);
      } else if (data.type === 'resolved') {
        runAnalysis(data.company);
      } else {
        runAnalysis(query);
      }
    } catch (err) {
      runAnalysis(query);
    }
  };

  const runAnalysis = (targetCompany: string) => {
    setEntityChoices(null);
    setLoading(true);
    setReport(null);
    setLiveStatus([]);

    const ws = new WebSocket('ws://127.0.0.1:8000/ws/analyze');
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ query: targetCompany }));
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
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold text-black tracking-tight mb-2">Litmus</h1>
          <p className="text-xs text-gray-500">Autonomous company verification and job authenticity engine.</p>
        </div>

        {/* Input Form */}
        <div className="space-y-3 mb-8">
          <input 
            type="text" 
            className="w-full px-4 py-3 rounded border border-gray-300 text-sm focus:outline-none focus:border-black transition-colors"
            placeholder="Enter company name (e.g. Oracle) or job URL..." 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleVerifyClick()}
          />
          <button 
            onClick={handleVerifyClick} 
            className="w-full bg-black text-white py-3 rounded text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
            disabled={loading}
          >
            {loading ? 'Processing records...' : 'Run Verification'}
          </button>
        </div>

        {/* Entity Disambiguation Picker Box */}
        {entityChoices && (
          <div className="border border-gray-300 bg-gray-50 p-5 rounded mb-8">
            <h3 className="text-xs font-bold text-black uppercase tracking-wider mb-1">Multiple Entities Found</h3>
            <p className="text-xs text-gray-600 mb-4">Select the exact registered entity for "{query}":</p>
            <div className="space-y-2">
              {entityChoices.map((entity, idx) => (
                <div 
                  key={idx} 
                  onClick={() => runAnalysis(`${entity.name} (${entity.cin})`)}
                  className="p-3 bg-white border border-gray-200 rounded hover:border-black cursor-pointer transition-all flex justify-between items-center"
                >
                  <div>
                    <div className="font-bold text-xs text-black">{entity.name}</div>
                    <div className="text-[10px] text-gray-500 font-mono mt-0.5">CIN: {entity.cin}</div>
                  </div>
                  <span className="text-[10px] font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                    {entity.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Terminal Logs during loading */}
        {loading && !entityChoices && (
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
          <div className="space-y-6 pt-4 border-t border-gray-200">
            
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

            {/* Profile Attributes */}
            {report.details?.legal && (
              <div className="bg-gray-50 p-4 rounded border border-gray-200 text-xs grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-gray-400">Incorporation</div>
                  <div className="font-bold text-black mt-0.5">{report.details.legal.incorporation_year || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-gray-400">Entity Type</div>
                  <div className="font-bold text-black mt-0.5">{report.details.legal.company_type || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-gray-400">State</div>
                  <div className="font-bold text-black mt-0.5">{report.details.legal.state || 'India'}</div>
                </div>
                <div>
                  <div className="text-gray-400">Compliance</div>
                  <div className="font-bold text-black mt-0.5">{report.details.legal.status || 'Active'}</div>
                </div>
              </div>
            )}

            {/* Metrics List */}
            <div className="grid grid-cols-3 gap-4 py-4 border-y border-gray-200 text-xs">
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