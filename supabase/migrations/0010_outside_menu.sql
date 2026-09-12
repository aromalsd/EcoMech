-- Both outlets carry the same four items.

update items set active = false
 where shop_id = (select id from shops where slug = 'outside');

insert into items (shop_id, name, price_paise, sort_order, active)
select s.id, m.nm, m.paise, m.ord, true
from (values
  ('Egg Puff',    2200, 0),
  ('Meat Puff',   2400, 1),
  ('Meat Roll',   2000, 2),
  ('Banana Puff', 1500, 3)
) as m(nm, paise, ord)
cross join shops s
where s.slug = 'outside'
on conflict (shop_id, name) do update set
  price_paise = excluded.price_paise,
  sort_order  = excluded.sort_order,
  active      = true;

insert into item_state (item_id) select id from items on conflict (item_id) do nothing;
