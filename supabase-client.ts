import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;

  const extra = Constants.expoConfig?.extra as
    | {
        supabaseUrl?: string;
        supabaseAnonKey?: string;
      }
    | undefined;

  const url = extra?.supabaseUrl;
  const key = extra?.supabaseAnonKey;
  console.log("SUPABASE DEBUG:", { url, key });

  if (!url || !key) {
    throw new Error("Missing Supabase config in app.config.ts extra");
  }

  client = createClient(url, key);
  return client;
}
