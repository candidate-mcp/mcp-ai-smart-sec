import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
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
    return res.status(500).json({ 
      error: 'GEMINI_API_KEY가 설정되지 않았습니다. Vercel 환경 변수를 확인해주세요.' 
    });
  }

  try {
    // 경로 재구성
    const path = Array.isArray(req.query.path) 
      ? req.query.path.join('/') 
      : req.query.path || '';
    
    // 쿼리 파라미터 재구성 (path 제외)
    const queryParams = new URLSearchParams();
    Object.entries(req.query).forEach(([key, value]) => {
      if (key !== 'path' && value) {
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

    // 요청 본문 처리
    let body: string | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    // 요청 헤더 구성
    const headers: Record<string, string> = {};
    if (req.headers['content-type']) {
      headers['Content-Type'] = req.headers['content-type'] as string;
    }
    if (req.headers['accept']) {
      headers['Accept'] = req.headers['accept'] as string;
    }

    // Gemini API로 프록시 요청
    const response = await fetch(url, {
      method: req.method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body,
    });

    const data = await response.text();
    
    // 응답 헤더 복사
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    return res.status(response.status).send(data);
  } catch (error: any) {
    console.error('API 프록시 오류:', error);
    return res.status(500).json({ 
      error: '프록시 요청 실패', 
      details: error.message 
    });
  }
}

