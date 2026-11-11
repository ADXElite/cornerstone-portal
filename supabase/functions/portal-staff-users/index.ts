// Lets front office staff create sign-ins for car line and bus staff (and other office staff) and reset passwords.
// Only active office staff can call it (checked with the caller's own sign-in via staff_me).
// Body: { action: 'create' | 'password', email, name?, role?, password }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "https://portal.csjax.org",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const asStaff = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } }, auth: { persistSession: false } });
  const { error: meErr } = await asStaff.rpc("staff_me");
  if (meErr) return json({ error: "Only front office staff can manage staff sign-ins." }, 401);

  const b = await req.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (password.length < 8) return json({ error: "Passwords need at least 8 characters." }, 400);

  // Find an existing sign-in with this email.
  let user: { id: string } | null = null;
  for (let page = 1; page <= 20 && !user; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return json({ error: error.message }, 500);
    user = data.users.find(u => (u.email || "").toLowerCase() === email) || null;
    if (data.users.length < 200) break;
  }

  if (b.action === "create") {
    const role = ["office", "carline", "bus", "care"].includes(b.role) ? b.role : "carline";
    const { error: sErr } = await asStaff.rpc("staff_staff_save", { p_email: email, p_name: String(b.name || "").trim() || null, p_active: true, p_role: role });
    if (sErr) return json({ error: sErr.message }, 400);
    if (user) {
      const { error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, existed: true });
    }
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, created: true });
  }
  if (b.action === "password") {
    if (!user) return json({ error: "That person doesn't have a sign-in yet." }, 404);
    const { error } = await admin.auth.admin.updateUserById(user.id, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
});
