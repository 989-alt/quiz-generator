import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Download, Edit3, Trash2, Plus, Check, RefreshCw, AlertCircle, Key, FileSpreadsheet, Layers, Zap, X, Loader2, FileType } from 'lucide-react';

const BlooketGenerator = () => {
  const [step, setStep] = useState(1);
  const [textContent, setTextContent] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState([]); 
  const [questionCount, setQuestionCount] = useState(10);
  const [userApiKey, setUserApiKey] = useState('');
  const [questions, setQuestions] = useState([]);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  
  const fileInputRef = useRef(null);

  // 외부 라이브러리(JSZip, XLSX, PDF.js) 로드
  useEffect(() => {
    const loadScript = (src) => {
      return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
      });
    };

    Promise.all([
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'), 
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'),
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js')
    ]).then(() => {
      // PDF.js Worker 설정
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
      console.log("All libraries loaded");
      setLibraryLoaded(true);
    }).catch(err => {
      console.error(err);
      setError("필수 라이브러리(PDF/Excel/PPT) 로드 실패. 새로고침 해주세요.");
    });
  }, []);

  // --- 파일 분석 로직 ---

  const extractTextFromPPTX = async (file) => {
    try {
      if (!window.JSZip) throw new Error("PPT 엔진 로딩 중...");
      const zip = new window.JSZip();
      const content = await zip.loadAsync(file);
      const slideFiles = Object.keys(content.files).filter(name => name.startsWith("ppt/slides/slide") && name.endsWith(".xml"));
      
      slideFiles.sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)\.xml/)[1]);
        const numB = parseInt(b.match(/slide(\d+)\.xml/)[1]);
        return numA - numB;
      });

      let fullText = "";
      for (const slide of slideFiles) {
        const slideXml = await content.files[slide].async("text");
        const parser = new DOMParser();
        const doc = parser.parseFromString(slideXml, "text/xml");
        const textNodes = doc.getElementsByTagName("a:t");
        let slideText = "";
        for (let i = 0; i < textNodes.length; i++) slideText += textNodes[i].textContent + " ";
        if (slideText.trim()) fullText += `[Slide] ${slideText}\n`;
      }
      return fullText;
    } catch (e) {
      return `[PPT 오류] ${file.name}: 암호가 있거나 손상된 파일입니다.`;
    }
  };

  const extractTextFromExcel = async (file) => {
    try {
        if (!window.XLSX) throw new Error("Excel 엔진 로딩 중...");
        const data = await file.arrayBuffer();
        const workbook = window.XLSX.read(data);
        let fullText = "";
        workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const csv = window.XLSX.utils.sheet_to_csv(worksheet);
            fullText += `[Sheet: ${sheetName}]\n${csv}\n`;
        });
        return fullText;
    } catch (e) {
        return `[Excel 오류] ${file.name}`;
    }
  };

  const extractTextFromPDF = async (file) => {
    try {
      if (!window.pdfjsLib) throw new Error("PDF 엔진 로딩 중...");
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += `[Page ${i}] ${pageText}\n`;
      }
      return fullText;
    } catch (e) {
      console.error(e);
      return `[PDF 오류] ${file.name}: 텍스트를 추출할 수 없습니다. (이미지 PDF일 가능성 있음)`;
    }
  };

  const extractTextFromHWPX = async (file) => {
    try {
        if (!window.JSZip) throw new Error("HWP 엔진 로딩 중...");
        const zip = new window.JSZip();
        const content = await zip.loadAsync(file);
        const sectionFiles = Object.keys(content.files).filter(name => name.startsWith("Contents/section") && name.endsWith(".xml"));
        
        let fullText = "";
        for (const sec of sectionFiles) {
            const xmlStr = await content.files[sec].async("text");
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlStr, "text/xml");
            const textNodes = doc.getElementsByTagName("hp:t");
            for (let i = 0; i < textNodes.length; i++) fullText += textNodes[i].textContent + " ";
            fullText += "\n";
        }
        return fullText;
    } catch (e) {
        return `[HWPX 오류] ${file.name}`;
    }
  };

  const rebuildTextContent = (files) => {
    let combined = files.map(f => `\n--- [File: ${f.name}] ---\n${f.content}\n`).join("");
    if (combined.length > 60000) combined = combined.substring(0, 60000) + "...(길이 제한)";
    setTextContent(combined);
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    if (files.length > 10) { setError("최대 10개 파일까지만 가능합니다."); return; }
    
    setLoadingMsg(`${files.length}개 파일 분석 중...`);
    setError('');
    
    const newFilesData = [];
    try {
        for (const file of files) {
            const ext = file.name.split('.').pop().toLowerCase();
            let extracted = "";
            
            if (ext === 'pptx') extracted = await extractTextFromPPTX(file);
            else if (['xlsx', 'xls', 'csv'].includes(ext)) extracted = await extractTextFromExcel(file);
            else if (ext === 'pdf') extracted = await extractTextFromPDF(file);
            else if (ext === 'hwpx') extracted = await extractTextFromHWPX(file);
            else if (ext === 'txt') extracted = await file.text();
            else if (ext === 'hwp') {
                extracted = `[안내: ${file.name}]\n⚠️ HWP 파일은 브라우저에서 직접 열 수 없습니다.\n👉 한글에서 [파일] > [PDF로 저장하기] 후 PDF를 업로드해주시면 내용을 완벽하게 분석할 수 있습니다!`;
            } else {
                extracted = `[안내: ${file.name}] 지원하지 않는 형식입니다. 내용을 복사해서 붙여넣어주세요.`;
            }
            
            newFilesData.push({ name: file.name, content: extracted });
        }
        
        setUploadedFiles(newFilesData);
        rebuildTextContent(newFilesData);
        
    } catch (err) { 
        console.error(err);
        setError("파일 분석 중 오류가 발생했습니다."); 
    } finally { 
        setLoadingMsg(''); 
    }
  };

  const handleRemoveFile = (index) => {
    const updated = uploadedFiles.filter((_, i) => i !== index);
    setUploadedFiles(updated);
    rebuildTextContent(updated);
    if (updated.length === 0 && fileInputRef.current) fileInputRef.current.value = '';
  };

  const clearFiles = () => { setUploadedFiles([]); setTextContent(''); if(fileInputRef.current) fileInputRef.current.value = ''; };

  // --- AI Logic ---

  const callGeminiAPI = async (text, count) => {
    if (!userApiKey) throw new Error("API Key가 필요합니다.");
    const prompt = `
      Create exactly ${count} multiple choice questions for Elementary School Students in Korean.
      Rules: Use shapes (□) instead of algebra variables (x, y). Focus on core concepts.
      Output: Valid JSON array [{"question": "...", "answers": ["A","B","C","D"], "correctAnswer": 1, "timeLimit": 20}]
      Context: ${text}
    `;
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${userApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } })
    });

    if (!response.ok) throw new Error(`API 오류: ${response.status}`);
    const data = await response.json();
    return JSON.parse(data.candidates[0].content.parts[0].text);
  };

  const generateMockQuestions = (count) => {
    return Array(count).fill(0).map((_, i) => ({
      id: Date.now() + i, question: `(데모) 예시 문제 ${i+1}`, answers: ["1", "2", "3", "4"], correctAnswer: 1, timeLimit: 20
    }));
  };

  const handleGenerate = async () => {
    if (!textContent) { setError("분석할 내용이 없습니다."); return; }
    setStep(2); setLoadingMsg("AI가 문제를 분석 중입니다..."); setError('');
    
    try {
      let data = [];
      if (userApiKey) {
        data = await callGeminiAPI(textContent, questionCount);
        data = data.map((q, i) => ({ ...q, id: i + 1 }));
      } else {
        await new Promise(r => setTimeout(r, 1500));
        setError("API Key가 없어 데모 데이터가 생성되었습니다.");
        data = generateMockQuestions(questionCount);
      }
      setQuestions(data); setStep(3);
    } catch (err) {
      console.error(err);
      setError("생성 실패: " + err.message);
      setStep(1);
    }
  };

  const handleRegenerateSingle = async (id) => {
    if (!userApiKey) { alert("API Key가 필요합니다."); return; }
    setQuestions(qs => qs.map(q => q.id === id ? { ...q, isRegenerating: true } : q));
    try {
        const newQs = await callGeminiAPI(textContent, 1);
        if (newQs.length) setQuestions(qs => qs.map(q => q.id === id ? { ...newQs[0], id: id, isRegenerating: false } : q));
    } catch(e) { setQuestions(qs => qs.map(q => q.id === id ? { ...q, isRegenerating: false } : q)); }
  };

  // --- Handlers ---

  const handleUpdate = (id, f, v) => setQuestions(qs => qs.map(q => q.id === id ? { ...q, [f]: v } : q));
  const handleUpdateAns = (id, idx, v) => setQuestions(qs => qs.map(q => q.id === id ? { ...q, answers: q.answers.map((a, i) => i === idx ? v : a) } : q));
  const handleDelete = (id) => setQuestions(qs => qs.filter(q => q.id !== id));
  const handleAdd = () => setQuestions(qs => [...qs, { id: Date.now(), question: "새 문제", answers: ["","","",""], correctAnswer: 1, timeLimit: 20 }]);

  const downloadCSV = () => {
    const row1 = '"Blooket\nImport Template",,,,,,,';
    const row2 = 'Question #,Question Text,Answer 1,Answer 2,"Answer 3\n(Optional)","Answer 4\n(Optional)","Time Limit (sec)\n(Max: 300 seconds)","Correct Answer(s)\n(Only include Answer #)"';
    
    const escapeCsv = (text) => {
      if (text === null || text === undefined) return '""';
      return '"' + String(text).replace(/"/g, '""') + '"';
    };

    const rows = questions.map((q, i) => {
      return [
        i + 1,
        escapeCsv(q.question),
        escapeCsv(q.answers[0]),
        escapeCsv(q.answers[1]),
        escapeCsv(q.answers[2]),
        escapeCsv(q.answers[3]),
        q.timeLimit || 20,
        q.correctAnswer || 1
      ].join(",");
    });

    const csvContent = [row1, row2, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); 
    link.href = url; 
    link.download = `blooket_quiz.csv`; 
    document.body.appendChild(link); 
    link.click(); 
    document.body.removeChild(link);
  };

  const copyForExtension = () => {
    const macroData = questions.map(q => ({ question: q.question, answers: q.answers, correctAnswer: q.correctAnswer, timeLimit: q.timeLimit }));
    navigator.clipboard.writeText(JSON.stringify(macroData, null, 2)).then(() => alert("✅ 데이터 복사 완료! 확장 프로그램에 붙여넣으세요."));
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 p-4 md:p-8">
      <div className="max-w-5xl mx-auto bg-white shadow-xl rounded-2xl overflow-hidden border border-slate-200">
        <header className="bg-indigo-700 text-white p-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-white p-2 rounded-lg"><span className="text-2xl font-bold text-indigo-700">Q</span></div>
            <div><h1 className="text-2xl font-bold">퀴즈 생성기</h1><p className="text-indigo-200 text-sm">PDF, PPT, Excel 통합 분석 & 매크로 연동</p></div>
          </div>
          <div className="text-xs bg-indigo-800 px-3 py-1 rounded-full">{libraryLoaded ? "엔진 준비됨" : "로딩 중..."}</div>
        </header>

        <div className="p-6 md:p-8">
          {step === 1 && (
            <div className="space-y-6">
              <div className="bg-slate-100 p-5 rounded-xl border border-slate-200">
                <div className="flex items-center gap-2 mb-2 font-bold text-slate-700"><Key className="w-4 h-4"/> Google Gemini API Key</div>
                <input type="password" value={userApiKey} onChange={(e)=>setUserApiKey(e.target.value)} placeholder="API Key 입력 (없으면 데모 모드)" className="w-full p-3 border rounded-lg bg-white"/>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
                {!uploadedFiles.length ? (
                  <div onClick={()=>fileInputRef.current.click()} className="border-2 border-dashed border-blue-300 rounded-xl bg-white p-10 text-center cursor-pointer hover:bg-blue-50">
                    <Layers className="w-10 h-10 mx-auto text-indigo-400 mb-2"/><p className="font-bold text-slate-600">파일 업로드 (PDF, PPT, Excel, HWPX 등)</p><p className="text-sm text-slate-400">여러 개 선택 가능</p>
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" multiple accept=".pdf,.pptx,.xlsx,.xls,.csv,.txt,.hwp,.hwpx"/>
                  </div>
                ) : (
                  <div className="bg-white p-4 rounded-xl mb-3 shadow-sm">
                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-indigo-100">
                        <span className="font-bold text-indigo-600 flex items-center gap-2"><Check className="w-4 h-4"/> {uploadedFiles.length}개 파일</span>
                        <button onClick={clearFiles} className="text-red-400 hover:text-red-600"><X className="w-5 h-5"/></button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {uploadedFiles.map((file, idx) => (
                            <div key={idx} className="bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-sm border border-indigo-100 flex items-center gap-2">
                                <FileText className="w-3 h-3"/> <span className="max-w-[150px] truncate">{file.name}</span>
                                <button onClick={() => handleRemoveFile(idx)} className="hover:text-red-600"><X className="w-3 h-3"/></button>
                            </div>
                        ))}
                    </div>
                  </div>
                )}
                <textarea value={textContent} onChange={(e)=>setTextContent(e.target.value)} className="w-full h-32 mt-4 p-3 rounded-lg border text-sm" placeholder="추출된 텍스트..."></textarea>
                <div className="mt-4 flex items-center gap-2"><span className="font-bold text-slate-700">문항 수:</span><input type="number" value={questionCount} onChange={(e)=>setQuestionCount(e.target.value)} className="border p-2 w-20 text-center rounded font-bold text-indigo-600"/></div>
                {error && <div className="mt-3 text-red-500 font-bold flex items-center gap-1"><AlertCircle className="w-4 h-4"/> {error}</div>}
              </div>
              <div className="flex justify-end"><button onClick={handleGenerate} disabled={!textContent} className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-4 rounded-xl font-bold shadow-lg flex items-center gap-2 transition-all disabled:bg-slate-300"><RefreshCw className="w-5 h-5"/> 퀴즈 생성하기</button></div>
            </div>
          )}

          {step === 2 && <div className="py-24 text-center"><Loader2 className="w-16 h-16 animate-spin mx-auto text-indigo-600 mb-4"/><h2 className="text-2xl font-bold text-slate-800">{loadingMsg}</h2></div>}

          {step === 3 && (
            <div className="space-y-6">
              <div className="flex justify-between items-center"><h2 className="text-xl font-bold flex items-center gap-2"><Edit3 className="w-5 h-5"/> 결과 확인</h2><div className="flex gap-2"><button onClick={()=>setStep(1)} className="px-4 py-2 border rounded hover:bg-slate-100">처음으로</button><button onClick={handleAdd} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"><Plus className="w-4 h-4"/>추가</button></div></div>
              <div className="grid gap-6 max-h-[60vh] overflow-y-auto pr-2">
                {questions.map((q, idx) => (
                    <div key={q.id} className="border p-5 rounded-xl bg-white shadow-sm relative">
                        {q.isRegenerating && <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center"><Loader2 className="animate-spin text-indigo-600"/></div>}
                        <div className="flex gap-3 mb-3">
                            <span className="font-bold text-indigo-600 pt-1">Q{idx+1}</span>
                            <input value={q.question} onChange={(e)=>handleUpdate(q.id,'question',e.target.value)} className="flex-1 font-bold border-b focus:border-indigo-500 outline-none"/>
                            <button onClick={()=>handleRegenerateSingle(q.id)} className="text-indigo-400 hover:text-indigo-600"><RefreshCw className="w-5 h-5"/></button>
                            <button onClick={()=>handleDelete(q.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="w-5 h-5"/></button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">{q.answers.map((ans, aIdx) => (<div key={aIdx} className={`flex items-center gap-2 p-2 border rounded ${q.correctAnswer===aIdx+1?'border-indigo-500 bg-indigo-50':''}`}><div onClick={()=>handleUpdate(q.id,'correctAnswer',aIdx+1)} className={`w-5 h-5 rounded-full border cursor-pointer flex items-center justify-center ${q.correctAnswer===aIdx+1?'bg-indigo-500 border-indigo-500 text-white':''}`}>{q.correctAnswer===aIdx+1&&<Check className="w-3 h-3"/>}</div><input value={ans} onChange={(e)=>handleUpdateAns(q.id,aIdx,e.target.value)} className="flex-1 bg-transparent outline-none"/></div>))}</div>
                    </div>
                ))}
              </div>
              <div className="flex justify-center gap-4 pt-6 border-t">
                <button onClick={downloadCSV} className="bg-slate-600 hover:bg-slate-700 text-white px-6 py-3 rounded-full font-bold shadow flex items-center gap-2"><Download className="w-5 h-5"/> CSV 다운로드</button>
                <button onClick={copyForExtension} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-full font-bold shadow flex items-center gap-2 animate-pulse"><Zap className="w-5 h-5 text-yellow-300"/> 매크로 데이터 복사</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default BlooketGenerator;
