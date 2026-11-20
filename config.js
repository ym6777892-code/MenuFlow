/*
 * MenuFlow configuration.
 * Supabase project connection settings.
 */
(function () {
  'use strict';

  var CONFIG = {
    SUPABASE_URL: 'https://wbxcsojroszrrkveszvy.supabase.co',

    SUPABASE_ANON_KEY: 'sb_publishable_zJIsWmgnkRB90nlZ3gQeXg_jEeLX6l_',

    STORAGE_BUCKET: 'product-images',

    CURRENCY_AR: 'ج.م',
    CURRENCY_EN: 'EGP'
  };

  CONFIG.isConfigured =
    /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(CONFIG.SUPABASE_URL) &&
    CONFIG.SUPABASE_ANON_KEY.length > 40 &&
    CONFIG.SUPABASE_ANON_KEY.indexOf('YOUR_') === -1;

  window.MENUFLOW_CONFIG = CONFIG;
  window.sb = null;

  if (
    CONFIG.isConfigured &&
    window.supabase &&
    window.supabase.createClient
  ) {
    window.sb = window.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_ANON_KEY
    );
  }
})();