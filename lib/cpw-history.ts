import { getSupabase } from "@/supabase-client";

export type CPWSnapshot = {
  dateKey: string; // "YYYY-MM-DD"
  totalCpw: number;
};

/**
 * Record (or refresh) today's total-CPW snapshot for the current user.
 * Safe to call on every app/tab focus — upserts on (user_id, date_key), so
 * it just keeps today's row current until the day rolls over.
 */
export async function upsertTodaySnapshot(
  totalCpw: number,
  dateKey: string,
): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("cpw_snapshots")
    .upsert(
      { user_id: user.id, date_key: dateKey, total_cpw: totalCpw },
      { onConflict: "user_id,date_key" },
    );
}

/** Load all recorded daily CPW snapshots for the current user, oldest first. */
export async function getSnapshots(): Promise<CPWSnapshot[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("cpw_snapshots")
    .select("date_key, total_cpw")
    .eq("user_id", user?.id ?? "")
    .order("date_key", { ascending: true });

  return (data ?? []).map((row) => ({
    dateKey: row.date_key as string,
    totalCpw: Number(row.total_cpw) || 0,
  }));
}
