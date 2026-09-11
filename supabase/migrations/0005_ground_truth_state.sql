-- Two corrections to the model.
--
-- 1. A count from the shop is ground truth, but it was being run through the
--    consensus score and losing: "2 left" maps to the `low` signal, worth only
--    +0.2, which sits below the availability threshold and rendered as
--    "not sure" despite being an exact count. While a count is fresh and
--    nobody has reported since, the state now comes from the count itself.
--
-- 2. A vendor reading carried the same weight as roughly three students, so a
--    just-counted item showed 45% confidence. Ground truth should read as
--    confident and then decay. Weight raised from 1.0 to 4.0, matching
--    W_VENDOR in src/lib/scoring/constants.ts.

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

  -- Ground truth wins until somebody contradicts it. Mirrors displayState()
  -- in src/lib/scoring/index.ts; keep the two in step.
  if v_state <> 'unknown' and v_vcount is not null
     and v_vat > v_now - interval '30 minutes'
     and (v_last is null or v_last <= v_vat) then
    v_state := kada_count_to_signal(v_vcount);
  end if;

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

update reports set weight_at_write = 4.0 where source = 'vendor' and weight_at_write = 1.0;

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
  perform kada_grade_reports(p_item, v_sig, now());

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
  values (p_item, null, v_sig, 'vendor', p_count, 4.0);

  perform recompute_item_state(p_item);
  return jsonb_build_object('ok', true, 'state', v_sig::text, 'count', p_count);
end $$;

grant execute on function vendor_set(uuid, uuid, int) to anon, authenticated;

select kada_reconcile();
