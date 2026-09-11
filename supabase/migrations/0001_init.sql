-- Kada: live campus snack availability
-- Availability is never stored as a boolean. It is derived from a decaying,
-- weighted ledger of signals (`reports`) collapsed into `item_state` by trigger.

create extension if not exists pgcrypto;

do $$ begin
  create type signal_kind   as enum ('available','low','sold_out');
  create type report_source as enum ('student','vendor');
  create type avail_state   as enum ('available','low','sold_out','uncertain','unknown');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables

create table if not exists shops (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  subtitle   text,
  lat        double precision,
  lng        double precision,
  opens_at   time,
  closes_at  time,
  pin_hash   text,
  sort_order int  not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists items (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references shops(id) on delete cascade,
  name        text not null,
  emoji       text,
  price_paise int,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists items_shop_idx on items (shop_id, sort_order);

-- One row per reporting device. `alpha`/`beta` are a Beta posterior over
-- "this device tells the truth", seeded neutral at (2,2).
create table if not exists devices (
  id           uuid primary key,
  alpha        numeric not null default 2,
  beta         numeric not null default 2,
  report_count int     not null default 0,
  blocked      boolean not null default false,
  verified     boolean not null default false,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists reports (
  id              bigint generated always as identity primary key,
  item_id         uuid not null references items(id) on delete cascade,
  device_id       uuid references devices(id) on delete set null,
  signal          signal_kind   not null,
  source          report_source not null default 'student',
  vendor_count    int,
  weight_at_write numeric not null,
  geo_verified    boolean not null default false,
  ip_hash         text,
  counted         boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists reports_item_recent_idx on reports (item_id, created_at desc);
create index if not exists reports_device_recent_idx on reports (device_id, created_at desc);

create table if not exists item_state (
  item_id           uuid primary key references items(id) on delete cascade,
  state             avail_state not null default 'unknown',
  score             numeric not null default 0,
  confidence        numeric not null default 0,
  top_weight        numeric not null default 0,
  last_vendor_count int,
  last_vendor_at    timestamptz,
  last_signal_at    timestamptz,
  est_sellout_at    timestamptz,
  contributors      int not null default 0,
  updated_at        timestamptz not null default now()
);

create table if not exists depletion_stats (
  item_id     uuid references items(id) on delete cascade,
  dow         smallint not null,
  hour_bucket smallint not null,
  avg_rate    numeric  not null default 0,   -- units per minute
  samples     int      not null default 0,
  primary key (item_id, dow, hour_bucket)
);

create table if not exists vendor_sessions (
  token      uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references shops(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '16 hours'
);

create table if not exists pin_attempts (
  id           bigint generated always as identity primary key,
  shop_id      uuid references shops(id) on delete cascade,
  fingerprint  text not null,
  ok           boolean not null,
  attempted_at timestamptz not null default now()
);
create index if not exists pin_attempts_fp_idx on pin_attempts (fingerprint, attempted_at desc);

-- ---------------------------------------------------------------- scoring

-- Decay time constant, in minutes. A puff at 10:45 has a very different
-- half-life than one at 15:00, so tau is time-of-day aware (IST).
create or replace function kada_tau_minutes(ts timestamptz)
returns numeric language sql immutable as $$
  select case
    when (ts at time zone 'Asia/Kolkata')::time >= '10:30' and (ts at time zone 'Asia/Kolkata')::time < '11:00' then 8
    when (ts at time zone 'Asia/Kolkata')::time >= '13:00' and (ts at time zone 'Asia/Kolkata')::time < '13:45' then 8
    when (ts at time zone 'Asia/Kolkata')::time >= '16:00' and (ts at time zone 'Asia/Kolkata')::time < '16:30' then 8
    else 20 end::numeric;
$$;

create or replace function kada_signal_value(s signal_kind)
returns numeric language sql immutable as $$
  select case s when 'available' then 1 when 'low' then 0.2 else -1 end::numeric;
$$;

create or replace function kada_count_to_signal(n int)
returns signal_kind language sql immutable as $$
  select case when n <= 0 then 'sold_out' when n <= 2 then 'low' else 'available' end::signal_kind;
$$;

-- Collapse the ledger for one item into a single derived state row.
create or replace function recompute_item_state(p_item uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_now    timestamptz := now();
  v_score  numeric := 0;
  v_maxw   numeric := 0;
  v_conf   numeric;
  v_state  avail_state;
  v_since  timestamptz;
  v_vcount int;
  v_vat    timestamptz;
  v_last   timestamptz;
  v_contrib int := 0;
  v_rate   numeric;
  v_eta    timestamptz;
  r record;
  w numeric;
begin
  -- A vendor reading is ground truth: it resets the ledger for that item.
  select vendor_count, created_at into v_vcount, v_vat
    from reports where item_id = p_item and source = 'vendor' and counted
    order by created_at desc limit 1;

  v_since := greatest(coalesce(v_vat, v_now - interval '6 hours'), v_now - interval '6 hours');

  for r in
    select signal, weight_at_write, created_at, device_id
      from reports
     where item_id = p_item and counted and created_at >= v_since
     order by created_at desc limit 200
  loop
    w := r.weight_at_write
       * exp(- (extract(epoch from (v_now - r.created_at)) / 60.0) / kada_tau_minutes(r.created_at));
    v_score := v_score + w * kada_signal_value(r.signal);
    if w > v_maxw then v_maxw := w; end if;
  end loop;

  select max(created_at), count(distinct device_id)
    into v_last, v_contrib
    from reports where item_id = p_item and counted and created_at >= v_since;

  v_conf := abs(v_score) / (abs(v_score) + 1.2);

  if v_maxw < 0.05 then
    v_state := 'unknown';
    v_conf  := 0;
  elsif v_score > 0.4 then
    v_state := 'available';
  elsif v_score < -0.4 then
    v_state := 'sold_out';
  else
    v_state := 'uncertain';
  end if;

  -- A fresh, small vendor count is more informative than a generic "available".
  if v_state = 'available' and v_vcount is not null and v_vcount between 1 and 2
     and v_vat > v_now - interval '30 minutes' then
    v_state := 'low';
  end if;

  -- Predicted sell-out, only when we have both a fresh count and learned history.
  v_eta := null;
  if v_vcount is not null and v_vcount > 0 and v_vat > v_now - interval '90 minutes' then
    select avg_rate into v_rate from depletion_stats
      where item_id = p_item
        and dow = extract(dow from (v_now at time zone 'Asia/Kolkata'))::smallint
        and hour_bucket = extract(hour from (v_now at time zone 'Asia/Kolkata'))::smallint
        and samples >= 3;
    if v_rate is not null and v_rate > 0 then
      v_eta := v_vat + make_interval(mins => (v_vcount / v_rate)::int);
      if v_eta < v_now then v_eta := null; end if;
    end if;
  end if;

  insert into item_state as s (item_id, state, score, confidence, top_weight,
                               last_vendor_count, last_vendor_at, last_signal_at,
                               est_sellout_at, contributors, updated_at)
  values (p_item, v_state, round(v_score, 4), round(v_conf, 4), round(v_maxw, 4),
          v_vcount, v_vat, v_last, v_eta, coalesce(v_contrib, 0), v_now)
  on conflict (item_id) do update set
    state = excluded.state, score = excluded.score, confidence = excluded.confidence,
    top_weight = excluded.top_weight, last_vendor_count = excluded.last_vendor_count,
    last_vendor_at = excluded.last_vendor_at, last_signal_at = excluded.last_signal_at,
    est_sellout_at = excluded.est_sellout_at, contributors = excluded.contributors,
    updated_at = excluded.updated_at;
end $$;

-- When ground truth arrives, grade the students who spoke just before it and
-- move their Beta posterior. Liars asymptote toward zero influence, silently.
create or replace function kada_grade_reports(p_item uuid, p_truth signal_kind, p_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  with judged as (
    select r.device_id,
           (r.signal = p_truth) as correct
      from reports r
     where r.item_id = p_item
       and r.source = 'student'
       and r.device_id is not null
       and r.created_at between p_at - interval '25 minutes' and p_at
  ), tally as (
    select device_id,
           count(*) filter (where correct)     as good,
           count(*) filter (where not correct) as bad
      from judged group by device_id
  )
  update devices d
     set alpha = d.alpha + t.good * 0.5,
         beta  = d.beta  + t.bad  * 0.5
    from tally t where d.id = t.device_id;
end $$;

-- ---------------------------------------------------------------- write RPCs

create or replace function kada_ip_hash()
returns text language plpgsql stable as $$
declare h text;
begin
  begin
    h := split_part(coalesce(
           (current_setting('request.headers', true)::json ->> 'x-forwarded-for'), ''), ',', 1);
  exception when others then h := ''; end;
  if h is null or h = '' then return null; end if;
  return encode(digest(h || 'kada-salt', 'sha256'), 'hex');
end $$;

-- Students write only through here. RLS denies direct INSERT on `reports`,
-- so the client cannot forge a row, a weight, or a timestamp.
create or replace function submit_report(
  p_item uuid, p_signal signal_kind, p_device uuid, p_geo boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_dev     uuid;
  v_rep     numeric;
  v_blocked boolean;
  v_w       numeric;
  v_recent  timestamptz;
  v_hits    int;
  v_ip      text := kada_ip_hash();
begin
  -- Prefer a signed anonymous identity when one exists; fall back to the
  -- client-supplied device id so the app works without auth configuration.
  v_dev := coalesce(auth.uid(), p_device);
  if v_dev is null then
    return jsonb_build_object('ok', false, 'reason', 'no_identity');
  end if;

  insert into devices (id, verified) values (v_dev, auth.uid() is not null)
  on conflict (id) do update set last_seen_at = now()
  returning least(1.5, greatest(0.1, (alpha / (alpha + beta)) * 2)), blocked
  into v_rep, v_blocked;

  select max(created_at) into v_recent
    from reports where item_id = p_item and device_id = v_dev;
  if v_recent is not null and v_recent > now() - interval '90 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited',
      'retry_after_s', ceil(extract(epoch from (v_recent + interval '90 seconds' - now()))));
  end if;

  select count(*) into v_hits
    from reports where device_id = v_dev and created_at > now() - interval '1 hour';
  if v_hits >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'hourly_limit');
  end if;

  -- Backstop for device-id rotation: the same network cannot flood either.
  if v_ip is not null then
    select count(*) into v_hits
      from reports where ip_hash = v_ip and created_at > now() - interval '1 hour';
    if v_hits >= 60 then
      return jsonb_build_object('ok', false, 'reason', 'network_limit');
    end if;
  end if;

  v_w := case when v_blocked then 0 else 0.35 * v_rep * case when p_geo then 1.4 else 1 end end;

  insert into reports (item_id, device_id, signal, source, weight_at_write, geo_verified, ip_hash)
  values (p_item, v_dev, p_signal, 'student', round(v_w, 4), coalesce(p_geo, false), v_ip);

  update devices set report_count = report_count + 1 where id = v_dev;
  perform recompute_item_state(p_item);

  return jsonb_build_object('ok', true, 'weight', round(v_w, 4), 'reputation', round(v_rep, 3));
end $$;

create or replace function vendor_login(p_slug text, p_pin text, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_shop uuid; v_hash text; v_fails int; v_token uuid;
begin
  select count(*) into v_fails from pin_attempts
   where fingerprint = p_fingerprint and not ok and attempted_at > now() - interval '15 minutes';
  if v_fails >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  select id, pin_hash into v_shop, v_hash from shops where slug = p_slug;
  if v_shop is null or v_hash is null or crypt(p_pin, v_hash) <> v_hash then
    insert into pin_attempts (shop_id, fingerprint, ok) values (v_shop, p_fingerprint, false);
    return jsonb_build_object('ok', false, 'reason', 'bad_pin');
  end if;

  insert into pin_attempts (shop_id, fingerprint, ok) values (v_shop, p_fingerprint, true);
  insert into vendor_sessions (shop_id) values (v_shop) returning token into v_token;
  return jsonb_build_object('ok', true, 'token', v_token, 'shop_id', v_shop);
end $$;

create or replace function vendor_set(p_token uuid, p_item uuid, p_count int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_shop uuid; v_item_shop uuid; v_sig signal_kind; v_prev int; v_prev_at timestamptz;
begin
  select shop_id into v_shop from vendor_sessions
   where token = p_token and expires_at > now();
  if v_shop is null then return jsonb_build_object('ok', false, 'reason', 'bad_session'); end if;

  select shop_id into v_item_shop from items where id = p_item;
  if v_item_shop is distinct from v_shop then
    return jsonb_build_object('ok', false, 'reason', 'wrong_shop');
  end if;

  v_sig := kada_count_to_signal(p_count);

  -- Grade the crowd against this ground truth before it enters the ledger.
  perform kada_grade_reports(p_item, v_sig, now());

  -- Learn the depletion rate from the gap between consecutive vendor readings.
  select vendor_count, created_at into v_prev, v_prev_at
    from reports where item_id = p_item and source = 'vendor' and counted
    order by created_at desc limit 1;
  if v_prev is not null and v_prev > p_count then
    insert into depletion_stats (item_id, dow, hour_bucket, avg_rate, samples)
    values (p_item,
            extract(dow  from (now() at time zone 'Asia/Kolkata'))::smallint,
            extract(hour from (now() at time zone 'Asia/Kolkata'))::smallint,
            (v_prev - p_count) / greatest(1, extract(epoch from (now() - v_prev_at)) / 60.0), 1)
    on conflict (item_id, dow, hour_bucket) do update set
      avg_rate = (depletion_stats.avg_rate * depletion_stats.samples + excluded.avg_rate)
                 / (depletion_stats.samples + 1),
      samples  = depletion_stats.samples + 1;
  end if;

  insert into reports (item_id, device_id, signal, source, vendor_count, weight_at_write)
  values (p_item, null, v_sig, 'vendor', p_count, 1.0);

  perform recompute_item_state(p_item);
  return jsonb_build_object('ok', true, 'state', v_sig::text, 'count', p_count);
end $$;

-- Periodic reconciliation so decayed rows go stale even with no traffic.
create or replace function kada_reconcile()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select item_id from item_state where state <> 'unknown' loop
    perform recompute_item_state(r.item_id);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS

alter table shops           enable row level security;
alter table items           enable row level security;
alter table item_state      enable row level security;
alter table depletion_stats enable row level security;
alter table reports         enable row level security;
alter table devices         enable row level security;
alter table vendor_sessions enable row level security;
alter table pin_attempts    enable row level security;

drop policy if exists shops_read      on shops;
drop policy if exists items_read      on items;
drop policy if exists item_state_read on item_state;
drop policy if exists depletion_read  on depletion_stats;

create policy shops_read      on shops           for select using (true);
create policy items_read      on items           for select using (active);
create policy item_state_read on item_state      for select using (true);
create policy depletion_read  on depletion_stats for select using (true);

-- reports, devices, vendor_sessions, pin_attempts intentionally have NO policies:
-- unreachable from the client. Every write path is a SECURITY DEFINER function.

revoke all on function vendor_login(text, text, text)      from anon, authenticated;
grant execute on function vendor_login(text, text, text)   to anon, authenticated;
grant execute on function submit_report(uuid, signal_kind, uuid, boolean) to anon, authenticated;
grant execute on function vendor_set(uuid, uuid, int)      to anon, authenticated;

-- Realtime: clients subscribe to derived state only.
do $$ begin
  alter publication supabase_realtime add table item_state;
exception when duplicate_object then null; end $$;
