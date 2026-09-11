-- Seed the two outlets and their menu. Idempotent: safe to re-run.
-- Item names are placeholders until confirmed against the real counters.

insert into shops (slug, name, subtitle, opens_at, closes_at, sort_order)
values
  ('canteen', 'College Canteen', 'Inside campus, main block', '09:00', '17:00', 0),
  ('outside', 'The Shop Outside', 'Just past the main gate',  '08:00', '20:00', 1)
on conflict (slug) do update set
  name = excluded.name, subtitle = excluded.subtitle,
  opens_at = excluded.opens_at, closes_at = excluded.closes_at,
  sort_order = excluded.sort_order;

with menu(shop_slug, name, emoji, price_paise, sort_order) as (values
  ('canteen', 'Veg Puff',     '🥟', 1200, 0),
  ('canteen', 'Egg Puff',     '🥚', 1500, 1),
  ('canteen', 'Chicken Roll', '🌯', 3000, 2),
  ('canteen', 'Samosa',       '🔺', 1000, 3),
  ('outside', 'Veg Puff',     '🥟', 1000, 0),
  ('outside', 'Chicken Puff', '🍗', 1800, 1),
  ('outside', 'Egg Roll',     '🌯', 2500, 2)
)
insert into items (shop_id, name, emoji, price_paise, sort_order)
select s.id, m.name, m.emoji, m.price_paise, m.sort_order
from menu m join shops s on s.slug = m.shop_slug
where not exists (
  select 1 from items i where i.shop_id = s.id and i.name = m.name
);

-- Every item starts life honestly: unknown, zero confidence.
insert into item_state (item_id)
select id from items
on conflict (item_id) do nothing;

-- Vendor PINs. Change these before the demo:
--   update shops set pin_hash = crypt('482913', gen_salt('bf')) where slug = 'canteen';
update shops set pin_hash = crypt('482913', gen_salt('bf')) where slug = 'canteen' and pin_hash is null;
update shops set pin_hash = crypt('715620', gen_salt('bf')) where slug = 'outside' and pin_hash is null;
