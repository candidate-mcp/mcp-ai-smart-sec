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
    // 경로 재구성 - Vercel의 [...slug]는 배열로 전달됨
    let path = '';
    if (Array.isArray(req.query.slug)) {
      path = req.query.slug.join('/');
    } else if (req.query.slug) {
      path = String(req.query.slug);
    }
    
    // URL 디코딩 (필요한 경우)
    try {
      path = decodeURIComponent(path);
    } catch (e) {
      // 디코딩 실패 시 원본 사용
    }
    
    console.log('API 프록시 요청:', {
      method: req.method,
      path,
      hasBody: !!req.body,
      query: req.query
    });
    
    // 쿼리 파라미터 재구성 (slug 제외)
    const queryParams = new URLSearchParams();
    Object.entries(req.query).forEach(([key, value]) => {
      if (key !== 'slug' && value) {
        if (Array.isArray(value)) {
          value.forEach(v => queryParams.append(key, String(v)));
        } else {
          queryParams.append(key, String(value));
        }
      }
    });
    
    // API 키 추가
    queryParams.set('key', apiKey);
    
    const baseUrl = 'https://generativelanguage.googleapis.com';
    const url = `${baseUrl}/${path}${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

    console.log('프록시 대상 URL:', url);

    // 요청 본문 처리
    let body: string | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.body) {
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
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

    // Gemini API로 프록시 요청
    const response = await fetch(url, {
      method: req.method,
      headers,
      body,
    });

    const data = await response.text();
    
    console.log('프록시 응답:', {
      status: response.status,
      statusText: response.statusText,
      dataLength: data.length
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

