import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, ShieldAlert, Check, X, ChevronRight, AlertTriangle, Loader2 } from 'lucide-react';

// --- UTILITIES ---
const normalizePostcode = (pc) => pc ? pc.replace(/\s+/g, '').toUpperCase() : '';

const getLevenshteinDistance = (a, b) => {
  const matrix = [];
  if (!a || !b) return 0;
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
};

const calculateSimilarity = (str1, str2) => {
  const s1 = (str1 || '').toLowerCase().trim();
  const s2 = (str2 || '').toLowerCase().trim();
  if (s1 === s2) return 100;
  if (!s1 || !s2) return 0;
  const distance = getLevenshteinDistance(s1, s2);
  const longest = Math.max(s1.length, s2.length);
  return ((longest - distance) / longest) * 100;
};

// --- MATCHING LOGIC ---
const performMatching = (regData, jumioData) => {
  const docData = {
    firstName: jumioData.document?.firstName || '',
    lastName: jumioData.document?.lastName || '',
    dob: jumioData.document?.dob || '', 
    postcode: jumioData.document?.address?.postalCode || '',
    address1: jumioData.document?.address?.line1 || '',
    type: jumioData.document?.type || 'UNKNOWN',
    country: jumioData.document?.issuingCountry || 'UNKNOWN'
  };

  const report = { passed: false, checks: [] };

  // 1. DOB (Exact)
  const dobMatch = regData.dob === docData.dob;
  report.checks.push({
    field: 'Date of Birth', reg: regData.dob, doc: docData.dob, match: dobMatch, 
    message: dobMatch ? 'Match' : 'Mismatch'
  });

  // 2. Postcode (Exact Normalized)
  const regPC = normalizePostcode(regData.postcode);
  const docPC = normalizePostcode(docData.postcode);
  const pcMatch = regPC === docPC;
  report.checks.push({
    field: 'Postcode', reg: regPC, doc: docPC, match: pcMatch, 
    message: pcMatch ? 'Match' : 'Mismatch'
  });

  // 3. Last Name (Fuzzy > 85%)
  const lnSim = calculateSimilarity(regData.lastName, docData.lastName);
  const lnMatch = lnSim >= 85;
  report.checks.push({
    field: 'Last Name', reg: regData.lastName, doc: docData.lastName, match: lnMatch, 
    message: `Similarity: ${lnSim.toFixed(0)}%`
  });

  // 4. First Name (Fuzzy > 85%)
  const fnSim = calculateSimilarity(regData.firstName, docData.firstName);
  const fnMatch = fnSim >= 85;
  report.checks.push({
    field: 'First Name', reg: regData.firstName, doc: docData.firstName, match: fnMatch, 
    message: `Similarity: ${fnSim.toFixed(0)}%`
  });

  // 5. Address (Fuzzy > 70%)
  const adSim = calculateSimilarity(regData.address1, docData.address1);
  const adMatch = adSim >= 70;
  report.checks.push({
    field: 'Address Line 1', reg: regData.address1, doc: docData.address1, match: adMatch, 
    message: `Similarity: ${adSim.toFixed(0)}%`
  });

  // 6. Logic: Document Type
  let docValid = true;
  const isUKDL = docData.type === 'DRIVING_LICENSE' && docData.country === 'GBR';
  
  if (!isUKDL) {
    report.checks.push({
      field: 'Document Rules', reg: 'UK Logic', doc: `${docData.country} ${docData.type}`, match: false, 
      message: 'Non-UK Driving License. Proof of Address required.'
    });
    docValid = false; 
  } else {
    report.checks.push({
      field: 'Document Rules', reg: 'UK Logic', doc: 'UK Driving License', match: true, 
      message: 'Address verified via License.'
    });
  }

  report.passed = dobMatch && pcMatch && lnMatch && fnMatch && adMatch && docValid;
  return report;
};

// --- APP COMPONENT ---
export default function App() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const [regData, setRegData] = useState({ firstName: '', lastName: '', dob: '', address1: '', postcode: '' });
  const [matchReport, setMatchReport] = useState(null);
  const jumioContainerRef = useRef(null);

  const startJumio = async () => {
    setLoading(true);
    setError(null);
    try {
      // CALL REAL BACKEND
      const response = await fetch('/api/jumio', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: 'user_test' })
      });
      
      if (!response.ok) throw new Error("Could not connect to Jumio backend.");
      
      const data = await response.json();
      const scanRef = data.transactionReference;

      if (window.JumioClient) {
        new window.JumioClient(jumioContainerRef.current)
          .init({
            authorizationToken: data.authorizationToken, 
            datacenter: 'US', // CHANGE TO 'EU' IF NEEDED
            success: (payload) => { fetchJumioData(scanRef); },
            error: (payload) => { 
              console.error(payload);
              setError("Verification cancelled."); 
              setLoading(false);
            }
          });
      }
    } catch (err) {
      console.error(err);
      setError(err.message);
      setLoading(false);
    }
  };

  const fetchJumioData = async (scanRef) => {
    try {
      const response = await fetch(`/api/jumio?scanReference=${scanRef}`);
      const apiData = await response.json();
      const report = performMatching(regData, apiData);
      setMatchReport(report);
      setStep(4);
    } catch (err) {
      setError("Failed to retrieve verification results.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans">
      <header className="bg-white border-b py-4 px-6 flex justify-between items-center sticky top-0 z-50">
        <div className="font-bold text-xl">Jumio<span className="text-green-600">Flow</span></div>
        <div className="text-xs bg-gray-100 px-2 py-1 rounded">Step: {step}</div>
      </header>
      <main className="max-w-2xl mx-auto p-6 mt-8">
        {step === 1 && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border">
            <h1 className="text-2xl font-bold mb-6">Register</h1>
            <div className="space-y-4">
              <input type="text" placeholder="First Name" className="w-full p-3 border rounded" value={regData.firstName} onChange={e => setRegData({...regData, firstName: e.target.value})} />
              <input type="text" placeholder="Last Name" className="w-full p-3 border rounded" value={regData.lastName} onChange={e => setRegData({...regData, lastName: e.target.value})} />
              <input type="date" className="w-full p-3 border rounded" value={regData.dob} onChange={e => setRegData({...regData, dob: e.target.value})} />
              <input type="text" placeholder="Postcode" className="w-full p-3 border rounded" value={regData.postcode} onChange={e => setRegData({...regData, postcode: e.target.value})} />
              <input type="text" placeholder="Address Line 1" className="w-full p-3 border rounded" value={regData.address1} onChange={e => setRegData({...regData, address1: e.target.value})} />
            </div>
            <button onClick={() => setStep(2)} disabled={!regData.postcode} className="mt-6 w-full bg-green-600 text-white py-3 rounded font-bold hover:bg-green-700">Next</button>
          </div>
        )}
        {step === 2 && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border text-center">
            <ShieldAlert size={48} className="mx-auto text-amber-500 mb-4" />
            <h2 className="text-2xl font-bold mb-2">Automated Check Failed</h2>
            <p className="text-gray-500 mb-6">We need to verify your identity manually.</p>
            <button onClick={() => { setStep(3); startJumio(); }} className="bg-green-600 text-white py-3 px-8 rounded font-bold hover:bg-green-700">Start ID Verification</button>
          </div>
        )}
        {step === 3 && (
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden border">
            <div className="bg-gray-900 text-white p-4 font-bold">Identity Verification</div>
            <div className="p-4 min-h-[400px] flex flex-col items-center justify-center">
              <div ref={jumioContainerRef} className="w-full"></div>
              {loading && !error && <div className="flex items-center gap-2 text-gray-500"><Loader2 className="animate-spin" /> Connecting to Jumio...</div>}
              {error && <div className="text-red-500 font-bold bg-red-50 p-4 rounded">{error}</div>}
            </div>
          </div>
        )}
        {step === 4 && matchReport && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${matchReport.passed ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
              {matchReport.passed ? <Check size={32} /> : <X size={32} />}
            </div>
            <h2 className="text-2xl font-bold text-center mb-6">{matchReport.passed ? 'Verification Passed' : 'Verification Failed'}</h2>
            <table className="w-full text-sm"><tbody>
              {matchReport.checks.map((check, i) => (
                <tr key={i} className="border-b"><td className="py-3 font-medium">{check.field}</td><td className="py-3 text-right"><span className={check.match ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{check.message}</span></td></tr>
              ))}
            </tbody></table>
          </div>
        )}
      </main>
    </div>
  );
}