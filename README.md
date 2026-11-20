# MenuFlow — Restaurant Menu Website & Admin Dashboard

A static restaurant menu (Arabic by default, English toggle) plus a separate admin dashboard.
Frontend: HTML, CSS, vanilla JS. Backend: Supabase (Postgres + Auth + Storage). Hosting: GitHub Pages.

> **Status:** the code is complete, but it has **not been tested against a real Supabase project**.
> Until you add real credentials (Step 3) and run the checklist at the end, do not treat it as connected or verified.

## Files

```
index.html        public menu
admin.html        admin dashboard (Arabic UI, noindex)
style.css         shared styles
config.js         Supabase URL + anon key (placeholders)
menu.js           public menu logic
admin.js          dashboard logic
schema.sql        tables, RLS, storage bucket, demo data
```

All files live in the repository root (no sub-folders).

## Step 1 — Create the Supabase project

1. Go to <https://supabase.com> → **New project**. Pick a name, a strong database password, and a nearby region.
2. Wait until the project finishes provisioning.

## Step 2 — Create the database tables

1. Open **SQL Editor → New query**.
2. Paste the entire contents of `schema.sql` and click **Run**.
3. Check **Table Editor**: you should see `admins`, `categories`, `products` (with demo rows), and under **Storage** a public bucket `product-images`.

The script is safe to re-run. It enables Row Level Security:
- Visitors (anon) can only **read** active categories and available products.
- Only users listed in `public.admins` can insert/update/delete categories, products, and upload/delete images.
- `public.admins` has no write policy, so nobody can make themselves admin from the browser.

## Step 3 — Configure the frontend

1. In Supabase: **Project Settings → API**.
2. Copy the **Project URL** and the **anon / publishable key**.
3. Edit `config.js`:
   ```js
   SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
   SUPABASE_ANON_KEY: 'eyJ... or sb_publishable_...',
   ```
4. **Never** paste the `service_role` / secret key anywhere in this project.

## Step 4 — Create the first admin account

1. **Authentication → Users → Add user → Create new user**. Enter the owner's email and a strong password. Tick **Auto Confirm User**.
2. **Authentication → Sign In / Providers → Email**: it is recommended to **disable "Allow new users to sign up"** so nobody else can register accounts.
3. Back in **SQL Editor**, run (replace the email):
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'owner@example.com';
   ```
4. Open `admin.html`, sign in. If the account is not in `public.admins` you will see "no permission".

To add more admins later, repeat steps 1 and 3 for each person.

## Step 5 — Deploy on GitHub Pages

1. Create a GitHub repository and push all files (keep the folder structure; `index.html` at the root).
2. Repository → **Settings → Pages** → **Source: Deploy from a branch** → Branch `main`, folder `/ (root)` → **Save**.
3. After a minute the site is at `https://<user>.github.io/<repo>/`; the dashboard is at `.../admin.html`.
4. In Supabase → **Authentication → URL Configuration**, set **Site URL** to your GitHub Pages address.

Committing `config.js` with the anon key is fine; the key is public by design and protected by RLS.

## Verification checklist (do this before going live)

- [ ] Public site shows the demo categories and products (not the "not connected" message).
- [ ] Search, category filter, and EN/AR toggle work.
- [ ] Admin login works; a wrong password shows an error.
- [ ] Add a category and a product with an image; they appear in the public site.
- [ ] Edit a price; the public site reflects it after reload.
- [ ] Toggle a product off; it disappears from the public site.
- [ ] Replace an image, then delete the product; the old file is removed from Storage.
- [ ] Try deleting a category that still has products; you get a clear message.
- [ ] Signed out (or in a private window), try writing via the browser console; Supabase rejects it.
- [ ] A signed-in user who is **not** in `admins` cannot see the dashboard and cannot write.

## Notes

- Currency labels are in `config.js` (`CURRENCY_AR`, `CURRENCY_EN`); prices are always read from the database.
- The only `localStorage` use is remembering the visitor's language choice.
- Deleting a category is blocked while it contains products (`on delete restrict`) so menu items are never lost by accident.
- The demo restaurant name/branding is in `index.html` and `admin.html`; replace it with the real brand.
