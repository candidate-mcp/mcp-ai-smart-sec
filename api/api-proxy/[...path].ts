import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  console.log('=== API 프록시 함수 호출됨 ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Query:', req.query);
  console.log('Body:', req.body ? 'present' : 'empty');
  
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
    // 경로 재구성 - Vercel의 [...path]는 배열로 전달됨
    let path = '';
    if (Array.isArray(req.query.path)) {
      path = req.query.path.join('/');
    } else if (req.query.path) {
      path = String(req.query.path);
    }
    
    // URL 디코딩 (필요한 경우)
    try {
      path = decodeURIComponent(path);
    } catch (e) {
      // 디코딩 실패 시 원본 사용
      console.warn('URL 디코딩 실패, 원본 사용:', path);
    }
    
    console.log('추출된 경로:', path);
    
    if (!path) {
      console.error('경로를 찾을 수 없습니다. query:', req.query);
      return res.status(400).json({ 
        error: 'Invalid path', 
        query: req.query,
        url: req.url 
      });
    }
    
    // 쿼리 파라미터 재구성 (path 제외 - Vercel의 catch-all 라우팅 파라미터)
    const queryParams = new URLSearchParams();
    Object.entries(req.query).forEach(([key, value]) => {
      // 'path'는 Vercel의 catch-all 라우팅 파라미터이므로 제외
      if (key !== 'path' && value) {
        if (Array.isArray(value)) {
          value.forEach(v => queryParams.append(key, String(v)));
        } else {
          queryParams.append(key, String(value));
        }
      }
    });
    
    // API 키만 추가 (다른 쿼리 파라미터는 제외)
    queryParams.set('key', apiKey);
    
    const baseUrl = 'https://generativelanguage.googleapis.com';
    const finalUrl = `${baseUrl}/${path}${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    
    console.log('쿼리 파라미터 (path 제외):', Array.from(queryParams.entries()));

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
      hasBody: !!body,
      headers
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
      dataPreview: data.substring(0, 200)
    });
    
    // 응답 헤더 복사 (CORS 관련 제외)
    response.headers.forEach((value, key) => {
      // CORS 헤더는 이미 설정했으므로 제외
      if (!key.toLowerCase().startsWith('access-control-')) {
        res.setHeader(key, value);
      }
    });

    return res.status(response.status).send(data);
  } catch (error: any) {
    console.error('API 프록시 오류:', error);
    return res.status(500).json({ 
      error: '프록시 요청 실패', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

