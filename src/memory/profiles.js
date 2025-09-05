let supabase = null;
async function client() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  const { createClient } = await import('@supabase/supabase-js');
  supabase = createClient(url, key);
  return supabase;
}

export async function upsertProfile(waId, data) {
  const db = await client();
  const payload = { wa_id: waId, ...data, updated_at: new Date().toISOString() };
  const { error } = await db.from('profiles').upsert([payload], { onConflict: 'wa_id' });
  if (error) throw new Error(error.message);
  return true;
}

export async function getProfile(waId) {
  const db = await client();
  const { data, error } = await db.from('profiles')
    .select('wa_id, company, salary_aed, prefers, notes, updated_at')
    .eq('wa_id', waId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}
