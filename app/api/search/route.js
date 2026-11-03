import { NextResponse } from 'next/server';
import { parseSearchQuery } from '@/lib/gemini';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';

const ROAD_OR_PLACE = /^[가-힣0-9A-Za-z\s]{1,30}$/;

export async function POST(req) {
  const { query } = await req.json().catch(() => ({}));
  const text = typeof query === 'string' ? query.trim() : '';
  if (!text || text.length > 100) {
    return NextResponse.json({ error: '검색어를 입력해 주세요.' }, { status: 400 });
  }

  // 짧은 구획 이름만 입력했으면 AI 없이 바로 사용, 문장이면 Gemini로 해석
  let parsed;
  if (/^[가-힣0-9]+(로|길|동|가)$/.test(text)) {
    parsed = { area: text, keywords: [], description: `${text}의 식당` };
  } else {
    try {
      parsed = await parseSearchQuery(text);
    } catch (e) {
      console.error('gemini parse failed', e);
      parsed = { area: text, keywords: [], description: `${text}의 식당` };
    }
  }

  const area = (parsed.area || '').trim();
  if (!ROAD_OR_PLACE.test(area)) {
    return NextResponse.json({ error: '구획 이름을 알아듣지 못했어요. 예: 을지로' }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { data: existing, error } = await db.from('areas').select('*').eq('name', area).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let row = existing;
  if (!row) {
    const { data, error: insErr } = await db.from('areas').insert({ name: area }).select().single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    row = data;
  } else if (row.status === 'failed') {
    // 실패했던 구획은 다시 검색하면 재수집
    const { data } = await db
      .from('areas')
      .update({ status: 'queued', error: null, requested_at: new Date().toISOString() })
      .eq('id', row.id)
      .select()
      .single();
    row = data;
  }

  return NextResponse.json({
    area: row,
    keywords: parsed.keywords || [],
    description: parsed.description,
  });
}
