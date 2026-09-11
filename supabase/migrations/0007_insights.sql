-- Derived reads for the two audiences: the typical sell-out time of an item,
-- and a weekly summary for the shop including demand that went unmet.

-- One call per outlet rather than one per item.
create or replace function shop_rhythms(p_shop uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', item_id, 'days', days, 'minute', minute)), '[]'::jsonb)
  from (
    select i.id as item_id, count(*) as days, round(avg(d.minute_of_day)) as minute
    from items i
    join lateral (
      select min(
        extract(hour   from (r.created_at at time zone 'Asia/Kolkata')) * 60 +
        extract(minute from (r.created_at at time zone 'Asia/Kolkata'))
      ) as minute_of_day
      from reports r
      where r.item_id = i.id
        and r.signal = 'sold_out'
        and r.created_at > now() - interval '60 days'
      group by (r.created_at at time zone 'Asia/Kolkata')::date
    ) d on true
    where i.shop_id = p_shop and i.active
    group by i.id
    having count(*) >= 3
  ) t;
$$;

-- Vendor-only, gated on a live session token rather than on knowing a shop id.
create or replace function shop_insights(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_shop uuid; v_result jsonb;
begin
  select shop_id into v_shop from vendor_sessions
   where token = p_token and expires_at > now();
  if v_shop is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_session');
  end if;

  select jsonb_build_object(
    'ok', true,
    'missed_7d', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select i.name, count(*) as times, count(distinct e.device_id) as people
        from events e join items i on i.id = e.item_id
        where e.kind = 'item_missed' and i.shop_id = v_shop
          and e.created_at > now() - interval '7 days'
        group by i.name order by count(*) desc limit 6
      ) x
    ),
    'visits_7d', (
      select count(distinct device_id) from events
      where kind = 'shop_view' and shop_id = v_shop
        and created_at > now() - interval '7 days'
    ),
    'reports_7d', (
      select count(*) from reports r join items i on i.id = r.item_id
      where i.shop_id = v_shop and r.source = 'student'
        and r.created_at > now() - interval '7 days'
    ),
    'soldout_days', (
      select coalesce(jsonb_agg(y), '[]'::jsonb) from (
        select i.name,
               round(avg(
                 extract(hour   from (r.created_at at time zone 'Asia/Kolkata')) * 60 +
                 extract(minute from (r.created_at at time zone 'Asia/Kolkata'))
               )) as minute,
               count(distinct (r.created_at at time zone 'Asia/Kolkata')::date) as days
        from reports r join items i on i.id = r.item_id
        where i.shop_id = v_shop and r.signal = 'sold_out'
          and r.created_at > now() - interval '30 days'
        group by i.name
        having count(distinct (r.created_at at time zone 'Asia/Kolkata')::date) >= 2
        order by 2 asc limit 6
      ) y
    ),
    'busiest_hour', (
      select extract(hour from (created_at at time zone 'Asia/Kolkata'))::int
      from events where kind = 'shop_view' and shop_id = v_shop
        and created_at > now() - interval '30 days'
      group by 1 order by count(*) desc limit 1
    )
  ) into v_result;

  return v_result;
end $$;

-- Public, aggregate-only counters for the transparency page.
create or replace function public_stats()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'reports_total',   (select count(*) from reports where source = 'student'),
    'vendor_updates',  (select count(*) from reports where source = 'vendor'),
    'reporters',       (select count(*) from devices),
    'items_tracked',   (select count(*) from items where active),
    'missed_total',    (select count(*) from events where kind = 'item_missed'),
    'visits_total',    (select count(*) from events where kind = 'visit'),
    'graded',          (select count(*) from devices where alpha + beta > 4),
    'accuracy',        (select round(avg(alpha / (alpha + beta))::numeric, 3)
                          from devices where alpha + beta > 4),
    'by_day', (
      select coalesce(
               jsonb_agg(jsonb_build_object('day', day, 'reports', n) order by day),
               '[]'::jsonb)
      from (
        select (created_at at time zone 'Asia/Kolkata')::date as day, count(*) as n
        from reports
        where created_at > now() - interval '14 days'
        group by 1
      ) z
    )
  );
$$;

grant execute on function shop_rhythms(uuid)  to anon, authenticated;
grant execute on function shop_insights(uuid) to anon, authenticated;
grant execute on function public_stats()      to anon, authenticated;
