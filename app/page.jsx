'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { getSupabase } from '@/lib/supabaseBrowser';

const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

const AREA_STATUS = {
  queued: '수집 대기 중… (수집 PC가 켜져 있어야 진행돼요)',
  collecting: '네이버 지도에서 구획을, 공공데이터에서 식당을 모으는 중…',
  failed: '수집에 실패했어요. 다시 검색하면 재시도합니다.',
};

export default function Home() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [area, setArea] = useState(null);
  const [keywords, setKeywords] = useState([]);
  const [description, setDescription] = useState('');
  const [restaurants, setRestaurants] = useState([]);
  const [statuses, setStatuses] = useState({});

  const supabase = getSupabase();

  async function onSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '검색에 실패했어요.');
      setRestaurants([]);
      setStatuses({});
      setArea(json.area);
      setKeywords(json.keywords);
      setDescription(json.description);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // 구획 수집 상태 실시간 반영
  useEffect(() => {
    if (!area?.id) return;
    const ch = supabase
      .channel(`area-${area.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'areas', filter: `id=eq.${area.id}` },
        (payload) => setArea(payload.new),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [area?.id, supabase]);

  // 수집이 끝난 구획의 식당과 최신 비플페이 상태 불러오기
  useEffect(() => {
    if (area?.status !== 'ready') return;
    let cancelled = false;
    (async () => {
      const { data: rs, error: rErr } = await supabase
        .from('restaurants')
        .select('*')
        .eq('area_id', area.id)
        .limit(5000);
      if (rErr) return setError(rErr.message);
      const ids = rs.map((r) => r.id);
      const map = {};
      for (let i = 0; i < ids.length; i += 200) {
        const { data: st } = await supabase
          .from('restaurant_status')
          .select('restaurant_id,status')
          .in('restaurant_id', ids.slice(i, i + 200));
        for (const s of st || []) map[s.restaurant_id] = s.status;
      }
      if (!cancelled) {
        setRestaurants(rs);
        setStatuses(map);
      }
    })();
    return () => { cancelled = true; };
  }, [area?.id, area?.status, supabase]);

  // 다른 사용자의 응답 실시간 반영 (가장 최근 응답이 이김)
  useEffect(() => {
    const ch = supabase
      .channel('votes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'votes' }, (payload) => {
        const v = payload.new;
        setStatuses((prev) => ({ ...prev, [v.restaurant_id]: v.status }));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase]);

  const onVote = useCallback(
    async (restaurantId, status) => {
      setStatuses((prev) => ({ ...prev, [restaurantId]: status }));
      const { error: vErr } = await supabase.from('votes').insert({ restaurant_id: restaurantId, status });
      if (vErr) setError(`저장 실패: ${vErr.message}`);
    },
    [supabase],
  );

  const visible = useMemo(() => {
    if (keywords.length === 0) return restaurants;
    return restaurants.filter((r) => {
      const hay = `${r.name} ${r.category || ''}`;
      return keywords.some((k) => hay.includes(k));
    });
  }, [restaurants, keywords]);

  const counts = useMemo(() => {
    const c = { possible: 0, impossible: 0 };
    for (const r of visible) if (statuses[r.id]) c[statuses[r.id]]++;
    return c;
  }, [visible, statuses]);

  return (
    <main className="app">
      <header className="topbar">
        <h1>비플페이 지도</h1>
        <form className="search" onSubmit={onSearch}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="구획 이름 또는 문장 (예: 을지로, 강남대로 근처 국밥집)"
            aria-label="검색어"
          />
          <button disabled={loading}>{loading ? '검색 중…' : '검색'}</button>
        </form>
      </header>

      <div className="statusbar">
        {error && <span className="error">{error}</span>}
        {!error && !area && <span>도로명이나 지명을 입력하면 그 구획의 식당을 지도에 표시해요.</span>}
        {area && area.status !== 'ready' && <span>{area.name}: {AREA_STATUS[area.status]}</span>}
        {area?.status === 'ready' && (
          <>
            <span>
              {description || area.name} · {visible.length}곳
              {area.dong_names?.length > 0 && ` · ${area.dong_names.join(', ')}`}
            </span>
            {keywords.length > 0 && (
              <span className="chip">
                {keywords.join(', ')}
                <button onClick={() => setKeywords([])} aria-label="필터 해제">×</button>
              </span>
            )}
            <span>가능 {counts.possible} · 불가능 {counts.impossible}</span>
          </>
        )}
        <span className="legend">
          <span><span className="pin possible" style={{ width: 12, height: 12, borderWidth: 2 }} />가능</span>
          <span><span className="pin impossible" style={{ width: 12, height: 12, borderWidth: 2 }} />불가능</span>
          <span><span className="pin" style={{ width: 12, height: 12, borderWidth: 2 }} />미확인</span>
        </span>
      </div>

      <MapView area={area} restaurants={visible} statuses={statuses} onVote={onVote} />
    </main>
  );
}
