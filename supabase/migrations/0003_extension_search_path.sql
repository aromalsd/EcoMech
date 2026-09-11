-- pgcrypto lives in the `extensions` schema on Supabase, so functions that pin
-- `search_path = public` cannot see crypt() or digest(). Widen the path on the
-- two functions that need it. Without this, vendor_login always errors, and
-- submit_report errors whenever a request actually carries headers.

create or replace function kada_ip_hash()
returns text language plpgsql stable
set search_path = public, extensions as $$
declare h text;
begin
  begin
    h := split_part(coalesce(
           (current_setting('request.headers', true)::json ->> 'x-forwarded-for'), ''), ',', 1);
  exception when others then h := ''; end;
  if h is null or h = '' then return null; end if;
  return encode(digest(h || 'kada-salt', 'sha256'), 'hex');
end $$;

create or replace function vendor_login(p_slug text, p_pin text, p_fingerprint text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
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

grant execute on function vendor_login(text, text, text) to anon, authenticated;
