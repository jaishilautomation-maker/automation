import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await supabase.from("pulveriser_job_cards").select("id, job_number, status").order("created_at",{ascending:false}).limit(1).maybeSingle();
if (error) console.log("STILL BLOCKED:", error.message, "-> migration 054 NOT applied yet");
else console.log("OK - service_role can read. Sample:", JSON.stringify(data));
