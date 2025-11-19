# 바이브코딩 AI 앱 Vercel 배포 가이드

바이브코딩으로 만든 AI 앱을 Vercel에 배포하기 위한 체크리스트입니다.

## 1. 프로젝트 구조 확인

### 필수 파일 확인
- [ ] `package.json` - 빌드 스크립트 확인 (`"build": "vite build"`)
- [ ] `vite.config.ts` - Vite 설정 확인
- [ ] `index.html` - 진입점 확인
- [ ] `.gitignore` - `.env` 파일 제외 확인

### Service Worker 확인
- [ ] `service-worker.js` 파일이 `public/` 폴더에 있는지 확인
  - Vite는 `public/` 폴더의 파일만 빌드 시 복사합니다
  - 만약 루트에 있다면: `mkdir -p public && mv service-worker.js public/`

## 2. API 프록시 함수 생성 (필요한 경우)

Service Worker나 클라이언트에서 외부 API를 직접 호출하는 경우, CORS 문제를 해결하기 위해 프록시 함수가 필요합니다.

### 2.1 프록시 함수 파일 생성

`api/proxy.ts` 파일 생성:

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');

  // OPTIONS 요청 처리
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const apiKey = process.env.YOUR_API_KEY; // 환경 변수에서 API 키 가져오기
  if (!apiKey) {
    return res.status(500).json({ 
      error: 'API 키가 설정되지 않았습니다.' 
    });
  }

  try {
    // URL에서 경로 추출
    const url = req.url || '';
    const urlObj = new URL(url, `https://${req.headers.host || 'example.com'}`);
    const pathname = urlObj.pathname;
    
    // /api/proxy/ 제거하여 실제 API 경로 추출
    const path = pathname.replace(/^\/api\/proxy\//, '');
    
    if (!path) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    // 쿼리 파라미터 재구성
    const queryParams = new URLSearchParams();
    urlObj.searchParams.forEach((value, key) => {
      if (key !== 'path') {
        queryParams.append(key, value);
      }
    });
    
    // API 키 추가
    queryParams.set('key', apiKey);
    
    // 대상 API URL 구성
    const baseUrl = 'https://your-api-domain.com'; // 실제 API 도메인으로 변경
    const finalUrl = `${baseUrl}/${path}${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

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
    
    if (req.headers['accept']) {
      headers['Accept'] = req.headers['accept'] as string;
    }

    // API로 프록시 요청
    const response = await fetch(finalUrl, {
      method: req.method,
      headers,
      body,
    });

    const data = await response.text();
    
    // 응답 헤더 복사
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
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
```

### 2.2 Service Worker 경로 수정

Service Worker에서 프록시 경로 사용:

```javascript
// service-worker.js
const proxyUrl = `${self.location.origin}/api/proxy${remainingPathAndQuery}`;
```

### 2.3 iOS 워크어라운드 경로 수정 (있는 경우)

```typescript
// index.tsx 또는 해당 파일
const newUrl = `/api/proxy${resource.substring(targetPrefix.length)}`;
```

## 3. vercel.json 설정

프로젝트 루트에 `vercel.json` 파일 생성:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "headers": [
    {
      "source": "/service-worker.js",
      "headers": [
        {
          "key": "Content-Type",
          "value": "application/javascript"
        },
        {
          "key": "Service-Worker-Allowed",
          "value": "/"
        }
      ]
    }
  ],
  "rewrites": [
    {
      "source": "/api/proxy/:path*",
      "destination": "/api/proxy"
    },
    {
      "source": "/((?!api|service-worker\\.js).*)",
      "destination": "/index.html"
    }
  ]
}
```

### 주요 설정 설명:
- `buildCommand`: Vite 빌드 명령어
- `outputDirectory`: 빌드 출력 디렉토리 (Vite 기본값: `dist`)
- `framework`: Vite 프레임워크 지정
- `headers`: Service Worker에 올바른 MIME type 설정
- `rewrites`: 
  - `/api/proxy/*` 경로를 프록시 함수로 라우팅
  - 나머지 경로는 SPA 라우팅을 위해 `index.html`로 리다이렉트

## 4. package.json 설정

### 4.1 Node.js 버전 설정

```json
{
  "engines": {
    "node": "22.x"
  }
}
```

### 4.2 의존성 확인

```json
{
  "devDependencies": {
    "@vercel/node": "^3.1.0",
    "@types/node": "^22.14.0"
  }
}
```

### 4.3 .nvmrc 파일 생성 (선택사항)

프로젝트 루트에 `.nvmrc` 파일 생성:

```
22
```

## 5. 환경 변수 설정

### 5.1 .gitignore 확인

`.gitignore`에 다음이 포함되어 있는지 확인:

```
.env
.env.local
.env.*.local
```

### 5.2 Vercel 환경 변수 설정

1. Vercel 대시보드 → 프로젝트 선택
2. Settings → Environment Variables
3. 다음 환경 변수 추가:
   - `YOUR_API_KEY` (실제 API 키 이름으로 변경)
   - Production, Preview, Development 모두에 추가

## 6. GitHub 저장소 준비

### 6.1 Git 초기화 (아직 안 된 경우)

```bash
git init
git remote add origin https://github.com/your-username/your-repo.git
```

### 6.2 커밋 및 푸시

```bash
git add .
git commit -m "Vercel 배포 준비 완료"
git push -u origin main
```

## 7. Vercel 배포

### 7.1 프로젝트 연결

1. [Vercel 대시보드](https://vercel.com) 접속
2. "Add New Project" 클릭
3. GitHub 저장소 선택
4. Vercel이 자동으로 Vite 프로젝트를 감지합니다

### 7.2 환경 변수 설정

프로젝트 설정에서 환경 변수 추가 (5.2 참조)

### 7.3 배포 확인

- 빌드 로그 확인
- 배포 완료 후 Functions 탭에서 API 함수 확인
- 배포 URL에서 앱 테스트

## 8. 문제 해결 체크리스트

### 8.1 Service Worker 404 에러
- [ ] `service-worker.js`가 `public/` 폴더에 있는지 확인
- [ ] `vercel.json`의 `headers` 설정 확인
- [ ] 브라우저 콘솔에서 Service Worker 등록 확인

### 8.2 API 프록시 404 에러
- [ ] `api/proxy.ts` 파일이 존재하는지 확인
- [ ] Service Worker 경로가 `/api/proxy`인지 확인
- [ ] `vercel.json`의 `rewrites` 설정 확인

### 8.3 API 프록시 400/500 에러
- [ ] Vercel 함수 로그 확인
- [ ] 환경 변수가 올바르게 설정되었는지 확인
- [ ] API 키가 유효한지 확인
- [ ] 경로 파싱이 올바른지 확인

### 8.4 Node.js 버전 에러
- [ ] `package.json`의 `engines.node` 확인
- [ ] Vercel이 요구하는 버전 확인 (현재 22.x 권장)
- [ ] `.nvmrc` 파일 확인

### 8.5 빌드 실패
- [ ] `package.json`의 빌드 스크립트 확인
- [ ] 의존성 설치 확인
- [ ] TypeScript 타입 에러 확인

## 9. 빠른 참조: 주요 파일 구조

```
프로젝트/
├── api/
│   └── proxy.ts              # API 프록시 함수
├── public/
│   └── service-worker.js     # Service Worker
├── index.html                # 진입점
├── index.tsx                 # 메인 앱 코드
├── vite.config.ts            # Vite 설정
├── package.json              # 프로젝트 설정
├── vercel.json               # Vercel 설정
├── .nvmrc                    # Node.js 버전
└── .gitignore                # Git 제외 파일
```

## 10. 다음 단계

배포 완료 후:
1. [ ] 앱 기능 테스트
2. [ ] API 호출 확인
3. [ ] Service Worker 동작 확인
4. [ ] 모바일 디바이스 테스트 (iOS/Android)
5. [ ] 성능 모니터링 설정 (선택사항)

---

## 참고사항

- Vercel은 `api/` 폴더의 파일을 자동으로 Serverless Function으로 인식합니다
- Service Worker는 HTTPS에서만 작동합니다 (Vercel은 자동으로 HTTPS 제공)
- 환경 변수는 빌드 시점과 런타임 모두에서 사용 가능합니다
- Vercel Functions는 자동으로 스케일링됩니다

