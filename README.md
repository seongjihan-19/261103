# 261103 · 비플페이 지도

구획 이름(예: `을지로`)이나 문장(예: `강남대로 근처 국밥집`)을 입력하면 그 구획의 식당을 지도에 표시하고,
사용자들이 식당마다 **비플페이 가능/불가능**을 표시하는 웹 서비스입니다.

- 가능 → 형광색 테두리가 깜빡임, 불가능 → 회색, 응답 없음 → 파란색
- 응답이 엇갈리면 가장 최근 응답을 따르고, 모든 사용자 화면에 실시간 반영됩니다. (로그인 없음)

## 구조

| 역할 | 사용 기술 |
| --- | --- |
| 웹 화면 / 검색 API | Next.js (Vercel) + Leaflet + OpenStreetMap |
| 자연어 검색 해석, 식당 아닌 업종 거르기 | Gemini API |
| 데이터 저장, 실시간 갱신 | Supabase |
| 구획 경계 폴리곤, 동 이름 | Aside → 네이버 지도 (내 PC의 수집 워커) |
| 식당 목록 | 공공데이터포털 소상공인 상가(상권)정보 API (수집 워커) |

처음 검색한 구획은 `areas` 테이블에 `queued`로 등록되고, 내 PC에서 돌아가는 수집 워커가 가져가 수집합니다.
한 번 수집된 구획은 PC가 꺼져 있어도 바로 보입니다.

## 설정

1. **Supabase**: 프로젝트를 만들고 SQL Editor에서 `supabase/schema.sql` 실행
2. **키 발급**
   - Gemini: https://aistudio.google.com/apikey
   - 공공데이터포털: [소상공인시장진흥공단_상가(상권)정보](https://www.data.go.kr/data/15012005/openapi.do) 활용신청 → 일반 인증키(Decoding)
3. `.env.local`에 키 입력 (`.env.example` 참고)
4. **Aside CLI**: Aside 설정 → Developer에서 CLI 설치 후 로그인
   ```powershell
   $env:ASIDE_CLI_AUTH_PATH = 'C:\경로\aside-auth.json'
   aside login --email "you@example.com"
   ```
   Aside 설정 → Account → Devices에서 승인. 같은 경로를 `.env.local`의 `ASIDE_CLI_AUTH_PATH`에 적습니다.

## 실행

```bash
npm install
npm run dev      # 웹 (http://localhost:3000)
npm run worker   # 수집 워커 (내 PC에서 계속 켜두기)
```

## Vercel 배포

Vercel 프로젝트 환경변수에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`를 넣고 배포합니다. (공공데이터 키와 Aside 설정은 워커 전용)
