import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://xcoofkbethdwrailkwvt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhjb29ma2JldGhkd3JhaWxrd3Z0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMzQwODYsImV4cCI6MjA4NzYxMDA4Nn0.e3gpJkidddzTQO9OCV_LFY_ZBUiDMf_ICSTTc4T7ntQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);