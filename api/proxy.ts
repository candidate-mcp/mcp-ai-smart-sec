import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  console.log('=== API 프록시 함수 호출됨 ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Query:', req.query);
  
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');

  // OPTIONS 요청 처리 (preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY가 설정되지 않았습니다.');
    return res.status(500).json({ 
      error: 'GEMINI_API_KEY가 설정되지 않았습니다. Vercel 환경 변수를 확인해주세요.' 
    });
  }

  try {
    // URL에서 경로 추출
    // rewrites를 통해 /api/proxy/:path*가 /api/proxy로 오면, path는 쿼리 파라미터로 전달됨
    let path = '';
    const url = req.url || '';
    const urlObj = new URL(url, `https://${req.headers.host || 'example.com'}`);
    
    // 방법 1: 쿼리 파라미터에서 path 가져오기 (rewrites를 통해 온 경우)
    if (req.query.path) {
      path = Array.isArray(req.query.path) 
        ? req.query.path.join('/') 
        : String(req.query.path);
      try {
        path = decodeURIComponent(path);
      } catch (e) {
        // 디코딩 실패 시 원본 사용
      }
    } else {
      // 방법 2: URL에서 직접 파싱
      const pathname = urlObj.pathname;
      
      // /api/proxy/ 제거
      path = pathname.replace(/^\/api\/proxy\//, '');
    }
    
    console.log('원본 URL:', req.url);
    console.log('추출된 경로:', path);
    
    if (!path) {
      console.error('경로를 찾을 수 없습니다. query:', req.query, 'url:', req.url);
      return res.status(400).json({ 
        error: 'Invalid path', 
        query: req.query,
        url: req.url 
      });
    }
    
    // 쿼리 파라미터 재구성 (원본 쿼리 파라미터 유지, path 제외)
    const queryParams = new URLSearchParams();
    
    // 원본 URL의 쿼리 파라미터 복사 (path 제외)
    urlObj.searchParams.forEach((value, key) => {
      if (key !== 'path') {
        queryParams.append(key, value);
      }
    });
    
    // API 키 추가
    queryParams.set('key', apiKey);
    
    const baseUrl = 'https://generativelanguage.googleapis.com';
    const finalUrl = `${baseUrl}/${path}${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

    console.log('프록시 대상 URL:', finalUrl);

    // 요청 본문 처리
    let body: string | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.body) {
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        console.log('요청 본문 길이:', body.length);
      } else {
        console.warn('POST 요청인데 본문이 없습니다.');
      }
    }

    // 요청 헤더 구성
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // 원본 요청의 헤더 복사 (필요한 것만)
    if (req.headers['accept']) {
      headers['Accept'] = req.headers['accept'] as string;
    }

    console.log('프록시 요청 전송:', {
      method: req.method,
      url: finalUrl,
      hasBody: !!body
    });

    // Gemini API로 프록시 요청
    const response = await fetch(finalUrl, {
      method: req.method,
      headers,
      body,
    });

    const data = await response.text();
    
    console.log('프록시 응답:', {
      status: response.status,
      statusText: response.statusText,
      dataLength: data.length,
      contentType: response.headers.get('content-type')
    });
    
    // 응답 헤더 복사 (CORS 관련 제외, Content-Type은 명시적으로 설정)
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      // CORS 헤더는 이미 설정했으므로 제외
      // Content-Type은 원본 유지
      if (!lowerKey.startsWith('access-control-') && lowerKey !== 'content-encoding') {
        res.setHeader(key, value);
      }
    });
    
    // Content-Type이 없으면 기본값 설정
    if (!response.headers.get('content-type')) {
      res.setHeader('Content-Type', 'application/json');
    }

    return res.status(response.status).send(data);
  } catch (error: any) {
    console.error('API 프록시 오류:', error);
    return res.status(500).json({ 
      error: '프록시 요청 실패', 
      details: error.message
    });
  }
}

