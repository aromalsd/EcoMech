-- RLS decides which ROWS a role may see; table GRANTs decide whether the role
-- may touch the table at all. Tables created through the Management API do not
-- pick up Supabase's default privileges, so both have to be stated explicitly.

grant usage on schema public to anon, authenticated;

-- Public reads: derived state and the menu. RLS still applies on top.
grant select on shops, items, item_state, depletion_stats to anon, authenticated;

-- Everything else stays unreachable from the client. These tables carry RLS
-- with no policies, and now no privileges either — defence in depth, so a
-- future policy added by accident still cannot expose them.
revoke all on reports, devices, vendor_sessions, pin_attempts from anon, authenticated;

-- Writes happen only through the audited entry points.
grant execute on function submit_report(uuid, signal_kind, uuid, boolean) to anon, authenticated;
grant execute on function vendor_login(text, text, text) to anon, authenticated;
grant execute on function vendor_set(uuid, uuid, int) to anon, authenticated;

-- Internal helpers must not be callable directly: recompute_item_state and
-- kada_grade_reports are SECURITY DEFINER and would otherwise let anyone
-- rewrite derived state or move another device's reputation.
revoke all on function recompute_item_state(uuid) from anon, authenticated;
revoke all on function kada_grade_reports(uuid, signal_kind, timestamptz) from anon, authenticated;
revoke all on function kada_reconcile() from anon, authenticated;
