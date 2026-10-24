import { useState, useEffect } from 'react';

export default function App() {
  const [jobUrl, setJobUrl] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [liveStatus, setLiveStatus] = useState<string[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/history');
      const data = await res.json();
      setHistory(data);
    } catch (e) {
      console.error("Failed to fetch history");
    }
  };

  const analyzeJob = async () => {
    if (!jobUrl && !companyName) return;
    
    setLoading(true);
    setResult(null);
    setLiveStatus([]); 

    const ws = new WebSocket('ws://127.0.0.1:8000/ws/status');
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLiveStatus(prev => [...prev, data.message]);
      } catch (e) {
        setLiveStatus(prev => [...prev, event.data]);
      }
    };

    try {
      const response = await fetch('http://127.0.0.1:8000/api/submit-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          job_url: jobUrl || "https://example.com", 
          company_name: companyName || "Auto-detected" 
        })
      });
      
      const data = await response.json();
      setResult(data);
      fetchHistory();
    } catch (error) {
      setLiveStatus(prev => [...prev, "Error: Failed to connect to backend engine."]);
    }
    
    ws.close();
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-white flex font-sans text-gray-900">
      
      {/* Main Content Area */}
      <div className="flex-1 p-10 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          
          <div className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-black mb-1">Litmus</h1>
            <p className="text-sm text-gray-500 mb-6">Autonomous verification engine for companies and job listings.</p>
            
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  className="flex-1 px-4 py-2.5 rounded-md border border-gray-300 text-sm focus:outline-none focus:border-black"
                  placeholder="Company Name (e.g. Zomato)" 
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
                <input 
                  type="text" 
                  className="flex-1 px-4 py-2.5 rounded-md border border-gray-300 text-sm focus:outline-none focus:border-black"
                  placeholder="Job URL (Optional)" 
                  value={jobUrl}
                  onChange={(e) => setJobUrl(e.target.value)}
                />
              </div>
              <button 
                onClick={analyzeJob} 
                className="bg-black text-white px-4 py-2.5 rounded-md text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
                disabled={loading}
              >
                {loading ? 'Analyzing Records...' : 'Run Verification'}
              </button>
            </div>
          </div>

          {/* Live Terminal */}
          {loading && (
            <div className="bg-gray-50 border border-gray-200 text-gray-700 p-4 rounded-md font-mono text-xs max-w-none shadow-sm mb-6">
              <div className="text-gray-400 mb-2 pb-1 border-b border-gray-200">System Execution Logs</div>
              {liveStatus.map((msg, idx) => (
                <div key={idx} className="py-0.5">&gt; {msg}</div>
              ))}
              <div className="animate-pulse mt-1 text-gray-500">&gt; processing...</div>
            </div>
          )}

          {/* Result Dashboard */}
          {result && !loading && (
            <div className="space-y-6 mt-6">
              <div className="bg-gray-50 p-6 rounded-md border border-gray-200 flex justify-between items-center">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Verified Entity</div>
                  <div className="text-xl font-semibold text-black">{result.company_name}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Reality Score</div>
                  <div className="text-3xl font-semibold text-black">
                    {result.reality_score.total_score} <span className="text-sm font-normal text-gray-400">/ 100</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-md border border-gray-200">
                  <div className="text-xs font-medium text-gray-500 mb-1">Legal Status</div>
                  <div className="text-2xl font-semibold text-black mb-2">{result.reality_score.s_legal}</div>
                  <div className="text-xs text-gray-600">
                    {result.raw_extraction.mca_verified ? 'Registered Entity (MCA)' : 'Unregistered'}
                  </div>
                </div>
                
                <div className="bg-white p-4 rounded-md border border-gray-200">
                  <div className="text-xs font-medium text-gray-500 mb-1">Velocity Metrics</div>
                  <div className="text-2xl font-semibold text-black mb-2">{result.reality_score.s_velocity}</div>
                  <div className="text-xs text-gray-600">
                    Hires: {result.raw_extraction.linkedin_hires} | Openings: {result.raw_extraction.linkedin_openings}
                  </div>
                </div>

                <div className="bg-white p-4 rounded-md border border-gray-200">
                  <div className="text-xs font-medium text-gray-500 mb-1">Sentiment & Flags</div>
                  <div className="text-2xl font-semibold text-black mb-2">{result.reality_score.s_sentiment}</div>
                  <div className="text-xs text-gray-600 truncate">
                    {result.raw_extraction.reddit_flags.length === 0 ? 'No major flags' : result.raw_extraction.reddit_flags[0]}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sidebar: Recent Scans */}
      <div className="w-72 bg-gray-50 border-l border-gray-200 p-6 overflow-y-auto">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">
          Scan History
        </h3>
        {history.length === 0 ? (
          <p className="text-xs text-gray-400">No records found.</p>
        ) : (
          <div className="space-y-2">
            {history.map((item, idx) => (
              <div key={idx} className="p-3 bg-white border border-gray-200 rounded-md hover:border-gray-400 cursor-pointer transition-all" onClick={() => {setResult(item); setCompanyName(item.company_name);}}>
                <div className="flex justify-between items-center mb-1">
                  <span className="font-medium text-xs text-black truncate">{item.company_name}</span>
                  <span className="text-xs font-semibold text-gray-700">
                    {item.reality_score.total_score}
                  </span>
                </div>
                <div className="text-[10px] text-gray-400 truncate">{item.job_url}</div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}