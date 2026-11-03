import { GoogleGenAI, Type } from '@google/genai';

// 지정 모델이 혼잡(503)하거나 한도 초과(429)면 잠시 뒤 재시도하고, 그래도 안 되면 예비 모델로 넘어갑니다.
const FALLBACK_MODEL = 'gemini-flash-latest';
const RETRYABLE = /\b(429|500|503)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded/i;

function client() {
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

async function generateJson(prompt, schema) {
  const models = [...new Set([process.env.GEMINI_MODEL || 'gemini-flash-lite-latest', FALLBACK_MODEL])];
  let lastError;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await client().models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 },
        });
        return JSON.parse(res.text);
      } catch (e) {
        lastError = e;
        if (!RETRYABLE.test(e.message)) break; // 모델 없음 등은 재시도해도 소용없음 → 다음 모델
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

// "을지로 근처 한식집 찾기", "강남대로 근처 국밥집" -> { area, keywords }
export async function parseSearchQuery(text) {
  const prompt = `사용자가 지도 검색창에 입력한 문장을 분석하세요.
- area: 검색할 구획 이름(도로명 또는 동/지명). 예: "을지로", "강남대로", "연남동". "근처", "주변" 같은 말은 빼세요.
- keywords: 사용자가 원하는 음식 종류나 메뉴. 식당 업종명이나 상호에서 찾을 수 있는 짧은 단어로, 관련어를 함께 넣으세요.
  예: "한식집" -> ["한식"], "국밥집" -> ["국밥", "순대국", "설렁탕", "해장국", "곰탕"]. 음식 조건이 없으면 빈 배열.
- description: 사용자에게 보여줄 한 줄 요약. 예: "을지로의 한식 식당".

입력: ${JSON.stringify(text)}`;
  return generateJson(prompt, {
    type: Type.OBJECT,
    properties: {
      area: { type: Type.STRING },
      keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
      description: { type: Type.STRING },
    },
    required: ['area', 'keywords', 'description'],
  });
}

// 업종 이름 목록 중 '식사를 하는 식당'이 아닌 것을 골라냅니다.
export async function findNonRestaurantCategories(categories) {
  if (categories.length === 0) return [];
  const prompt = `아래는 상가 업종 이름 목록입니다. 사람들이 식사를 하러 가는 식당(한식, 중식, 일식, 분식, 패스트푸드, 고깃집, 국밥집 등)이 아닌 업종을 모두 고르세요.
식당이 아닌 예: 편의점, 슈퍼마켓, 제과 재료상, 식품 도매, 반찬 가게, 정육점, 주류 소매, 커피/디저트 전문점, 술만 파는 주점·바, 노래방.
목록에 있는 문자열을 그대로 돌려주세요.

${JSON.stringify(categories)}`;
  const out = await generateJson(prompt, {
    type: Type.OBJECT,
    properties: { exclude: { type: Type.ARRAY, items: { type: Type.STRING } } },
    required: ['exclude'],
  });
  return out.exclude;
}
