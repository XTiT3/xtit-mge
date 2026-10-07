import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  "PASTE_PROJECT_URL_HERE",
  "PASTE_ANON_KEY_HERE"
);