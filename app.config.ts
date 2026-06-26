import "dotenv/config";
import type { ConfigContext } from "expo/config";

export default ({ config }: ConfigContext) => {
  return {
    ...config,

    plugins: ["expo-web-browser"],

    extra: {
      ...config.extra,
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      googleClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
    },
    ios: {
      bundleIdentifier: "com.minkim.costperwear",
      config: {
        usesNonExemptEncryption: false,
      },
    },
  };
};