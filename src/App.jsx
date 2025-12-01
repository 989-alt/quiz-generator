import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Download, Edit3, Trash2, Plus, Check, RefreshCw, AlertCircle, Settings, X, RotateCcw, Key, FileSpreadsheet, FileBox, Loader2, Layers } from 'lucide-react';

const BlooketGenerator = () => {
  const [step, setStep] = useState(1);
  const [textContent, setTextContent] = useState('');
  const [fileList, setFileList] = useState([]); // Array of file names
  const [questionCount, setQuestionCount] = useState(10);
  const [userApiKey, setUserApiKey] = useState('');
  const [questions, setQuestions] = useState([]);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  
  const fileInputRef = useRef(null);

  // Load external libraries for parsing PPTX and XLSX
  useEffect(() => {
    const loadScript = (src) => {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.body.appendChild(script);
      });
    };

    Promise.all([
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'), // For PPTX
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js') // For Excel
    ]).then(() => {
      console.log("File parsing libraries loaded");
      setLibraryLoaded(true);
    }).catch(err => {
      console.error("Failed to load libraries", err);
      setError("파일 분석 라이브러리 로드 실패. 새로고침 해주세요.");
    });
  }, []);

  // --- Real File Parsing Logic ---

  const extractTextFromPPTX = async (file) => {
    try {
      if (!window.JSZip) throw new Error("PPT 파서 로딩 중...");
      const zip = new window.JSZip();
      const content = await zip.loadAsync(file);
      
      const slideFiles = Object.keys(content.files).filter(name => 
        name.startsWith("ppt/slides/slide") && name.endsWith(".xml")
      );

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
        for (let i = 0; i < textNodes.length; i++) {
          slideText += textNodes[i].textContent + " ";
        }
        if (slideText.trim()) {
            fullText += `[Content] ${slideText}\n`;
        }
      }
      return fullText;
    } catch (e) {
      console.error(e);
      return `[Error reading PPTX: ${file.name}]`;
    }
  };

  const extractTextFromExcel = async (file) => {
    try {
        if (!window.XLSX) throw new Error("Excel 파서 로딩 중...");
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
        console.error(e);
        return `[Error reading Excel: ${file.name}]`;
    }
  };

  // --- Handlers ---

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    if (files.length > 10) {
        setError("최대 10개의 파일까지만 업로드할 수 있습니다.");
        return;
    }

    setLoadingMsg(`${files.length}개의 파일을 분석하고 있습니다...`);
    setError('');
    
    setFileList(files.map(f => f.name));
    setTextContent(''); 

    let combinedText = "";

    try {
        for (const file of files) {
            const extension = file.name.split('.').pop().toLowerCase();
            let extractedText = "";

            if (extension === 'pptx') {
                extractedText = await extractTextFromPPTX(file);
            } else if (['xlsx', 'xls', 'csv'].includes(extension)) {
                extractedText = await extractTextFromExcel(file);
            } else if (extension === 'txt') {
                extractedText = await file.text();
            } else {
                 // Fallback for non-parsable files (like PDF/HWP in browser)
                 extractedText = `[안내: ${file.name} (형식: ${extension})]
이 파일 형식은 브라우저 보안상 직접 텍스트 추출이 어렵습니다.
해당 파일의 내용을 복사하여 아래 텍스트 상자에 붙여넣어주시면 함께 분석됩니다.\n`;
            }

            combinedText += `\n--- [File: ${file.name}] ---\n${extractedText}\n`;
        }

        if (combinedText.trim().length === 0) {
            setError("파일에서 텍스트를 찾을 수 없습니다.");
        } else {
            const LIMIT = 50000; // Increased limit for multiple files
            if (combinedText.length > LIMIT) {
                combinedText = combinedText.substring(0, LIMIT) + "\n... (내용이 너무 많아 일부만 분석합니다)";
            }
            setTextContent(combinedText);
        }

    } catch (err) {
        setError("파일 처리 중 오류가 발생했습니다: " + err.message);
    } finally {
        setLoadingMsg('');
    }
  };

  const clearFiles = () => {
    setFileList([]);
    setTextContent('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const callGeminiAPI = async (text, count) => {
    if (!userApiKey) throw new Error("API Key missing");

    const prompt = `
      You are an expert educational content creator for Elementary School Students.
      Your goal is to create a high-quality quiz that tests students' understanding of the *core concepts* and *principles* found in the text below.

      **STRICT GENERATION RULES:**
      1. **Target Audience**: Elementary School Students (초등학생).
      2. **NO Algebra Variables**: NEVER use variables like 'x', 'y', 'z', 'a', 'b'. 
         - **BAD**: "Solve for x: 3x + 2 = 8"
         - **GOOD**: "Solve: 3 × □ + 2 = 8" or use words like "어떤 수".
         - Use shapes (□, △, ○) to represent unknown values.
         - Use '×' instead of '*' and '÷' instead of '/'.
      3. **Conceptual Focus**: Do NOT ask trivial questions about the document structure (e.g., "What is on Slide 3?"). Ask about meanings, definitions, and applications.
      4. **No Meta-References**: Questions must stand alone. Do not refer to "the text" or "the slide".
      5. **Output Format**: Return ONLY a raw JSON array.
      6. **Language**: Korean (한국어). Use polite and simple language suitable for children.
      7. **Quantity**: Exactly ${count} questions.

      **JSON Structure:**
      [
        {
          "question": "Question text here...",
          "answers": ["Option A", "Option B", "Option C", "Option D"],
          "correctAnswer": 1, // 1, 2, 3, or 4
          "timeLimit": 30
        }
      ]

      **Input Context:**
      ${text}
    `;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${userApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await response.json();
    return JSON.parse(data.candidates[0].content.parts[0].text);
  };

  // Mock Generator
  const generateMockQuestions = (count) => {
    return Array(count).fill(0).map((_, i) => ({
      id: Date.now() + i, 
      question: `(데모) API 키가 확인되지 않아 생성된 예시입니다. ${i + 1}`,
      answers: ["개념 이해", "단순 암기", "슬라이드 번호", "페이지 번호"],
      correctAnswer: 1,
      timeLimit: 20
    }));
  };

  const handleGenerate = async () => {
    if (!textContent) {
      setError("분석할 텍스트가 없습니다. 파일을 업로드하거나 텍스트를 입력해주세요.");
      return;
    }

    setStep(2);
    setLoadingMsg("초등학생 눈높이에 맞춰 모든 자료를 통합 분석 중입니다...");
    setError('');

    try {
      let generatedData = [];
      
      if (userApiKey) {
        generatedData = await callGeminiAPI(textContent, questionCount);
        generatedData = generatedData.map((q, idx) => ({ ...q, id: idx + 1 }));
      } else {
        await new Promise(r => setTimeout(r, 1500));
        setError("API 키가 입력되지 않았습니다. (현재는 예시 문제입니다)");
        generatedData = generateMockQuestions(questionCount);
      }

      setQuestions(generatedData);
      setStep(3);
    } catch (err) {
      console.error(err);
      setError("퀴즈 생성 실패: " + err.message);
      setStep(1);
    }
  };

  // --- Specific Question Regeneration ---
  const handleRegenerateSingle = async (id) => {
    if (!userApiKey) {
        alert("개별 재생성은 API 키가 필요합니다. (데모 모드에서는 동작하지 않습니다)");
        return;
    }

    setQuestions(prev => prev.map(q => q.id === id ? { ...q, isRegenerating: true } : q));

    try {
        const newQuestionArray = await callGeminiAPI(textContent, 1);
        
        if (newQuestionArray && newQuestionArray.length > 0) {
            const newQ = newQuestionArray[0];
            setQuestions(prev => prev.map(q => 
                q.id === id ? { ...newQ, id: id, isRegenerating: false } : q
            ));
        } else {
            throw new Error("No data returned");
        }
    } catch (err) {
        console.error("Single regeneration failed", err);
        alert("문제 재생성에 실패했습니다. 잠시 후 다시 시도해주세요.");
        setQuestions(prev => prev.map(q => q.id === id ? { ...q, isRegenerating: false } : q));
    }
  };

  // ... Update Handlers
  const handleUpdateQuestion = (id, field, value) => {
    setQuestions(questions.map(q => q.id === id ? { ...q, [field]: value } : q));
  };
  const handleUpdateAnswer = (id, idx, value) => {
    setQuestions(questions.map(q => {
      if (q.id === id) {
        const newAnswers = [...q.answers];
        newAnswers[idx] = value;
        return { ...q, answers: newAnswers };
      }
      return q;
    }));
  };
  const handleDelete = (id) => setQuestions(questions.filter(q => q.id !== id));
  const handleAdd = () => {
    const newId = Date.now();
    setQuestions([...questions, {
      id: newId, question: "새로운 문제", answers: ["1", "2", "3", "4"], correctAnswer: 1, timeLimit: 20
    }]);
  };

  // --- CSV Download Logic ---
  const downloadCSV = () => {
    const header1 = ['"Blooket\nImport Template"', "", "", "", "", "", "", ""].join(",");
    const header2 = [
      "Question #", 
      "Question Text", 
      "Answer 1", 
      "Answer 2", 
      '"Answer 3\n(Optional)"', 
      '"Answer 4\n(Optional)"', 
      '"Time Limit (sec)\n(Max: 300 seconds)"', 
      '"Correct Answer(s)\n(Only include Answer #)"'
    ].join(",");
    
    const rows = questions.map((q, i) => {
      const clean = (txt) => {
        if (txt === null || txt === undefined) return '""';
        return `"${String(txt).replace(/"/g, '""')}"`;
      };

      return [
        i + 1,
        clean(q.question),
        clean(q.answers[0] || ""),
        clean(q.answers[1] || ""),
        clean(q.answers[2] || ""),
        clean(q.answers[3] || ""),
        q.timeLimit || 20,
        q.correctAnswer || 1
      ].join(",");
    });

    const csvContent = [header1, header2, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `blooket_quiz_v3_multi.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 p-4 md:p-8">
      <div className="max-w-5xl mx-auto bg-white shadow-xl rounded-2xl overflow-hidden border border-slate-200">
        
        <header className="bg-indigo-700 text-white p-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-white p-2 rounded-lg"><span className="text-2xl font-bold text-indigo-700">B</span></div>
            <div>
              <h1 className="text-2xl font-bold">퀴즈 생성기</h1>
              <p className="text-indigo-200 text-sm">여러 파일 동시 분석 & 개별 문제 수정 기능</p>
            </div>
          </div>
          <div className="text-xs bg-indigo-800 px-3 py-1 rounded-full border border-indigo-500">
            {libraryLoaded ? "분석 엔진 준비됨" : "엔진 로딩 중..."}
          </div>
        </header>

        <div className="p-6 md:p-8">
          {step === 1 && (
            <div className="space-y-6">
              
              <div className="bg-slate-100 p-5 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 mb-2 text-slate-800 font-bold">
                    <Key className="w-4 h-4 text-indigo-600" />
                    Google Gemini API Key (필수)
                </div>
                <input 
                    type="password"
                    value={userApiKey}
                    onChange={(e) => setUserApiKey(e.target.value)}
                    placeholder="AIzaSy... (키가 있어야 실제 내용 기반으로 문제를 만듭니다)"
                    className="w-full p-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
                <p className="text-xs text-slate-500 mt-2 text-red-500">
                   * 키가 없으면 파일 내용을 읽더라도 일반적인 예시 문제만 나옵니다.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
                <h2 className="text-lg font-semibold text-blue-900 mb-4 flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  자료 업로드 (최대 10개)
                </h2>
                
                {fileList.length === 0 ? (
                  <div 
                    onClick={() => fileInputRef.current.click()}
                    className="border-2 border-dashed border-blue-300 rounded-xl bg-white p-10 text-center cursor-pointer hover:bg-blue-50 transition-all"
                  >
                    <div className="flex justify-center gap-4 mb-3">
                        <Layers className="w-10 h-10 text-indigo-400" />
                        <FileSpreadsheet className="w-10 h-10 text-green-500" />
                    </div>
                    <p className="text-slate-600 font-bold text-lg">파일들을 여기로 드래그하거나 클릭하세요</p>
                    <p className="text-slate-400 text-sm mt-2">
                        PPT, Excel, CSV, TXT 등 <strong>여러 개를 한 번에</strong> 올릴 수 있습니다.<br/>
                        (최대 10개 파일)
                    </p>
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileUpload} 
                      className="hidden" 
                      multiple 
                      accept=".pptx,.xlsx,.xls,.csv,.txt"
                    />
                  </div>
                ) : (
                  <div className="bg-white border border-indigo-200 rounded-xl p-4 mb-4 shadow-sm">
                    <div className="flex justify-between items-center mb-3 pb-2 border-b border-indigo-100">
                        <div className="flex items-center gap-2">
                            <Layers className="w-5 h-5 text-indigo-600" />
                            <span className="font-bold text-slate-700">{fileList.length}개의 파일 선택됨</span>
                        </div>
                        <button onClick={clearFiles} className="text-slate-400 hover:text-red-500 text-sm flex items-center gap-1">
                            <X className="w-4 h-4" /> 전체 삭제
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {fileList.map((fname, idx) => (
                            <span key={idx} className="bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-sm border border-indigo-100 flex items-center gap-1">
                                <FileText className="w-3 h-3" /> {fname}
                            </span>
                        ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-2 text-right">
                        {loadingMsg ? loadingMsg : `${textContent.length}자 텍스트 통합 분석 완료`}
                    </p>
                  </div>
                )}

                <div className="mt-4">
                    <label className="text-sm font-bold text-slate-600 mb-1 block">분석된 텍스트 확인 (통합):</label>
                    <textarea
                    className="w-full h-40 p-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none resize-none text-slate-700 text-sm font-mono bg-white"
                    placeholder="파일을 올리면 모든 내용이 여기에 합쳐집니다."
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    ></textarea>
                </div>

                <div className="mt-4 flex items-center justify-between">
                    <div>
                        <label className="text-sm font-bold text-slate-700 mr-2">문항 수:</label>
                        <input 
                            type="number" 
                            min="1" max="50" 
                            value={questionCount} 
                            onChange={(e) => setQuestionCount(e.target.value)}
                            className="border rounded p-1 w-16 text-center font-bold text-indigo-600"
                        />
                    </div>
                    {error && <span className="text-red-600 text-sm font-bold animate-pulse">{error}</span>}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleGenerate}
                  disabled={!textContent}
                  className={`px-8 py-4 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2 text-lg ${
                    !textContent 
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed' 
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                  }`}
                >
                  <RefreshCw className="w-6 h-6" />
                  통합 퀴즈 생성
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
              <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600 mb-6"></div>
              <h2 className="text-2xl font-bold text-slate-800">{loadingMsg}</h2>
              <p className="text-slate-500 mt-2">여러 자료의 내용을 융합하여 최적의 문제를 만들고 있습니다.</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-slate-800">생성 결과 ({questions.length}문제)</h2>
                <div className="flex gap-2">
                    <button onClick={() => setStep(1)} className="px-4 py-2 border rounded hover:bg-slate-100 flex items-center gap-1">
                        <RotateCcw className="w-4 h-4"/> 처음으로
                    </button>
                    <button onClick={handleAdd} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1">
                        <Plus className="w-4 h-4"/> 추가
                    </button>
                </div>
              </div>

              <div className="grid gap-6 max-h-[60vh] overflow-y-auto pr-2">
                {questions.map((q, idx) => (
                    <div key={q.id} className="border p-4 rounded-xl bg-white shadow-sm relative group">
                        
                        {q.isRegenerating && (
                            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center rounded-xl">
                                <div className="flex flex-col items-center gap-2 text-indigo-600">
                                    <Loader2 className="w-8 h-8 animate-spin" />
                                    <span className="text-sm font-bold">문제 다시 만드는 중...</span>
                                </div>
                            </div>
                        )}

                        <div className="flex gap-4 mb-3">
                            <span className="font-bold text-indigo-600 flex items-center">Q{idx+1}</span>
                            <input 
                                className="flex-1 font-bold border-b focus:border-indigo-500 outline-none text-lg"
                                value={q.question}
                                onChange={(e) => handleUpdateQuestion(q.id, 'question', e.target.value)}
                            />
                            <div className="flex items-center gap-1">
                                <button 
                                    onClick={() => handleRegenerateSingle(q.id)} 
                                    className="p-2 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                    title="이 문제만 다시 만들기"
                                >
                                    <RefreshCw className="w-5 h-5" />
                                </button>
                                <button 
                                    onClick={() => handleDelete(q.id)} 
                                    className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    title="삭제"
                                >
                                    <Trash2 className="w-5 h-5"/>
                                </button>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {q.answers.map((ans, aIdx) => (
                                <div key={aIdx} className={`flex items-center gap-2 p-2 border rounded ${q.correctAnswer === aIdx+1 ? 'border-indigo-500 bg-indigo-50' : ''}`}>
                                    <div 
                                        className={`w-6 h-6 rounded-full border cursor-pointer flex items-center justify-center shrink-0 ${q.correctAnswer === aIdx+1 ? 'bg-indigo-500 border-indigo-500 text-white' : 'hover:border-indigo-300'}`}
                                        onClick={() => handleUpdateQuestion(q.id, 'correctAnswer', aIdx+1)}
                                    >
                                        {q.correctAnswer === aIdx+1 && <Check className="w-3 h-3"/>}
                                    </div>
                                    <input 
                                        className="flex-1 bg-transparent outline-none text-sm"
                                        value={ans}
                                        onChange={(e) => handleUpdateAnswer(q.id, aIdx, e.target.value)}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
              </div>

              <div className="flex justify-center pt-4 border-t">
                <button onClick={downloadCSV} className="bg-indigo-600 text-white px-10 py-4 rounded-full font-bold shadow-xl flex items-center gap-2 hover:scale-105 transition-all">
                    <Download className="w-6 h-6" /> CSV 다운로드
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BlooketGenerator;