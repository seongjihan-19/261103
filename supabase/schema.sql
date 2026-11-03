-- 비플페이 지도 스키마. Supabase SQL Editor에서 한 번 실행하세요.

-- 구획: 검색된 도로명/지명 하나가 한 행. status가 수집 대기열 역할도 합니다.
create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                 -- 예: '을지로'
  dong_names text[] not null default '{}',   -- 구획이 걸친 동 이름들
  polygon jsonb,                             -- GeoJSON Polygon / MultiPolygon geometry
  center_lat double precision,
  center_lng double precision,
  status text not null default 'queued'
    check (status in ('queued', 'collecting', 'ready', 'failed')),
  error text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete cascade,
  source_id text not null,                   -- 상가업소번호 (bizesId)
  name text not null,
  branch text,
  category text,                             -- 업종, 예: '한식>국밥·탕'
  address text,                              -- 지번 주소
  road_address text,
  dong text,                                 -- 행정동
  legal_dong text,                           -- 법정동
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now(),
  unique (area_id, source_id)
);
create index if not exists restaurants_area_idx on public.restaurants(area_id);

-- 비플페이 응답 기록. 같은 식당에 응답이 엇갈리면 가장 최근 응답을 따릅니다.
create table if not exists public.votes (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  status text not null check (status in ('possible', 'impossible')),
  created_at timestamptz not null default now()
);
create index if not exists votes_restaurant_idx on public.votes(restaurant_id, created_at desc);

create or replace view public.restaurant_status
with (security_invoker = true) as
select distinct on (restaurant_id) restaurant_id, status, created_at
from public.votes
order by restaurant_id, created_at desc;

-- RLS: 로그인 없이 누구나 읽고 투표할 수 있음. 구획/식당 쓰기는 서버(service role)만.
alter table public.areas enable row level security;
alter table public.restaurants enable row level security;
alter table public.votes enable row level security;

drop policy if exists "areas readable" on public.areas;
create policy "areas readable" on public.areas for select using (true);

drop policy if exists "restaurants readable" on public.restaurants;
create policy "restaurants readable" on public.restaurants for select using (true);

drop policy if exists "votes readable" on public.votes;
create policy "votes readable" on public.votes for select using (true);

drop policy if exists "anyone can vote" on public.votes;
create policy "anyone can vote" on public.votes for insert with check (true);

-- 실시간 갱신 대상
alter publication supabase_realtime add table public.areas;
alter publication supabase_realtime add table public.votes;
