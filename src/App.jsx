import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, ShieldAlert, Check, X, ChevronRight, AlertTriangle, Loader2, MapPin, User, Calendar } from 'lucide-react';

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
  // 1. Prepare Jumio Data
  const docData = {
    firstName: jumioData.document?.firstName || '',
    lastName: jumioData.document?.lastName || '',
    dob: jumioData.document?.dob || '', 
    postcode: jumioData.document?.address?.postalCode || '',
    // Jumio returns address parts. We try to grab the full line, or combine parts
    addressLine: jumioData.document?.address?.line1 || '', 
    city: jumioData.document?.address?.city || '',
    type: jumioData.document?.type || 'UNKNOWN',
    country: jumioData.document?.issuingCountry || 'UNKNOWN'
  };

  // 2. Prepare User Registration Data
  // We combine House No + Street to compare against the Doc's "Line 1"
  const regFullAddress = `${regData.houseNo} ${regData.street}`.trim();

  const report = { passed: false, checks: [] };

  // --- CHECK 1: DOB (Exact) ---
  const dobMatch = regData.dob === docData.dob;
  report.checks.push({
    field: 'Date of Birth', reg: regData.dob, doc: docData.dob, match: dobMatch, 
    message: dobMatch ? 'Match' : 'Mismatch'
  });

  // --- CHECK 2: Postcode (Exact Normalized) ---
  const regPC = normalizePostcode(regData.postcode);
  const docPC = normalizePostcode(docData.postcode);
  const pcMatch = regPC === docPC;
  report.checks.push({
    field: 'Postcode', reg: regPC, doc: docPC, match: pcMatch, 
    message: pcMatch ? 'Match' : 'Mismatch'
  });

  // --- CHECK 3: Last Name (Fuzzy > 85%) ---
  const lnSim = calculateSimilarity(regData.lastName, docData.lastName);
  const lnMatch = lnSim >= 85;
  report.checks.push({
    field: 'Last Name', reg: regData.lastName, doc: docData.lastName, match: lnMatch, 
    message: `Similarity: ${lnSim.toFixed(0)}%`
  });

  // --- CHECK 4: First Name (Fuzzy > 85%) ---
  const fnSim = calculateSimilarity(regData.firstName, docData.firstName);
  const fnMatch = fnSim >= 85;
  report.checks.push({
    field: 'First Name', reg: regData.firstName, doc: docData.firstName, match: fnMatch, 
    message: `Similarity: ${fnSim.toFixed(0)}%`
  });

  // --- CHECK 5: Address (Fuzzy > 70%) ---
  // Comparing "10 Downing St" (User) vs "10 Downing Street" (Doc)
  const adSim = calculateSimilarity(regFullAddress, docData.addressLine);
  const adMatch = adSim >= 70;
  report.checks.push({
    field: 'Address Match', reg: regFullAddress, doc: docData.addressLine, match: adMatch, 
    message: `Similarity: ${adSim.toFixed(0)}%`
  });

  // --- CHECK 6: City (Fuzzy > 80%) ---
  // Optional but good to check
  const citySim = calculateSimilarity(regData.city, docData.city);
  const cityMatch = citySim >= 80;
  report.checks.push({
    field: 'City', reg: regData.city, doc: docData.city, match: cityMatch,
    message: `Similarity: ${citySim.toFixed(0)}%`
  });


  // --- CHECK 7: Document Rules ---
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

  // Final Pass Requirement
  report.passed = dobMatch && pcMatch && lnMatch && fnMatch && adMatch && docValid;
  return report;
};

// --- APP COMPONENT ---
export default function App() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Updated State for new Address Fields
  const [regData, setRegData] = useState({ 
    firstName: '', 
    lastName: '', 
    dob: '', 
    houseNo: '',
    street: '',
    flat: '',
    postcode: '',
    city: ''
  });

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
        body: JSON.stringify({ userEmail: 'user_test_01' })
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
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans selection:bg-green-100">
      <header className="bg-white border-b py-4 px-6 flex justify-between items-center sticky top-0 z-50">
        <div className="font-bold text-xl">Jumio<span className="text-green-600">Flow</span></div>
        <div className="text-xs bg-gray-100 px-2 py-1 rounded">Step: {step}</div>
      </header>
      
      <main className="max-w-xl mx-auto p-6 mt-8">
        
        {/* --- STEP 1: REGISTER --- */}
        {step === 1 && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
            <h1 className="text-2xl font-bold mb-6 text-gray-900">Register</h1>
            
            <div className="space-y-5">
              {/* Name Section */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase">First Name</label>
                  <input type="text" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" 
                    value={regData.firstName} onChange={e => setRegData({...regData, firstName: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase">Last Name</label>
                  <input type="text" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" 
                    value={regData.lastName} onChange={e => setRegData({...regData, lastName: e.target.value})} />
                </div>
              </div>

              {/* DOB */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Date of Birth</label>
                <div className="relative">
                  <input type="date" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" 
                    value={regData.dob} onChange={e => setRegData({...regData, dob: e.target.value})} />
                  <Calendar className="absolute right-3 top-3 text-gray-400 pointer-events-none" size={18} />
                </div>
              </div>

              <div className="border-t border-gray-100 my-4"></div>

              {/* Address Row 1: No + Street */}
              <div className="flex gap-4">
                <div className="w-1/4 space-y-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase">No</label>
                  <input type="text" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" 
                    placeholder="10"
                    value={regData.houseNo} onChange={e => setRegData({...regData, houseNo: e.target.value})} />
                </div>
                <div className="w-3/4 space-y-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase">Street</label>
                  <input type="text" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" 
                    placeholder="Downing Street"
                    value={regData.street} onChange={e => setRegData({...regData, street: e.target.value})} />
                </div>
              </div>

              {/* Address Row 2: Flat Number */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-500 uppercase">Flat number</label>
                <input type="text" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" 
                  placeholder="Apt 4B (Optional)"
                  value={regData.flat} onChange={e => setRegData({...regData, flat: e.target.value})} />
              </div>

              {/* Address Row 3: Postcode + City */}
              <div className="flex gap-4">
                <div className="w-1/3 space-y-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase">Postcode</label>
                  <input type="text" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" 
                    placeholder="SW1A 2AA"
                    value={regData.postcode} onChange={e => setRegData({...regData, postcode: e.target.value})} />
                </div>
                <div className="w-2/3 space-y-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase">City</label>
                  <input type="text" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" 
                    placeholder="London"
                    value={regData.city} onChange={e => setRegData({...regData, city: e.target.value})} />
                </div>
              </div>

            </div>

            <button onClick={() => setStep(2)} 
              disabled={!regData.postcode || !regData.street || !regData.houseNo} 
              className="mt-8 w-full bg-green-600 text-white py-4 rounded-xl font-bold hover:bg-green-700 shadow-lg shadow-green-100 transition disabled:opacity-50 disabled:cursor-not-allowed">
              Next Step
            </button>
          </div>
        )}

        {/* --- STEP 2: GBG FAIL --- */}
        {step === 2 && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center py-12">
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <ShieldAlert size={32} className="text-amber-500" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Verification Required</h2>
            <p className="text-gray-500 mb-8 max-w-xs mx-auto">We couldn't verify your details automatically. Please upload a document.</p>
            <button onClick={() => { setStep(3); startJumio(); }} className="w-full bg-green-600 text-white py-4 rounded-xl font-bold hover:bg-green-700 shadow-lg shadow-green-100 transition">
              Start ID Verification
            </button>
          </div>
        )}

        {/* --- STEP 3: JUMIO CONTAINER --- */}
        {step === 3 && (
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-200">
            <div className="bg-slate-900 text-white p-4 font-bold flex items-center gap-2">
              <ShieldCheck size={18}/> Identity Verification
            </div>
            <div className="p-4 min-h-[500px] flex flex-col items-center justify-center bg-gray-50">
              <div ref={jumioContainerRef} className="w-full"></div>
              {loading && !error && (
                <div className="text-center">
                  <Loader2 className="animate-spin text-green-600 mx-auto mb-2" size={32} /> 
                  <p className="text-gray-500 text-sm">Initializing Secure Environment...</p>
                </div>
              )}
              {error && <div className="text-red-500 font-bold bg-red-50 p-6 rounded-xl border border-red-100">{error}</div>}
            </div>
          </div>
        )}

        {/* --- STEP 4: RESULTS --- */}
        {step === 4 && matchReport && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 ${matchReport.passed ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
              {matchReport.passed ? <Check size={32} /> : <X size={32} />}
            </div>
            <h2 className="text-2xl font-bold text-center mb-2">{matchReport.passed ? 'Verification Passed' : 'Verification Failed'}</h2>
            <p className="text-center text-gray-400 text-sm mb-8">Detailed logic breakdown</p>
            
            <div className="space-y-3">
              {matchReport.checks.map((check, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <span className="font-medium text-sm text-gray-700">{check.field}</span>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${check.match ? 'text-green-600' : 'text-red-600'}`}>
                      {check.match ? 'Pass' : 'Fail'}
                    </div>
                    <div className="text-xs text-gray-400">{check.message}</div>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => window.location.reload()} className="mt-8 w-full border border-gray-200 text-gray-600 py-3 rounded-xl font-bold hover:bg-gray-50 transition">
              Start Again
            </button>
          </div>
        )}

      </main>
    </div>
  );
}