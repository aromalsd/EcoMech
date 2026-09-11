-- Password-gated operator access, following the same shape as the vendor
-- session: a hashed secret exchanged for a short-lived token, so the secret
-- itself is never stored in a cookie and never reaches the browser.

create table if not exists admin_secret (
  id        int primary key default 1,
  pass_hash text not null,
  constraint admin_secret_single_row check (id = 1)
);

create table if not exists admin_sessions (
  token      uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);

alter table admin_secret   enable row level security;
alter table admin_sessions enable row level security;

create or replace function admin_login(p_password text, p_fingerprint text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare v_hash text; v_fails int; v_token uuid;
begin
  select count(*) into v_fails from pin_attempts
   where fingerprint = p_fingerprint and not ok
     and attempted_at > now() - interval '15 minutes';
  if v_fails >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  select pass_hash into v_hash from admin_secret where id = 1;
  if v_hash is null or crypt(p_password, v_hash) <> v_hash then
    insert into pin_attempts (shop_id, fingerprint, ok) values (null, p_fingerprint, false);
    return jsonb_build_object('ok', false, 'reason', 'bad_password');
  end if;

  insert into admin_sessions default values returning token into v_token;
  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

-- Every figure the dashboard shows, in one round trip.
create or replace function admin_overview(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  select true into v_ok from admin_sessions
   where token = p_token and expires_at > now();
  if v_ok is not true then
    return jsonb_build_object('ok', false);
  end if;

  return jsonb_build_object(
    'ok', true,
    'totals', (
      select jsonb_build_object(
        'visits',     (select count(*) from events where kind = 'visit'),
        'devices',    (select count(distinct device_id) from events),
        'active_24h', (select count(distinct device_id) from events
                        where created_at > now() - interval '24 hours'),
        'reports',    (select count(*) from reports where source = 'student'),
        'counts',     (select count(*) from reports where source = 'vendor'),
        'missed',     (select count(*) from events where kind = 'item_missed'))
    ),
    'by_kind', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select kind, count(*) as n, count(distinct device_id) as people
        from events group by kind order by count(*) desc) x
    ),
    'by_hour', (
      select coalesce(jsonb_agg(x order by (x->>'hour')::int), '[]'::jsonb) from (
        select jsonb_build_object('hour', hour, 'n', n) as x from (
          select extract(hour from (created_at at time zone 'Asia/Kolkata'))::int as hour,
                 count(*) as n
          from events where kind in ('visit', 'shop_view') group by 1) h) y
    ),
    'missed', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select i.name, s.name as shop, count(*) as times,
               count(distinct e.device_id) as people
        from events e join items i on i.id = e.item_id join shops s on s.id = i.shop_id
        where e.kind = 'item_missed'
        group by i.name, s.name order by count(*) desc limit 10) x
    ),
    'devices', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select left(id::text, 8) as id, report_count,
               round((alpha / (alpha + beta))::numeric, 2) as accuracy, blocked,
               to_char(last_seen_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') as last_seen
        from devices order by report_count desc limit 12) x
    ),
    'recent', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select e.kind, coalesce(i.name, '—') as item,
               to_char(e.created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI:SS') as at,
               left(e.device_id::text, 8) as device
        from events e left join items i on i.id = e.item_id
        order by e.created_at desc limit 25) x
    )
  );
end $$;

grant execute on function admin_login(text, text) to anon, authenticated;
grant execute on function admin_overview(uuid)    to anon, authenticated;
