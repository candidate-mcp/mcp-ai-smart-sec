import React, { useState, useRef, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";

// JSPDF and html2canvas are loaded from CDN in index.html
declare const jspdf: any;
declare const html2canvas: any;

const App = () => {
  const [page, setPage] = useState('home');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [briefingResult, setBriefingResult] = useState(null);
  const [modalMessage, setModalMessage] = useState('');

  useEffect(() => {
    const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

    if (isIos()) {
      console.log('iOS device detected. Applying fetch proxy workaround instead of using Service Worker.');
      
      // Unregister any existing service worker to prevent conflicts on iOS.
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const registration of registrations) {
            registration.unregister();
            console.log('Service Worker unregistered to prevent conflicts on iOS.');
          }
        });
      }

      // Monkey-patch fetch to proxy API calls directly as a workaround.
      const originalFetch = window.fetch;
      if (!(originalFetch as any).isPatched) {
        const patchedFetch = (...args: [RequestInfo | URL, RequestInit | undefined]) => {
          const resource = args[0];
          const targetPrefix = 'https://generativelanguage.googleapis.com';

          if (typeof resource === 'string' && resource.startsWith(targetPrefix)) {
            const newUrl = `/api-proxy${resource.substring(targetPrefix.length)}`;
            console.log(`[iOS Workaround] Proxying fetch request to: ${newUrl}`);
            args[0] = newUrl;
          }
          
          return originalFetch.apply(window, args);
        };
        (patchedFetch as any).isPatched = true;
        window.fetch = patchedFetch as typeof window.fetch;
      }
    } else {
      // For non-iOS devices, register the service worker as usual.
      console.log('Non-iOS device detected. Registering Service Worker.');
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
              console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(error => {
              console.error('ServiceWorker registration failed: ', error);
              setError('서비스 워커 등록에 실패했습니다. API 요청이 실패할 수 있습니다.');
            });
        });
      }
    }
  }, []);

  const resetState = () => {
    setPage('home');
    setLoading(false);
    setError('');
    setBriefingResult(null);
  };
  
  const fileToGenerativePart = async (file: File) => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(file);
    });
    return {
      inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
    };
  };

  const generateBriefing = async (file: File, type: 'morning' | 'afternoon') => {
    // Initialize the AI client on-demand to ensure the latest API key from the environment is used.
    // This is a robust way to handle environments like iOS where a service worker might inject the key at runtime.
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      const errorMessage = "AI 서비스를 초기화할 수 없습니다. API 키를 찾을 수 없습니다. iOS와 같은 일부 환경에서는 기능이 제한될 수 있습니다.";
      console.error("API Key not found. AI features may be disabled.");
      setError(errorMessage);
      setModalMessage(errorMessage);
      return;
    }
    const ai = new GoogleGenAI({ apiKey });

    if (!file) {
      setError("이미지 파일을 선택해주세요.");
      return;
    }
    setLoading(true);
    setError('');
    setBriefingResult(null);

    try {
        const imagePart = await fileToGenerativePart(file);
        
        let systemInstruction;
        let responseSchema;

        if (type === 'morning') {
            systemInstruction = "You are a helpful AI assistant. Analyze the user's calendar image and create a morning briefing in Korean. The tone should be warm and supportive. Provide a summary, a breakdown of the schedule with key points, and an encouraging quote. Do not call the user '대표님'.";
            responseSchema = {
                type: Type.OBJECT,
                properties: {
                    summary: { type: Type.STRING, description: "오늘 일정에 대한 150자 내외의 요약" },
                    schedule: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                time: { type: Type.STRING, description: "일정 시간 (예: 오전 10:00)" },
                                title: { type: Type.STRING, description: "일정 제목" },
                                keyPoint: { type: Type.STRING, description: "일정에 대한 핵심 포인트나 조언" }
                            }
                        }
                    },
                    encouragement: { type: Type.STRING, description: "하루를 시작하는 따뜻한 응원 문구" }
                }
            };
        } else { // afternoon
            systemInstruction = "You are an empathetic AI assistant. Analyze the user's completed calendar or to-do list image and create an afternoon retrospective in Korean. Summarize achievements, offer encouragement, and provide reflection points based on the KPT framework (Keep, Problem, Try) without naming it. The goal is to boost morale and suggest routine improvements. Also, provide three reflective questions.";
            responseSchema = {
                type: Type.OBJECT,
                properties: {
                    summary: { type: Type.STRING, description: "오늘 한 일에 대한 성취감을 주는 요약" },
                    encouragement: { type: Type.STRING, description: "노고를 격려하는 따뜻한 응원 메시지" },
                    reflection: {
                        type: Type.OBJECT,
                        properties: {
                            keep: { type: Type.STRING, description: "오늘 잘한 점과 계속 이어가면 좋을 점" },
                            problem: { type: Type.STRING, description: "개선하거나 다르게 접근해볼 점" },
                            try: { type: Type.STRING, description: "루틴 개선을 위한 다음 행동 제안" }
                        }
                    },
                    questions: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: "하루를 돌아볼 수 있는 회고 질문 3개"
                    }
                }
            };
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [imagePart] },
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema
            }
        });

        const jsonText = response.text.trim();
        const parsedResult = JSON.parse(jsonText);
        setBriefingResult({ type, data: parsedResult });

    } catch (e) {
        console.error(e);
        setError("브리핑 생성 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
        setLoading(false);
    }
  };

  const renderPage = () => {
    switch (page) {
      case 'morning':
        return <BriefingScreen type="morning" onGenerate={generateBriefing} result={briefingResult} error={error} setModalMessage={setModalMessage} reset={() => setBriefingResult(null)} />;
      case 'afternoon':
        return <BriefingScreen type="afternoon" onGenerate={generateBriefing} result={briefingResult} error={error} setModalMessage={setModalMessage} reset={() => setBriefingResult(null)} />;
      case 'reminder':
        return <ReminderScreen />;
      default:
        return <HomeScreen setPage={setPage} />;
    }
  };

  return (
    <div className="app-container">
      <Header onLogoClick={resetState} />
      <main>
        {renderPage()}
      </main>
      {loading && <Loader />}
      {modalMessage && <Modal message={modalMessage} onClose={() => setModalMessage('')} />}
    </div>
  );
};

const Header = ({ onLogoClick }) => (
  <header className="header" onClick={onLogoClick} role="button" tabIndex={0} aria-label="홈으로 이동">
    <img src="https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/auto_awesome/default/48px.svg" alt="AI 비서 로고" className="header-logo" />
    <span className="header-title">AI 스마트 비서</span>
  </header>
);

const HomeScreen = ({ setPage }) => (
    <div className="home-container">
      <div className="home-hero">
        <div className="hero-text">
          <h1>똑똑한 AI 비서와 함께<br />당신의 하루를 완벽하게</h1>
          <p>AI 스마트 비서가 당신의 일정을 체계적으로 관리하고, 중요한 일을 놓치지 않도록 도와드립니다.</p>
        </div>
         <div className="hero-graphic">
          <svg width="100%" height="100%" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style={{stopColor: 'rgba(79, 70, 229, 0.8)', stopOpacity: 1}} />
                <stop offset="100%" style={{stopColor: 'rgba(129, 140, 248, 0.8)', stopOpacity: 1}} />
              </linearGradient>
               <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style={{stopColor: 'rgba(219, 39, 119, 0.8)', stopOpacity: 1}} />
                <stop offset="100%" style={{stopColor: 'rgba(244, 114, 182, 0.8)', stopOpacity: 1}} />
              </linearGradient>
            </defs>
            <path fill="url(#grad1)" d="M128.1,31.5c21,11,35.1,36.5,35.1,62.9c0,42.1-39.7,76.2-88.8,76.2S-4.4,136.5-4.4,94.4S35.3,18.2,84.4,18.2c16,0,31.1,4.2,43.7,13.3Z" transform="translate(30, -10) rotate(15, 100, 100)" />
            <path fill="url(#grad2)" d="M164.3,107.2c10.4,22.2-0.6,48.2-22.8,58.6s-48.2-0.6-58.6-22.8s0.6-48.2,22.8-58.6S153.9,85.1,164.3,107.2Z" transform="translate(-20, 20) rotate(-10, 100, 100)" />
          </svg>
        </div>
      </div>

      <div className="home-features">
        <div className="home-card" onClick={() => setPage('morning')}>
            <img src="https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/light_mode/default/48px.svg" alt="" className="card-icon" />
            <div className="card-text">
                <h2>AI 오전 브리핑</h2>
                <p>오늘의 일정을 요약하고 핵심 포인트를 브리핑 받으세요.</p>
            </div>
            <span className="card-arrow">→</span>
        </div>
        <div className="home-card" onClick={() => setPage('afternoon')}>
            <img src="https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/bedtime/default/48px.svg" alt="" className="card-icon" />
            <div className="card-text">
                <h2>AI 저녁 브리핑</h2>
                <p>하루를 돌아보며 성취를 격려받고, 성장을 위한 회고를 해보세요.</p>
            </div>
            <span className="card-arrow">→</span>
        </div>
        <div className="home-card full-width" onClick={() => setPage('reminder')}>
             <img src="https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/notifications_active/default/48px.svg" alt="" className="card-icon" />
             <div className="card-text">
                <h2>AI 일정 리마인드</h2>
                <p>중요한 일정을 등록하고, 알림톡 형식으로 미리 확인하세요.</p>
             </div>
             <span className="card-arrow">→</span>
        </div>
      </div>
      <p className="privacy-note">🔒 모든 데이터는 사용자 기기에서만 처리되어 개인정보가 안전하게 보호됩니다.</p>
    </div>
);

const BriefingScreen = ({ type, onGenerate, result, error, setModalMessage, reset }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const contentRef = useRef(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            onGenerate(selectedFile, type);
        }
    };

    const handleDownloadPdf = () => {
        const { jsPDF } = jspdf;
        const content = contentRef.current;
        if (!content) return;

        setModalMessage('PDF 파일을 생성하고 있습니다...');
        html2canvas(content, { scale: 2 }).then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`${type}_briefing.pdf`);
            setModalMessage('PDF 파일이 다운로드되었습니다!');
        });
    };
    
    const handleCopy = () => {
        const content = contentRef.current;
        if (!content) return;
        navigator.clipboard.writeText(content.innerText)
            .then(() => setModalMessage('브리핑 내용이 복사되었습니다!'))
            .catch(err => setModalMessage('복사에 실패했습니다.'));
    };

    const handleContactClick = () => {
        const url = 'https://www.candidate.im/candidate-remote-consultation?utm_source=aistudio&utm_medium=display&utm_campaign=ai-assistant&utm_content=cta';
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const title = type === 'morning' ? "AI 오전 브리핑" : "AI 저녁 브리핑";
    const description = type === 'morning' ? "오늘의 일정이 담긴 캘린더 이미지를 업로드하면 하루의 시작을 위한 맞춤 브리핑을 생성해 드립니다." : "오늘 완료한 일이 담긴 이미지를 업로드하고 하루를 의미있게 마무리하는 회고를 받아보세요.";
    const uploadPrompt = type === 'morning' ? "캘린더 스크린샷" : "완료된 To-do 리스트";
    
    return (
        <div className="page-container">
            <div className="page-hero">
                <h1>{title}</h1>
                <p>{description}</p>
            </div>
            
            {error && <p className="error-message">{error}</p>}

            {!result ? (
                <div className="upload-placeholder" onClick={() => fileInputRef.current?.click()}>
                    <input type="file" accept="image/*" onChange={handleFileChange} ref={fileInputRef} style={{ display: 'none' }} />
                    <div className="upload-icon">
                        <img src="https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/upload_file/default/48px.svg" alt="Upload Icon" />
                    </div>
                    <h3>{uploadPrompt} 이미지 업로드</h3>
                    <p>파일을 드래그하거나 여기를 클릭하세요.</p>
                    <button className="btn btn-primary" type="button">파일 선택</button>
                </div>
            ) : (
                <>
                    <div id="briefing-content" ref={contentRef}>
                        {type === 'morning' ? <MorningResult data={result.data} /> : <AfternoonResult data={result.data} />}
                    </div>
                     <div className="action-buttons-grid">
                        <button className="btn btn-primary" onClick={handleContactClick}>서비스 문의하기</button>
                        <button className="btn btn-secondary" onClick={() => setModalMessage('앞으로 알림톡으로 매일 자동 브리핑 해드릴게요.')}>알림톡으로 자동 브리핑</button>
                        <button className="btn btn-secondary" onClick={handleDownloadPdf}>PDF 다운받기</button>
                        <button className="btn btn-secondary" onClick={handleCopy}>브리핑 내용 복사</button>
                        <button className="btn btn-tertiary" onClick={reset}>새로 만들기</button>
                    </div>
                </>
            )}
        </div>
    );
};

const ResultIcon = ({ symbol, alt }) => (
    <div className="result-icon-wrapper">
        <img src={`https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/${symbol}/default/48px.svg`} alt={alt} className="result-icon"/>
    </div>
);

const MorningResult = ({ data }) => (
    <div className="result-container">
        <div className="result-section">
            <ResultIcon symbol="summarize" alt="Summary Icon"/>
            <div className="result-content">
                <h3>하루 요약</h3>
                <p>{data.summary}</p>
            </div>
        </div>
        <div className="result-section">
            <ResultIcon symbol="event_list" alt="Schedule Icon"/>
            <div className="result-content">
                <h3>상세 일정 및 포인트</h3>
                {data.schedule?.map((item, index) => (
                    <div key={index} className="schedule-item">
                        <strong>{item.time} - {item.title}</strong>
                        <p>{item.keyPoint}</p>
                    </div>
                ))}
            </div>
        </div>
        <div className="result-section">
            <ResultIcon symbol="volunteer_activism" alt="Encouragement Icon"/>
            <div className="result-content">
                <h3>오늘의 응원</h3>
                <blockquote>{data.encouragement}</blockquote>
            </div>
        </div>
    </div>
);


const AfternoonResult = ({ data }) => (
    <div className="result-container">
        <div className="result-section">
            <ResultIcon symbol="celebration" alt="Achievement Icon"/>
            <div className="result-content">
                <h3>오늘의 성취</h3>
                <p>{data.summary}</p>
            </div>
        </div>
        <div className="result-section">
            <ResultIcon symbol="favorite" alt="Encouragement Icon"/>
            <div className="result-content">
                <h3>따뜻한 응원</h3>
                <blockquote>{data.encouragement}</blockquote>
            </div>
        </div>
        <div className="result-section">
            <ResultIcon symbol="psychology" alt="Reflection Icon"/>
            <div className="result-content">
                <h3>성장 포인트</h3>
                <div className="kpt-grid">
                    <div className="kpt-item"><strong>Keep (잘한 점)</strong><p>{data.reflection.keep}</p></div>
                    <div className="kpt-item"><strong>Problem (개선할 점)</strong><p>{data.reflection.problem}</p></div>
                    <div className="kpt-item"><strong>Try (시도할 것)</strong><p>{data.reflection.try}</p></div>
                </div>
            </div>
        </div>
        <div className="result-section">
            <ResultIcon symbol="help" alt="Question Icon"/>
            <div className="result-content">
                <h3>회고를 위한 질문</h3>
                <ul>
                    {data.questions?.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
            </div>
        </div>
    </div>
);


const ReminderScreen = () => {
    const [form, setForm] = useState({ date: '', title: '', description: '', phone: '' });
    const [showPreview, setShowPreview] = useState(false);
    const contentRef = useRef(null);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setForm({ ...form, [e.target.name]: e.target.value });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setShowPreview(true);
    };
    
    const handleDownloadPdf = () => {
        const { jsPDF } = jspdf;
        const content = contentRef.current;
        if (!content) return;
        
        html2canvas(content, { backgroundColor: '#FEE500', scale: 2 }).then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdf.addImage(imgData, 'PNG', 10, 10, pdfWidth - 20, pdfHeight - 20);
            pdf.save(`schedule_reminder.pdf`);
        });
    };

    const handleContactClick = () => {
        window.open('https://www.candidate.im/candidate-remote-consultation?utm_source=aistudio&utm_medium=display&utm_campaign=ai-assistant&utm_content=cta', '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="page-container">
            <div className="page-hero">
                <h1>{showPreview ? "알림톡 미리보기" : "AI 일정 리마인드"}</h1>
                <p>{showPreview ? "등록하신 일정이 아래와 같이 안내됩니다." : "안내할 일정을 입력하시면, 알림톡 화면을 미리 보여드립니다."}</p>
            </div>

            {showPreview ? (
                <div className="preview-container">
                    <div className="alimtalk-preview" ref={contentRef}>
                        <div className="alimtalk-header">[AI 스마트 비서] 일정 안내</div>
                        <div className="alimtalk-body">
                            <h4>{form.title || "일정 제목"}</h4>
                            <p><strong>[일시]</strong><br/>{form.date ? new Date(form.date).toLocaleString('ko-KR') : "날짜 및 시간"}</p>
                            <p><strong>[내용]</strong><br/>{form.description || "상세 내용"}</p>
                            <p><strong>[참석자/연락처]</strong><br/>{form.phone || "참석자 정보"}</p>
                        </div>
                    </div>
                    <div className="action-buttons-grid">
                        <button className="btn btn-primary" onClick={handleContactClick}>서비스 문의하기</button>
                        <button className="btn btn-secondary" onClick={() => setShowPreview(false)}>수정하기</button>
                        <button className="btn btn-secondary" onClick={handleDownloadPdf}>PDF 다운받기</button>
                    </div>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="form-container">
                    <div className="form-group">
                        <label htmlFor="date">날짜 및 시간</label>
                        <input type="datetime-local" id="date" name="date" value={form.date} onChange={handleChange} required />
                    </div>
                    <div className="form-group">
                        <label htmlFor="title">일정 제목</label>
                        <input type="text" id="title" name="title" value={form.title} onChange={handleChange} required placeholder="예: 2분기 실적 리뷰 회의" />
                    </div>
                    <div className="form-group">
                        <label htmlFor="description">일정 내용</label>
                        <textarea id="description" name="description" value={form.description} onChange={handleChange} required placeholder="예: 회의 안건, 준비물 등 상세 내용을 입력하세요." />
                    </div>
                    <div className="form-group">
                        <label htmlFor="phone">참석자 또는 휴대폰 번호</label>
                        <input type="tel" id="phone" name="phone" value={form.phone} onChange={handleChange} required placeholder="예: 김대리(010-1234-5678)" />
                    </div>
                    <button type="submit" className="btn btn-primary btn-full">알림톡 화면 보기</button>
                </form>
            )}
        </div>
    );
};

const LOADER_MESSAGES = [
    "AI 비서가 브리핑을 준비하고 있어요...",
    "이미지를 분석하고 있습니다...",
    "핵심 내용을 요약하는 중입니다...",
    "거의 다 됐어요! 잠시만 기다려주세요."
];

const Loader = () => {
    const [message, setMessage] = useState(LOADER_MESSAGES[0]);

    useEffect(() => {
        const interval = setInterval(() => {
            setMessage(prev => {
                const currentIndex = LOADER_MESSAGES.indexOf(prev);
                const nextIndex = (currentIndex + 1) % LOADER_MESSAGES.length;
                return LOADER_MESSAGES[nextIndex];
            });
        }, 2500);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="loader-overlay">
            <div className="loader-spinner"></div>
            <p>{message}</p>
        </div>
    );
};

const Modal = ({ message, onClose }) => (
    <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <p>{message}</p>
            <button className="btn btn-primary" onClick={onClose}>확인</button>
        </div>
    </div>
);


const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);