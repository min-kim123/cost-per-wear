// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // .expo/* is generated; supabase/functions are Deno edge functions whose
    // globals and https: imports don't resolve under the app's Node tooling.
    ignores: ['dist/*', '.expo/*', 'supabase/functions/*'],
  },
]);
