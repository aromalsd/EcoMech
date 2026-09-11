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

-- Vendor PINs are deliberately NOT set here. A PIN committed to the repository
-- is a PIN anyone can read, and this one guards the ability to rewrite every
-- count in the shop. Set them out of band, once, per environment:
--
--   npm run sql -- "update shops set pin_hash = crypt('<pin>', gen_salt('bf')) where slug = 'canteen'"
--
-- Until that is done the shop simply cannot sign in, which is the safe default.
