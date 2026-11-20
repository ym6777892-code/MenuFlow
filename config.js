/*
 * MenuFlow configuration.
 * Replace the two placeholders with the values from:
 * Supabase Dashboard → Project Settings → API
 *
 *  - Project URL            →  SUPABASE_URL
 *  - anon / publishable key →  SUPABASE_ANON_KEY
 *
 * NEVER put the "service_role" / secret key in this file.
 * The anon/publishable key is safe to expose: Row Level Security in
 * schema.sql decides what each visitor is allowed to do.
 */
(function () {
  'use strict';

  var CONFIG = {
    SUPABASE_URL: 'YOUR_SUPABASE_PROJECT_URL',
    SUPABASE_ANON_KEY: 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY',

    STORAGE_BUCKET: 'product-images',

    // Display only. Prices themselves always come from the database.
    CURRENCY_AR: 'ج.م',
    CURRENCY_EN: 'EGP'
  };

  CONFIG.isConfigured =
    /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(CONFIG.SUPABASE_URL) &&
    CONFIG.SUPABASE_ANON_KEY.length > 40 &&
    CONFIG.SUPABASE_ANON_KEY.indexOf('YOUR_') === -1;

  window.MENUFLOW_CONFIG = CONFIG;
  window.sb = null;

  if (CONFIG.isConfigured && window.supabase && window.supabase.createClient) {
    window.sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
})();
