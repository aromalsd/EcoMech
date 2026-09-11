-- Usage telemetry, and two derived reads the interface needs.
--
-- `item_missed` records demand that went unmet: someone checked for an item
-- that had already run out.

create table if not exists events (
  id         bigint generated always as identity primary key,
  kind       text not null,
  shop_id    uuid references shops(id) on delete set null,
  item_id    uuid references items(id) on delete set null,
  device_id  uuid,
  meta       jsonb not null default '{}'::jsonb,
  ip_hash    text,
  created_at timestamptz not null default now()
);
create index if not exists events_kind_time_idx on events (kind, created_at desc);
create index if not exists events_item_time_idx on events (item_id, created_at desc);
create index if not exists events_device_idx on events (device_id, created_at desc);

alter table events enable row level security;
-- No policies and no grants: writes go through log_event.

create or replace function log_event(
  p_kind text,
  p_device uuid,
  p_shop uuid default null,
  p_item uuid default null,
  p_meta jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_n int;
begin
  -- Allow-list, so a hostile client cannot invent event kinds and pollute the
  -- table into uselessness.
  if p_kind not in ('visit', 'shop_view', 'item_missed', 'report', 'install') then
    return;
  end if;
  if p_device is null then return; end if;

  select count(*) into v_n
    from events where device_id = p_device and created_at > now() - interval '1 hour';
  if v_n >= 300 then return; end if;

  insert into events (kind, shop_id, item_id, device_id, meta, ip_hash)
  values (p_kind, p_shop, p_item, p_device, coalesce(p_meta, '{}'::jsonb), kada_ip_hash());
end $$;

-- How much this device's reports currently count for.
create or replace function my_standing(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_alpha numeric; v_beta numeric; v_count int; v_graded numeric;
begin
  select alpha, beta, report_count into v_alpha, v_beta, v_count
    from devices where id = p_device;
  if v_alpha is null then
    return jsonb_build_object('reports', 0, 'graded', 0, 'accuracy', null, 'weight', 1.0);
  end if;
  -- The prior is seeded at (2,2); anything beyond that came from being graded
  -- against a real count from the shop.
  v_graded := greatest(0, (v_alpha - 2) + (v_beta - 2)) / 0.5;
  return jsonb_build_object(
    'reports', coalesce(v_count, 0),
    'graded', round(v_graded),
    'accuracy', case when v_graded > 0 then round((v_alpha / (v_alpha + v_beta))::numeric, 3) else null end,
    'weight', round(least(1.5, greatest(0.1, (v_alpha / (v_alpha + v_beta)) * 2))::numeric, 2)
  );
end $$;

-- "Usually gone by 11:20" — the first sold-out report of each day, averaged.
create or replace function item_rhythm(p_item uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_avg numeric; v_days int;
begin
  select avg(minute_of_day), count(*) into v_avg, v_days
  from (
    select min(
      extract(hour from (created_at at time zone 'Asia/Kolkata')) * 60
      + extract(minute from (created_at at time zone 'Asia/Kolkata'))
    ) as minute_of_day
    from reports
    where item_id = p_item
      and signal = 'sold_out'
      and created_at > now() - interval '60 days'
    group by (created_at at time zone 'Asia/Kolkata')::date
  ) daily;

  if v_days is null or v_days < 3 then
    return jsonb_build_object('days', coalesce(v_days, 0), 'minute', null);
  end if;
  return jsonb_build_object('days', v_days, 'minute', round(v_avg));
end $$;

grant execute on function log_event(text, uuid, uuid, uuid, jsonb) to anon, authenticated;
grant execute on function my_standing(uuid) to anon, authenticated;
grant execute on function item_rhythm(uuid) to anon, authenticated;
