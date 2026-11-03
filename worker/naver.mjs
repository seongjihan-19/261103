// Aside REPL로 네이버 지도를 열어 구획 경계 폴리곤과 주소 정보를 가져옵니다.
// 네이버 지도 화면이 경계를 그릴 때 스스로 불러오는 /p/api/polygon, /p/api/entry/addressInfo
// 응답을 같은 페이지 안에서 다시 읽기만 합니다. (검색 API 직접 호출은 캡차가 걸리므로 하지 않음)

import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

function replCode(query) {
  return `
const q_ = ${JSON.stringify(query)};
const tab_ = await openTab('https://map.naver.com/p/search/' + encodeURIComponent(q_));
let polyUrl_ = null, addrUrl_ = null;
for (let i = 0; i < 24 && !polyUrl_; i++) {
  await sleep(500);
  const names_ = await tab_.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name));
  polyUrl_ = names_.find((u) => u.includes('/p/api/polygon')) || null;
  addrUrl_ = names_.find((u) => u.includes('/p/api/entry/addressInfo')) || null;
}
const get_ = async (u) => (u ? tab_.evaluate(async (url) => { const r = await fetch(url, { credentials: 'include' }); return r.ok ? r.json() : null; }, u) : null);
const polygon_ = await get_(polyUrl_);
const address_ = (await get_(addrUrl_))?.address ?? null;
await closeTab(tab_);
console.log('<<<JSON' + JSON.stringify({ polygon: polygon_, address: address_ }) + 'JSON>>>');
`;
}

async function searchNaver(query) {
  const env = { ...process.env };
  if (!env.ASIDE_CLI_AUTH_PATH) delete env.ASIDE_CLI_AUTH_PATH;
  const { stdout } = await run(process.env.ASIDE_CLI || 'aside', ['repl', replCode(query)], {
    env,
    timeout: 3 * 60_000,
    maxBuffer: 50 * 1024 * 1024,
  });
  await writeFile(new URL('./last-aside-output.txt', import.meta.url), stdout).catch(() => {});
  const m = stdout.match(/<<<JSON([\s\S]*?)JSON>>>/);
  if (!m) throw new Error('Aside 응답에서 결과를 찾지 못했어요 (worker/last-aside-output.txt 확인)');
  return JSON.parse(m[1]);
}

// FeatureCollection -> 하나의 MultiPolygon geometry
function mergeFeatures(fc) {
  const polys = [];
  for (const f of fc?.features || []) {
    const g = f.geometry;
    if (g?.type === 'Polygon') polys.push(g.coordinates);
    if (g?.type === 'MultiPolygon') polys.push(...g.coordinates);
  }
  return polys.length > 0 ? { type: 'MultiPolygon', coordinates: polys } : null;
}

// "을지로"처럼 도로명은 네이버에 폴리곤이 없으므로 "을지로동"으로 한 번 더 찾습니다.
export async function fetchNaverArea(name) {
  const candidates = /(동|가|읍|면|리)$/.test(name) ? [name] : [name, `${name}동`];
  for (const query of candidates) {
    const { polygon, address } = await searchNaver(query);
    const geometry = mergeFeatures(polygon);
    if (geometry) {
      const short = address?.shortAddress || [];
      return {
        geometry,
        matchedQuery: query,
        dongNames: short.length > 0 ? [short[short.length - 1]] : [],
        placeNames: [address?.address, ...short.slice(0, -1)].filter(Boolean),
        regionCode: address?.rCode || null,
      };
    }
  }
  return null;
}
