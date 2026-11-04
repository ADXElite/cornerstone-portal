// Sends push notifications to parents who turned on alerts in the Cornerstone Parent Portal (portal.csjax.org).
// Only active front office staff (public.portal_staff) can call it; the staff member's own sign-in decides who receives it.
// Body: { title, body, url?, audience: { type: 'all' | 'grade' | 'teacher' | 'student' | 'note' | 'identifier', ... } }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

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

  const auth = req.headers.get("Authorization") || "";
  const asStaff = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });

  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim().slice(0, 80);
  const message = String(body.body || "").trim().slice(0, 300);
  const url = String(body.url || "/").trim().slice(0, 300) || "/";
  const audience = body.audience || { type: "all" };
  if (!title) return json({ error: "Add a title for the alert." }, 400);

  // Also checks that the caller is front office staff.
  const { data: subs, error } = await asStaff.rpc("staff_push_targets", { p_aud: audience });
  if (error) return json({ error: error.message === "not_staff" ? "Only front office staff can send alerts." : error.message }, 401);

  const { data: cfg } = await admin.rpc("get_private_config");
  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);

  const payload = JSON.stringify({ title, body: message, url, tag: `portal-${Date.now()}` });
  let sent = 0, failed = 0;
  const gone: string[] = [], ok: string[] = [];
  const queue = [...(subs || [])];
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift()!;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24, urgency: "high" });
        sent++; ok.push(s.endpoint);
      } catch (e) {
        failed++;
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.endpoint);
      }
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  await asStaff.rpc("staff_push_done", { p_title: title, p_body: message, p_url: url, p_aud: audience, p_sent: sent, p_failed: failed, p_gone: gone, p_ok: ok.slice(0, 2000) });
  return json({ ok: true, sent, failed, devices: subs?.length || 0 });
});
