-- =====================================================================
-- MenuFlow — Supabase schema
-- Run this whole file once in: Supabase Dashboard → SQL Editor → New query
-- Safe to re-run (uses IF NOT EXISTS / DROP POLICY IF EXISTS).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- Admin permissions: a user listed here is allowed to modify restaurant data.
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name_ar    text not null check (char_length(trim(name_ar)) > 0),
  name_en    text,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references public.categories (id) on delete restrict,
  name_ar        text not null check (char_length(trim(name_ar)) > 0),
  name_en        text,
  description_ar text,
  description_en text,
  price          numeric(10, 2) not null check (price >= 0),
  image_url      text,
  image_path     text,           -- path inside the storage bucket (used to delete old images)
  is_available   boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists products_category_idx on public.products (category_id);
create index if not exists products_available_idx on public.products (is_available);
create index if not exists categories_sort_idx on public.categories (sort_order);

-- ---------------------------------------------------------------------
-- 2. updated_at trigger
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. Admin check helper
-- SECURITY DEFINER so it can read public.admins regardless of RLS.
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Table privileges (RLS below does the real filtering)
-- ---------------------------------------------------------------------
revoke all on public.admins     from anon, authenticated;
revoke all on public.categories from anon, authenticated;
revoke all on public.products   from anon, authenticated;

grant select on public.admins     to authenticated;          -- own row only (policy)
grant select on public.categories to anon, authenticated;
grant select on public.products   to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;
grant insert, update, delete on public.products   to authenticated;

-- ---------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------
alter table public.admins     enable row level security;
alter table public.categories enable row level security;
alter table public.products   enable row level security;

-- admins: a signed-in user can only see their own row. No insert/update/delete
-- policies exist, so admins can only be added from the SQL Editor (see README).
drop policy if exists "admins read own row" on public.admins;
create policy "admins read own row" on public.admins
  for select to authenticated
  using (user_id = auth.uid());

-- categories
drop policy if exists "public read active categories" on public.categories;
create policy "public read active categories" on public.categories
  for select to anon, authenticated
  using (is_active = true);

drop policy if exists "admins read all categories" on public.categories;
create policy "admins read all categories" on public.categories
  for select to authenticated
  using (public.is_admin());

drop policy if exists "admins insert categories" on public.categories;
create policy "admins insert categories" on public.categories
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "admins update categories" on public.categories;
create policy "admins update categories" on public.categories
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins delete categories" on public.categories;
create policy "admins delete categories" on public.categories
  for delete to authenticated
  using (public.is_admin());

-- products
drop policy if exists "public read available products" on public.products;
create policy "public read available products" on public.products
  for select to anon, authenticated
  using (
    is_available = true
    and exists (
      select 1 from public.categories c
      where c.id = products.category_id and c.is_active = true
    )
  );

drop policy if exists "admins read all products" on public.products;
create policy "admins read all products" on public.products
  for select to authenticated
  using (public.is_admin());

drop policy if exists "admins insert products" on public.products;
create policy "admins insert products" on public.products
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "admins update products" on public.products;
create policy "admins update products" on public.products
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins delete products" on public.products;
create policy "admins delete products" on public.products
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------
-- 6. Storage bucket for product images (public read, admin write)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 3145728,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read product images" on storage.objects;
create policy "public read product images" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'product-images');

drop policy if exists "admins upload product images" on storage.objects;
create policy "admins upload product images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "admins update product images" on storage.objects;
create policy "admins update product images" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "admins delete product images" on storage.objects;
create policy "admins delete product images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- ---------------------------------------------------------------------
-- 7. Demo content (only inserted when the categories table is empty).
--    Delete it from the dashboard once you add your real menu.
-- ---------------------------------------------------------------------
do $$
declare
  c_starters uuid;
  c_grills   uuid;
  c_mains    uuid;
  c_desserts uuid;
  c_drinks   uuid;
begin
  if not exists (select 1 from public.categories) then
    insert into public.categories (name_ar, name_en, sort_order) values ('المقبلات', 'Starters', 1) returning id into c_starters;
    insert into public.categories (name_ar, name_en, sort_order) values ('المشويات', 'Grills', 2) returning id into c_grills;
    insert into public.categories (name_ar, name_en, sort_order) values ('الأطباق الرئيسية', 'Main Dishes', 3) returning id into c_mains;
    insert into public.categories (name_ar, name_en, sort_order) values ('الحلويات', 'Desserts', 4) returning id into c_desserts;
    insert into public.categories (name_ar, name_en, sort_order) values ('المشروبات', 'Drinks', 5) returning id into c_drinks;

    insert into public.products (category_id, name_ar, name_en, description_ar, description_en, price, sort_order) values
      (c_starters, 'حمص بالطحينة', 'Classic Hummus', 'حمص كريمي بالطحينة وزيت الزيتون مع الصنوبر المحمّص.', 'Creamy chickpea and tahini dip with olive oil and toasted pine nuts.', 75, 1),
      (c_starters, 'متبّل باذنجان', 'Moutabal', 'باذنجان مشوي على الفحم مع الطحينة والثوم وعصير الليمون.', 'Charcoal-roasted eggplant with tahini, garlic and lemon.', 80, 2),
      (c_starters, 'فتوش', 'Fattoush Salad', 'خضار طازجة مع الخبز المحمّص وصلصة الرمان والسماق.', 'Fresh vegetables with crispy pita, pomegranate molasses and sumac.', 90, 3),
      (c_grills,   'مشاوي مشكّلة', 'Mixed Grill', 'كباب وشيش طاووق وكفتة مع الأرز والخضار المشوية.', 'Kebab, shish tawook and kofta served with rice and grilled vegetables.', 420, 1),
      (c_grills,   'شيش طاووق', 'Shish Tawook', 'صدور دجاج متبّلة بالزبادي والثوم مشوية على الفحم.', 'Chicken breast marinated in yogurt and garlic, charcoal-grilled.', 220, 2),
      (c_grills,   'كباب حلبي', 'Aleppo Kebab', 'لحم مفروم متبّل بالفلفل الحلبي على الطريقة الشامية.', 'Minced beef seasoned with Aleppo pepper, Levantine style.', 260, 3),
      (c_mains,    'كبسة لحم', 'Lamb Kabsa', 'أرز بسمتي بالبهارات مع لحم ضأن طري مطهو ببطء.', 'Spiced basmati rice with slow-cooked tender lamb.', 310, 1),
      (c_mains,    'مندي دجاج', 'Chicken Mandi', 'دجاج مدخّن على الأرز بنكهة الفحم مع صلصة الدقوس.', 'Smoky chicken over fragrant rice with tomato chili sauce.', 240, 2),
      (c_desserts, 'كنافة بالجبن', 'Cheese Kunafa', 'كنافة ناعمة بالجبنة الطازجة تُقدَّم ساخنة مع القطر.', 'Warm kunafa with stretchy cheese and sweet syrup.', 110, 1),
      (c_desserts, 'أم علي', 'Om Ali', 'حلوى مصرية دافئة بالمكسرات والحليب والقشطة.', 'Warm Egyptian bread pudding with nuts, milk and cream.', 95, 2),
      (c_drinks,   'عصير ليمون بالنعناع', 'Lemon Mint', 'ليمون طازج مع النعناع والثلج.', 'Fresh lemon juice blended with mint and ice.', 55, 1),
      (c_drinks,   'شاي بالنعناع', 'Mint Tea', 'شاي أخضر بالنعناع الطازج.', 'Green tea with fresh mint.', 35, 2);
  end if;
end $$;

-- =====================================================================
-- Creating the FIRST ADMIN (do this AFTER creating the user in
-- Authentication → Users). Replace the email, then run:
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'owner@example.com';
--
-- =====================================================================
