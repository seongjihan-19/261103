'use client';

import { useEffect } from 'react';
import L from 'leaflet';
import { GeoJSON, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';

const SEOUL = [37.5665, 126.978];

const icons = Object.fromEntries(
  ['unknown', 'possible', 'impossible'].map((s) => [
    s,
    L.divIcon({
      className: 'pin-wrap',
      html: `<div class="pin ${s}"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -10],
    }),
  ]),
);

const STATUS_LABEL = { possible: '비플페이 가능', impossible: '비플페이 불가능', unknown: '아직 응답 없음' };

function FitToArea({ area, restaurants }) {
  const map = useMap();
  useEffect(() => {
    if (area?.polygon) {
      map.fitBounds(L.geoJSON(area.polygon).getBounds(), { padding: [20, 20] });
    } else if (restaurants.length > 0) {
      map.fitBounds(L.latLngBounds(restaurants.map((r) => [r.lat, r.lng])), { padding: [20, 20] });
    } else if (area?.center_lat) {
      map.setView([area.center_lat, area.center_lng], 16);
    }
  }, [area?.id, area?.polygon, restaurants.length, map]);
  return null;
}

export default function MapView({ area, restaurants, statuses, onVote }) {
  return (
    <MapContainer center={SEOUL} zoom={13} className="map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {area?.polygon && (
        <GeoJSON
          key={area.id}
          data={area.polygon}
          style={{ color: '#2f6fed', weight: 2, fillOpacity: 0.06 }}
        />
      )}
      {restaurants.map((r) => {
        const status = statuses[r.id] || 'unknown';
        return (
          <Marker key={r.id} position={[r.lat, r.lng]} icon={icons[status]}>
            <Popup>
              <div className="popup">
                <h3>{r.name}{r.branch ? ` ${r.branch}` : ''}</h3>
                {r.category && <p>{r.category}</p>}
                <p>{r.road_address || r.address}</p>
                {r.dong && <p>{r.dong}{r.legal_dong && r.legal_dong !== r.dong ? ` (${r.legal_dong})` : ''}</p>}
                <div className="now">현재: {STATUS_LABEL[status]}</div>
                <div className="vote">
                  <button className="yes" onClick={() => onVote(r.id, 'possible')}>비플페이 가능</button>
                  <button className="no" onClick={() => onVote(r.id, 'impossible')}>불가능</button>
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
      <FitToArea area={area} restaurants={restaurants} />
    </MapContainer>
  );
}
