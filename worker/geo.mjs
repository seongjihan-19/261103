// GeoJSON geometry 유틸 (좌표는 [lng, lat])

function rings(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

export function isPolygon(geometry) {
  return (
    geometry &&
    (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') &&
    rings(geometry).every((poly) => Array.isArray(poly) && poly[0]?.length >= 4)
  );
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(pt, geometry) {
  return rings(geometry).some(
    ([outer, ...holes]) => inRing(pt, outer) && !holes.some((h) => inRing(pt, h)),
  );
}

export function bbox(geometry) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      minx = Math.min(minx, c[0]); maxx = Math.max(maxx, c[0]);
      miny = Math.min(miny, c[1]); maxy = Math.max(maxy, c[1]);
    } else c.forEach(walk);
  };
  walk(geometry.coordinates);
  return { minx, miny, maxx, maxy };
}

export function center(geometry) {
  const b = bbox(geometry);
  return { lat: (b.miny + b.maxy) / 2, lng: (b.minx + b.maxx) / 2 };
}

// 도로처럼 선(LineString)으로만 얻은 경우, 선을 감싸는 사각형을 meters 만큼 넓혀 구획으로 사용
export function lineToBoxPolygon(geometry, meters = 80) {
  const b = bbox(geometry);
  const dLat = meters / 111_000;
  const dLng = meters / (111_000 * Math.cos((((b.miny + b.maxy) / 2) * Math.PI) / 180));
  const [x0, y0, x1, y1] = [b.minx - dLng, b.miny - dLat, b.maxx + dLng, b.maxy + dLat];
  return { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] };
}
