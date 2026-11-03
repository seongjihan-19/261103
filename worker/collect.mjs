// 수집 워커: 내 PC에서 실행합니다. (npm run worker)
// Supabase의 areas 테이블에서 status='queued'인 구획을 가져와
//   1) Aside로 네이버 지도에서 구획 경계 폴리곤과 동 이름을 얻고
//   2) 공공데이터포털 소상공인 상가정보에서 그 안의 음식점을 모으고
//   3) Gemini로 식당이 아닌 업종을 걸러낸 뒤 저장합니다.

import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { findNonRestaurantCategories } from '../lib/gemini.js';
import { bbox, center, isPolygon, lineToBoxPolygon, pointInGeometry } from './geo.mjs';
import { fetchNaverArea } from './naver.mjs';

const db = getSupabaseAdmin();
const POLL_MS = 5000;
const STORE_API = 'https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRectangle';
const FOOD_CODE = 'I2'; // 상권정보 업종 대분류: 음식

// ---------- 1. Aside: 네이버 지도 구획 폴리곤 ----------

// 네이버에 경계가 없는 경우(도로명 등): OpenStreetMap Nominatim으로 대체
async function nominatim(name) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q: name, countrycodes: 'kr', format: 'json', polygon_geojson: '1', limit: '1' });
  const res = await fetch(url, { headers: { 'User-Agent': 'beeple-pay-map/0.1 (student project)' } });
  const [hit] = await res.json();
  return hit?.geojson || null;
}

async function resolveArea(name) {
  try {
    const naver = await fetchNaverArea(name);
    if (naver) {
      console.log(`[${name}] 네이버 경계: ${naver.matchedQuery} (${naver.placeNames[0] || ''})`);
      return naver;
    }
  } catch (e) {
    console.warn(`[${name}] Aside 실패: ${e.message}`);
  }
  console.warn(`[${name}] 네이버 폴리곤 없음 → Nominatim으로 대체`);
  let geometry = await nominatim(name);
  if (!geometry) throw new Error('구획 경계를 찾지 못했어요');
  if (!isPolygon(geometry)) geometry = lineToBoxPolygon(geometry);
  return { geometry, dongNames: [], placeNames: [] };
}

// ---------- 2. 공공데이터: 소상공인 상가정보 ----------

async function fetchStores(geometry) {
  const { minx, miny, maxx, maxy } = bbox(geometry);
  const items = [];
  for (let page = 1; page <= 50; page++) {
    const url = new URL(STORE_API);
    url.search = new URLSearchParams({
      serviceKey: process.env.DATA_GO_KR_SERVICE_KEY,
      pageNo: String(page),
      numOfRows: '1000',
      minx: String(minx), miny: String(miny), maxx: String(maxx), maxy: String(maxy),
      indsLclsCd: FOOD_CODE,
      type: 'json',
    });
    const res = await fetch(url);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`상가정보 API 오류: ${text.slice(0, 200)}`); }
    const code = json.header?.resultCode;
    if (code === '03') break; // NODATA
    if (code !== '00') throw new Error(`상가정보 API 오류 ${code}: ${json.header?.resultMsg}`);
    const pageItems = json.body?.items || [];
    items.push(...pageItems);
    if (items.length >= Number(json.body?.totalCount || 0) || pageItems.length === 0) break;
  }
  return items.filter((s) => pointInGeometry([Number(s.lon), Number(s.lat)], geometry));
}

// ---------- 3. Gemini 필터 + 저장 ----------

const categoryOf = (s) => [s.indsMclsNm, s.indsSclsNm].filter(Boolean).join('>');

async function collect(area) {
  console.log(`[${area.name}] 수집 시작`);
  const { geometry, dongNames, placeNames } = await resolveArea(area.name);

  const stores = await fetchStores(geometry);
  console.log(`[${area.name}] 구획 안 음식 업종 ${stores.length}곳`);

  const categories = [...new Set(stores.map(categoryOf))];
  let exclude = new Set();
  try {
    exclude = new Set(await findNonRestaurantCategories(categories));
  } catch (e) {
    console.warn(`[${area.name}] Gemini 필터 실패, 전체 저장: ${e.message}`);
  }
  const restaurants = stores
    .filter((s) => !exclude.has(categoryOf(s)))
    .map((s) => ({
      area_id: area.id,
      source_id: s.bizesId,
      name: s.bizesNm,
      branch: s.brchNm || null,
      category: categoryOf(s),
      address: s.lnoAdr,
      road_address: s.rdnmAdr,
      dong: s.adongNm,
      legal_dong: s.ldongNm,
      lat: Number(s.lat),
      lng: Number(s.lon),
    }));
  console.log(`[${area.name}] 식당 아닌 업종 ${exclude.size}종 제외 → ${restaurants.length}곳 저장`);
  if (exclude.size > 0) console.log(`[${area.name}] 제외 업종: ${[...exclude].join(', ')}`);

  for (let i = 0; i < restaurants.length; i += 500) {
    const { error } = await db
      .from('restaurants')
      .upsert(restaurants.slice(i, i + 500), { onConflict: 'area_id,source_id' });
    if (error) throw new Error(error.message);
  }

  // 재수집 시: 이번에 식당이 아니라고 걸러진 업소가 예전에 저장돼 있으면 정리
  const excludedIds = stores.filter((s) => exclude.has(categoryOf(s))).map((s) => s.bizesId);
  for (let i = 0; i < excludedIds.length; i += 200) {
    const { error } = await db
      .from('restaurants')
      .delete()
      .eq('area_id', area.id)
      .in('source_id', excludedIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }

  const dongs = dongNames.length > 0 ? dongNames : [...new Set(restaurants.map((r) => r.dong).filter(Boolean))];
  const c = center(geometry);
  const { error } = await db
    .from('areas')
    .update({
      status: 'ready',
      polygon: geometry,
      dong_names: [...new Set([...dongs, ...placeNames])],
      center_lat: c.lat,
      center_lng: c.lng,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', area.id);
  if (error) throw new Error(error.message);
  console.log(`[${area.name}] 완료`);
}

async function claimNext() {
  const { data: next } = await db
    .from('areas')
    .select('*')
    .eq('status', 'queued')
    .order('requested_at')
    .limit(1)
    .maybeSingle();
  if (!next) return null;
  // 다른 워커가 먼저 가져가지 않았을 때만 차지
  const { data } = await db
    .from('areas')
    .update({ status: 'collecting', updated_at: new Date().toISOString() })
    .eq('id', next.id)
    .eq('status', 'queued')
    .select()
    .maybeSingle();
  return data;
}

async function main() {
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DATA_GO_KR_SERVICE_KEY', 'GEMINI_API_KEY']) {
    if (!process.env[k]) throw new Error(`.env.local에 ${k}가 없어요`);
  }
  // 워커가 꺼진 사이 'collecting'에 멈춘 구획을 다시 대기열로
  await db.from('areas').update({ status: 'queued' }).eq('status', 'collecting');
  console.log('수집 워커 대기 중… (Ctrl+C로 종료)');

  for (;;) {
    const area = await claimNext().catch((e) => (console.error(e.message), null));
    if (!area) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    try {
      await collect(area);
    } catch (e) {
      console.error(`[${area.name}] 실패: ${e.message}`);
      await db
        .from('areas')
        .update({ status: 'failed', error: e.message, updated_at: new Date().toISOString() })
        .eq('id', area.id);
    }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
