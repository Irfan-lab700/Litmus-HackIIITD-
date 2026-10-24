import { useState } from 'react';

function App() {
  const [jobUrl, setJobUrl] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8000/api/submit-job', {
        method: 'POST',
      });
      const data = await response.json();
      setMessage(data.message); // Backend se aane wala message
    } catch (error) {
      console.error("Connection failed:", error);
      setMessage("Backend not connected!");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8 font-sans">
      <h1 className="text-4xl font-extrabold text-gray-800 mb-2">LITMUS</h1>
      <p className="text-gray-500 mb-8">AI-Driven Job Verification Engine</p>
      
      <div className="flex w-full max-w-lg gap-2">
        <input
          type="text"
          placeholder="Paste job posting URL here..."
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={jobUrl}
          onChange={(e) => setJobUrl(e.target.value)}
        />
        <button
          onClick={handleSubmit}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg shadow-sm transition-all"
        >
          Analyze
        </button>
      </div>

      {message && (
        <div className="mt-6 p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
          <p className="text-green-600 font-medium">{message}</p>
        </div>
      )}
    </div>
  );
}

export default App;