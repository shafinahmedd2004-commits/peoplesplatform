/**
 * THE PEOPLE PLATFORM — Main API Edge Function
 * Fat function pattern: one function handles all routes
 * Runtime: Deno (Supabase Edge Functions)
 * Deploy: supabase functions deploy api
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── CORS headers (required for browser calls) ─────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const err = (msg: string, status = 400) => json({ error: msg }, status);

// ─── Upstash Redis (HTTP-based, Deno-compatible) ───────────────────────────
const REDIS_URL = Deno.env.get("UPSTASH_REDIS_REST_URL")!;
const REDIS_TOKEN = Deno.env.get("UPSTASH_REDIS_REST_TOKEN")!;

async function redisCmd(...args: (string | number)[]) {
  const r = await fetch(`${REDIS_URL}/${args.join("/")}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  const d = await r.json();
  return d.result;
}

const redisSet = (key: string, val: string, ex?: number) =>
  ex ? redisCmd("set", key, val, "ex", ex) : redisCmd("set", key, val);
const redisGet = (key: string) => redisCmd("get", key);
const redisDel = (key: string) => redisCmd("del", key);

// ─── Supabase client factory ────────────────────────────────────────────────
function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

function getUserClient(req: Request) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
  );
}

// ─── Auth helper ────────────────────────────────────────────────────────────
async function getUser(req: Request) {
  const client = getUserClient(req);
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  return user;
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  // Strip /functions/v1/api prefix → get path like /posts, /users/me, etc.
  const path = url.pathname.replace(/^\/functions\/v1\/api/, "") || "/";
  const method = req.method;

  // ── PUBLIC ROUTES (no auth required) ────────────────────────────────────
  if (method === "GET" && path === "/sections") return getSections();
  if (method === "GET" && path === "/health")
    return json({ status: "ok", ts: new Date().toISOString() });

  // ── AUTH-REQUIRED ROUTES ─────────────────────────────────────────────────
  const user = await getUser(req);
  if (!user) return err("Unauthorized", 401);

  const body = method !== "GET" ? await req.json().catch(() => ({})) : {};
  const params = Object.fromEntries(url.searchParams);

  // ── PROFILE ──────────────────────────────────────────────────────────────
  if (method === "GET"  && path === "/users/me")           return getMe(user.id);
  if (method === "PUT"  && path === "/users/me")           return updateMe(user.id, body);
  if (method === "PUT"  && path === "/users/me/roles")     return updateRoles(user.id, body);
  if (method === "PUT"  && path === "/users/me/skills")    return updateSkills(user.id, body);

  // /users/:id
  const userMatch = path.match(/^\/users\/([^/]+)$/);
  if (method === "GET" && userMatch) return getUser2(userMatch[1], user.id);

  // ── POSTS ─────────────────────────────────────────────────────────────────
  if (method === "GET"  && path === "/posts")              return getPosts(params, user.id);
  if (method === "GET"  && path === "/posts/feed/home")    return getHomeFeed(user.id, params);
  if (method === "GET"  && path === "/posts/feed/trending") return getTrending();
  if (method === "POST" && path === "/posts")              return createPost(user.id, body);

  const postMatch = path.match(/^\/posts\/([^/]+)$/);
  if (postMatch) {
    if (method === "GET")    return getPost(postMatch[1], user.id);
    if (method === "PUT")    return updatePost(postMatch[1], user.id, body);
    if (method === "DELETE") return deletePost(postMatch[1], user.id);
  }
  const postInterest  = path.match(/^\/posts\/([^/]+)\/interest$/);
  const postBookmark  = path.match(/^\/posts\/([^/]+)\/bookmark$/);
  const postBoost     = path.match(/^\/posts\/([^/]+)\/boost$/);
  if (postInterest)  { if (method === "POST") return expressInterest(postInterest[1], user.id); }
  if (postBookmark)  { if (method === "POST") return bookmarkPost(postBookmark[1], user.id); if (method === "DELETE") return unbookmarkPost(postBookmark[1], user.id); }
  if (postBoost)     { if (method === "POST") return boostPost(postBoost[1], user.id, body); }

  // ── CONNECTIONS ───────────────────────────────────────────────────────────
  if (method === "GET"  && path === "/connections")               return getConnections(user.id);
  if (method === "GET"  && path === "/connections/requests")      return getConnectionRequests(user.id);

  const connReq = path.match(/^\/connections\/request\/([^/]+)$/);
  const connAcc = path.match(/^\/connections\/accept\/([^/]+)$/);
  const connRej = path.match(/^\/connections\/reject\/([^/]+)$/);
  if (connReq && method === "POST") return sendConnectionRequest(user.id, connReq[1]);
  if (connAcc && method === "POST") return acceptConnection(user.id, connAcc[1]);
  if (connRej && method === "POST") return rejectConnection(user.id, connRej[1]);

  // ── CONVERSATIONS (REST fallback for messages) ────────────────────────────
  if (method === "GET"  && path === "/conversations")             return getConversations(user.id);
  if (method === "POST" && path === "/conversations")             return createOrGetConversation(user.id, body);

  const convMsgs = path.match(/^\/conversations\/([^/]+)\/messages$/);
  if (convMsgs) {
    if (method === "GET")  return getMessages(convMsgs[1], user.id, params);
    if (method === "POST") return sendMessage(convMsgs[1], user.id, body);
  }
  const delMsg = path.match(/^\/messages\/([^/]+)$/);
  if (delMsg && method === "DELETE") return deleteMessage(delMsg[1], user.id);

  // ── BOOKINGS ─────────────────────────────────────────────────────────────
  if (method === "GET"  && path === "/bookings")                  return getBookings(user.id, params);
  if (method === "POST" && path === "/bookings")                  return createBooking(user.id, body);

  const bookStatus = path.match(/^\/bookings\/([^/]+)\/status$/);
  if (bookStatus && method === "PUT") return updateBookingStatus(bookStatus[1], user.id, body);

  // ── REVIEWS ──────────────────────────────────────────────────────────────
  if (method === "POST" && path === "/reviews")                   return createReview(user.id, body);
  const userReviews = path.match(/^\/users\/([^/]+)\/reviews$/);
  if (userReviews && method === "GET") return getUserReviews(userReviews[1]);

  // ── NOTIFICATIONS ─────────────────────────────────────────────────────────
  if (method === "GET"  && path === "/notifications")             return getNotifications(user.id, params);
  if (method === "POST" && path === "/notifications/read-all")    return markAllRead(user.id);
  const notifRead = path.match(/^\/notifications\/([^/]+)\/read$/);
  if (notifRead && method === "PUT") return markNotifRead(notifRead[1], user.id);

  // ── DISCOVER / MATCHING ───────────────────────────────────────────────────
  if (method === "GET"  && path === "/discover/matches")          return getMatches(user.id, params);
  if (method === "GET"  && path === "/users/search")              return searchUsers(user.id, params);

  // ── UPLOAD ────────────────────────────────────────────────────────────────
  if (method === "POST" && path === "/upload/presign")            return presignUpload(user.id, body);

  // ── ADMIN ─────────────────────────────────────────────────────────────────
  if (path.startsWith("/admin")) return adminRouter(path, method, user.id, body, params);

  return err("Not found", 404);
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

// ── Sections ────────────────────────────────────────────────────────────────
async function getSections() {
  const sb = getServiceClient();
  const { data } = await sb.from("sections").select("*").order("id");
  return json(data || FALLBACK_SECTIONS);
}

const FALLBACK_SECTIONS = [
  { id: 1, slug: "idea-hub",   name: "Idea Hub",       icon: "💡" },
  { id: 2, slug: "services",   name: "Services",        icon: "⚡" },
  { id: 3, slug: "jobs",       name: "Jobs",            icon: "💼" },
  { id: 4, slug: "farmers",    name: "Farmers Market",  icon: "🌾" },
  { id: 5, slug: "mentorship", name: "Mentorship",      icon: "🧭" },
  { id: 6, slug: "learning",   name: "Learning",        icon: "📚" },
  { id: 7, slug: "investors",  name: "Investors",       icon: "💰" },
  { id: 8, slug: "events",     name: "Events",          icon: "📅" },
];

// ── Profile ─────────────────────────────────────────────────────────────────
async function getMe(userId: string) {
  const sb = getServiceClient();
  const [profile, roles, skills] = await Promise.all([
    sb.from("user_profiles").select("*").eq("id", userId).single(),
    sb.from("user_roles").select("role, is_primary").eq("user_id", userId),
    sb.from("user_skills").select("skill, level").eq("user_id", userId),
  ]);
  return json({ ...profile.data, roles: roles.data, skills: skills.data });
}

async function updateMe(userId: string, body: Record<string, unknown>) {
  const sb = getServiceClient();
  const allowed = ["display_name","bio","location_city","location_country","lat","lng","visibility","portfolio_url","website_url","linkedin_url"];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  allowed.forEach(k => { if (body[k] !== undefined) update[k] = body[k]; });

  // Recalculate profile completion
  const pct = calcCompletionPct({ ...update, id: userId });
  update.profile_completion_pct = pct;

  const { data, error } = await sb.from("user_profiles").update(update).eq("id", userId).select().single();
  if (error) return err(error.message, 500);
  return json(data);
}

function calcCompletionPct(profile: Record<string, unknown>) {
  let score = 0;
  if (profile.display_name) score += 20;
  if (profile.bio)           score += 20;
  if (profile.location_city) score += 15;
  if (profile.avatar_url)    score += 15;
  if (profile.portfolio_url) score += 15;
  if (profile.linkedin_url)  score += 15;
  return Math.min(score, 100);
}

async function updateRoles(userId: string, body: { roles: string[] }) {
  const sb = getServiceClient();
  await sb.from("user_roles").delete().eq("user_id", userId);
  if (body.roles?.length) {
    await sb.from("user_roles").insert(
      body.roles.map((r, i) => ({ user_id: userId, role: r, is_primary: i === 0 }))
    );
  }
  return json({ success: true });
}

async function updateSkills(userId: string, body: { skills: { skill: string; level?: string }[] }) {
  const sb = getServiceClient();
  await sb.from("user_skills").delete().eq("user_id", userId);
  if (body.skills?.length) {
    await sb.from("user_skills").insert(
      body.skills.map(s => ({ user_id: userId, skill: s.skill, level: s.level || "mid" }))
    );
  }
  return json({ success: true });
}

async function getUser2(targetId: string, _viewerId: string) {
  const sb = getServiceClient();
  const [profile, roles, skills] = await Promise.all([
    sb.from("user_profiles").select("*").eq("id", targetId).single(),
    sb.from("user_roles").select("role").eq("user_id", targetId),
    sb.from("user_skills").select("skill, level").eq("user_id", targetId),
  ]);
  if (!profile.data) return err("User not found", 404);
  const online = await redisGet(`online:${targetId}`);
  return json({ ...profile.data, roles: roles.data, skills: skills.data, isOnline: !!online });
}

// ── Posts ────────────────────────────────────────────────────────────────────
async function getPosts(params: Record<string, string>, viewerId: string) {
  const sb = getServiceClient();
  const { section, type, location, q, page = "1", limit = "20" } = params;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = sb
    .from("posts")
    .select("*, user_profiles(display_name, avatar_url, is_verified, rating_avg), post_media(*)")
    .eq("status", "active")
    .neq("author_id", viewerId)
    .order("is_boosted", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + parseInt(limit) - 1);

  if (section) query = query.eq("section_id", parseInt(section));
  if (type)    query = query.eq("post_type", type);
  if (location) query = query.ilike("location_city", `%${location}%`);
  if (q)       query = query.textSearch("fts", q);

  const { data, error } = await query;
  if (error) return err(error.message, 500);
  return json({ posts: data || [], page: parseInt(page), limit: parseInt(limit) });
}

async function getHomeFeed(userId: string, params: Record<string, string>) {
  const cacheKey = `feed:${userId}`;
  const cached = await redisGet(cacheKey);
  if (cached) return json(JSON.parse(cached as string));

  const sb = getServiceClient();
  const { data: profile } = await sb.from("user_profiles").select("location_city").eq("id", userId).single();

  const { data: posts } = await sb
    .from("posts")
    .select("*, user_profiles(display_name, avatar_url, rating_avg)")
    .eq("status", "active")
    .neq("author_id", userId)
    .order("is_boosted", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);

  const city = profile?.location_city || "";
  const scored = (posts || [])
    .map(p => ({ ...p, _score: feedScore(p, city) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 20);

  await redisSet(cacheKey, JSON.stringify(scored), 7200); // 2h cache
  return json(scored);
}

function feedScore(post: Record<string, unknown>, userCity: string) {
  const ageHours = (Date.now() - new Date(post.created_at as string).getTime()) / 3600000;
  let score = 100 * Math.exp(-0.02 * ageHours);
  score += Math.min((post.interest_count as number) * 0.5, 20);
  score += Math.min((post.view_count as number) * 0.05, 10);
  if (post.is_boosted) score *= 2;
  if (post.location_city === userCity) score += 20;
  return score;
}

async function getTrending() {
  const sb = getServiceClient();
  const { data } = await sb
    .from("posts")
    .select("*, user_profiles(display_name, avatar_url)")
    .eq("status", "active")
    .order("interest_count", { ascending: false })
    .limit(10);
  return json(data || []);
}

async function createPost(userId: string, body: Record<string, unknown>) {
  const sb = getServiceClient();
  const { title, description, post_type, section_id, tags, location_city, location_country, budget_min, budget_max, currency } = body as Record<string, string | number | string[]>;
  if (!title || !description) return err("Title and description required");

  const { data, error } = await sb.from("posts").insert({
    author_id: userId, title, description, post_type, section_id,
    tags: tags || [], location_city, location_country,
    budget_min, budget_max, currency: currency || "BDT",
    status: "active", view_count: 0, interest_count: 0,
  }).select().single();

  if (error) return err(error.message, 500);

  // Invalidate feed cache
  await redisDel(`feed:${userId}`);

  // Notify followers via Supabase Realtime (DB trigger handles it)
  return json(data, 201);
}

async function getPost(postId: string, userId: string) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("posts")
    .select("*, user_profiles(display_name, avatar_url, is_verified, rating_avg, location_city), post_media(*)")
    .eq("id", postId)
    .single();
  if (!data) return err("Post not found", 404);

  // Increment views (fire-and-forget)
  sb.from("posts").update({ view_count: (data.view_count || 0) + 1 }).eq("id", postId).then(() => {});

  return json({ ...data, isBookmarked: await checkBookmark(userId, postId) });
}

async function updatePost(postId: string, userId: string, body: Record<string, unknown>) {
  const sb = getServiceClient();
  const { data: post } = await sb.from("posts").select("author_id").eq("id", postId).single();
  if (!post || post.author_id !== userId) return err("Unauthorized", 403);

  const allowed = ["title","description","tags","location_city","budget_min","budget_max","status"];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  allowed.forEach(k => { if (body[k] !== undefined) update[k] = body[k]; });

  const { data } = await sb.from("posts").update(update).eq("id", postId).select().single();
  return json(data);
}

async function deletePost(postId: string, userId: string) {
  const sb = getServiceClient();
  const { data: post } = await sb.from("posts").select("author_id").eq("id", postId).single();
  if (!post || post.author_id !== userId) return err("Unauthorized", 403);
  await sb.from("posts").update({ status: "deleted" }).eq("id", postId);
  return json({ success: true });
}

async function expressInterest(postId: string, userId: string) {
  const sb = getServiceClient();
  const { data: post } = await sb.from("posts").select("author_id, title, interest_count").eq("id", postId).single();
  if (!post) return err("Post not found", 404);

  await sb.from("posts").update({ interest_count: (post.interest_count || 0) + 1 }).eq("id", postId);
  await createNotif(sb, post.author_id, "post_interest", {
    title: "New interest on your post",
    body: `Someone is interested in: "${post.title}"`,
    data: { postId },
  });
  return json({ success: true, interest_count: post.interest_count + 1 });
}

async function checkBookmark(userId: string, postId: string) {
  const sb = getServiceClient();
  const { data } = await sb.from("post_bookmarks").select("post_id").eq("user_id", userId).eq("post_id", postId).single();
  return !!data;
}

async function bookmarkPost(postId: string, userId: string) {
  const sb = getServiceClient();
  await sb.from("post_bookmarks").upsert({ user_id: userId, post_id: postId });
  return json({ success: true });
}

async function unbookmarkPost(postId: string, userId: string) {
  const sb = getServiceClient();
  await sb.from("post_bookmarks").delete().eq("user_id", userId).eq("post_id", postId);
  return json({ success: true });
}

async function boostPost(postId: string, userId: string, body: { boost_type?: string; duration_days?: number }) {
  const sb = getServiceClient();
  const days = body.duration_days || 7;
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

  const { data: post } = await sb.from("posts").select("author_id").eq("id", postId).single();
  if (!post || post.author_id !== userId) return err("Unauthorized", 403);

  await Promise.all([
    sb.from("post_boosts").insert({ post_id: postId, user_id: userId, boost_type: body.boost_type || "featured", expires_at: expiresAt, starts_at: new Date().toISOString() }),
    sb.from("posts").update({ is_boosted: true, boost_expires_at: expiresAt }).eq("id", postId),
  ]);
  return json({ success: true, expires_at: expiresAt });
}

// ── Connections ─────────────────────────────────────────────────────────────
async function getConnections(userId: string) {
  const sb = getServiceClient();
  const { data } = await sb
    .from("connections")
    .select(`id, status, created_at,
      requester:user_profiles!connections_requester_id_fkey(id, display_name, avatar_url),
      receiver:user_profiles!connections_receiver_id_fkey(id, display_name, avatar_url)`)
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
    .eq("status", "accepted");
  return json(data || []);
}

async function getConnectionRequests(userId: string) {
  const sb = getServiceClient();
  const { data } = await sb
    .from("connections")
    .select(`id, created_at, requester:user_profiles!connections_requester_id_fkey(id, display_name, avatar_url)`)
    .eq("receiver_id", userId)
    .eq("status", "pending");
  return json(data || []);
}

async function sendConnectionRequest(fromId: string, toId: string) {
  if (fromId === toId) return err("Cannot connect to yourself");
  const sb = getServiceClient();

  const { data: existing } = await sb
    .from("connections")
    .select("id, status")
    .or(`and(requester_id.eq.${fromId},receiver_id.eq.${toId}),and(requester_id.eq.${toId},receiver_id.eq.${fromId})`)
    .single();

  if (existing) return json({ existing: true, status: existing.status });

  const { data, error } = await sb.from("connections").insert({
    requester_id: fromId, receiver_id: toId, status: "pending",
  }).select().single();
  if (error) return err(error.message, 500);

  await createNotif(sb, toId, "connection_request", {
    title: "New connection request",
    body: "Someone wants to connect with you.",
    data: { requestId: data.id, fromUserId: fromId },
  });
  return json(data, 201);
}

async function acceptConnection(userId: string, requestId: string) {
  const sb = getServiceClient();
  const { data: conn } = await sb.from("connections").select("*").eq("id", requestId).single();
  if (!conn || conn.receiver_id !== userId) return err("Unauthorized", 403);

  await sb.from("connections").update({ status: "accepted", updated_at: new Date().toISOString() }).eq("id", requestId);

  // Create conversation for the now-connected pair
  const { data: conv } = await sb.from("conversations").insert({ type: "direct" }).select().single();
  await sb.from("conversation_participants").insert([
    { conversation_id: conv.id, user_id: conn.requester_id },
    { conversation_id: conv.id, user_id: userId },
  ]);

  await createNotif(sb, conn.requester_id, "connection_request", {
    title: "Connection accepted!",
    body: "Your connection request was accepted.",
    data: { conversationId: conv.id },
  });
  return json({ success: true, conversationId: conv.id });
}

async function rejectConnection(userId: string, requestId: string) {
  const sb = getServiceClient();
  await sb.from("connections").update({ status: "rejected" }).eq("id", requestId).eq("receiver_id", userId);
  return json({ success: true });
}

// ── Conversations ────────────────────────────────────────────────────────────
async function getConversations(userId: string) {
  const sb = getServiceClient();
  const { data: parts } = await sb.from("conversation_participants").select("conversation_id").eq("user_id", userId);
  if (!parts?.length) return json([]);

  const ids = parts.map((p: { conversation_id: string }) => p.conversation_id);
  const { data: convs } = await sb
    .from("conversations")
    .select(`*, conversation_participants(user_id, last_read_at, user_profiles(id, display_name, avatar_url))`)
    .in("id", ids)
    .order("last_message_at", { ascending: false });

  // Attach last message per conversation
  const withLastMsg = await Promise.all(
    (convs || []).map(async (c: { id: string }) => {
      const { data: msg } = await sb
        .from("messages")
        .select("content, created_at, sender_id, type")
        .eq("conversation_id", c.id)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      return { ...c, lastMessage: msg };
    })
  );
  return json(withLastMsg);
}

async function createOrGetConversation(userId: string, body: { withUserId: string }) {
  const sb = getServiceClient();
  const { withUserId } = body;
  if (!withUserId) return err("withUserId required");

  // Find existing DM
  const { data: myParts } = await sb.from("conversation_participants").select("conversation_id").eq("user_id", userId);
  const { data: theirParts } = await sb.from("conversation_participants").select("conversation_id").eq("user_id", withUserId);
  const myIds = new Set((myParts || []).map((p: { conversation_id: string }) => p.conversation_id));
  const shared = (theirParts || []).find((p: { conversation_id: string }) => myIds.has(p.conversation_id));

  if (shared) return json({ conversationId: shared.conversation_id, existing: true });

  // Create new DM
  const { data: conv } = await sb.from("conversations").insert({ type: "direct" }).select().single();
  await sb.from("conversation_participants").insert([
    { conversation_id: conv.id, user_id: userId },
    { conversation_id: conv.id, user_id: withUserId },
  ]);
  return json({ conversationId: conv.id, existing: false }, 201);
}

async function getMessages(convId: string, userId: string, params: Record<string, string>) {
  const sb = getServiceClient();
  const { data: part } = await sb.from("conversation_participants").select("id").eq("conversation_id", convId).eq("user_id", userId).single();
  if (!part) return err("Not a participant", 403);

  const page = parseInt(params.page || "1");
  const limit = parseInt(params.limit || "50");
  const offset = (page - 1) * limit;

  const { data: msgs } = await sb
    .from("messages")
    .select("*, sender:user_profiles!messages_sender_id_fkey(display_name, avatar_url)")
    .eq("conversation_id", convId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // Update last_read_at
  sb.from("conversation_participants").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", convId).eq("user_id", userId).then(() => {});

  return json((msgs || []).reverse());
}

async function sendMessage(convId: string, userId: string, body: { content?: string; type?: string; file_url?: string; file_name?: string }) {
  const sb = getServiceClient();
  const { data: part } = await sb.from("conversation_participants").select("id").eq("conversation_id", convId).eq("user_id", userId).single();
  if (!part) return err("Not a participant", 403);

  const { data: msg, error } = await sb.from("messages").insert({
    conversation_id: convId,
    sender_id: userId,
    type: body.type || "text",
    content: body.content,
    file_url: body.file_url,
    file_name: body.file_name,
    is_deleted: false,
  }).select().single();

  if (error) return err(error.message, 500);

  await sb.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);

  // Notify other participants
  const { data: parts } = await sb.from("conversation_participants").select("user_id").eq("conversation_id", convId).neq("user_id", userId);
  for (const p of parts || []) {
    await createNotif(sb, (p as { user_id: string }).user_id, "message", {
      title: "New message",
      body: body.content?.slice(0, 60) || "Sent a file",
      data: { conversationId: convId },
    });
  }
  return json(msg, 201);
}

async function deleteMessage(msgId: string, userId: string) {
  const sb = getServiceClient();
  await sb.from("messages").update({ is_deleted: true, content: "Message deleted" }).eq("id", msgId).eq("sender_id", userId);
  return json({ success: true });
}

// ── Bookings ─────────────────────────────────────────────────────────────────
async function getBookings(userId: string, params: Record<string, string>) {
  const sb = getServiceClient();
  let q = sb
    .from("bookings")
    .select(`*, 
      provider:user_profiles!bookings_provider_id_fkey(id, display_name, avatar_url),
      client:user_profiles!bookings_client_id_fkey(id, display_name, avatar_url)`)
    .or(`provider_id.eq.${userId},client_id.eq.${userId}`)
    .order("created_at", { ascending: false });
  if (params.status) q = q.eq("status", params.status);
  const { data } = await q;
  return json(data || []);
}

async function createBooking(userId: string, body: Record<string, unknown>) {
  const sb = getServiceClient();
  const { provider_id, title, description, scheduled_at, price, currency, post_id } = body as Record<string, string | number>;
  if (!provider_id || !title || !price) return err("provider_id, title, and price required");

  const { data, error } = await sb.from("bookings").insert({
    post_id, provider_id, client_id: userId,
    title, description, scheduled_at,
    price, currency: currency || "BDT",
    status: "pending", payment_status: "unpaid", commission_pct: 10,
  }).select().single();
  if (error) return err(error.message, 500);

  await createNotif(sb, provider_id as string, "booking_update", {
    title: "New booking request",
    body: `${title} — ৳${price}`,
    data: { bookingId: data.id },
  });
  return json(data, 201);
}

async function updateBookingStatus(bookingId: string, userId: string, body: { status: string }) {
  const sb = getServiceClient();
  const valid = ["accepted","declined","completed","cancelled"];
  if (!valid.includes(body.status)) return err("Invalid status");

  const { data: booking } = await sb.from("bookings").select("*").eq("id", bookingId).single();
  if (!booking) return err("Not found", 404);
  if (booking.provider_id !== userId && booking.client_id !== userId) return err("Unauthorized", 403);

  await sb.from("bookings").update({ status: body.status, updated_at: new Date().toISOString() }).eq("id", bookingId);

  const notifyId = userId === booking.provider_id ? booking.client_id : booking.provider_id;
  await createNotif(sb, notifyId, "booking_update", {
    title: `Booking ${body.status}`,
    body: booking.title,
    data: { bookingId: booking.id, status: body.status },
  });
  return json({ success: true, status: body.status });
}

// ── Reviews ──────────────────────────────────────────────────────────────────
async function createReview(userId: string, body: Record<string, unknown>) {
  const sb = getServiceClient();
  const { booking_id, rating, comment } = body as { booking_id: string; rating: number; comment: string };
  if (!booking_id || !rating || rating < 1 || rating > 5) return err("booking_id and rating (1-5) required");

  const { data: booking } = await sb.from("bookings").select("*").eq("id", booking_id).single();
  if (!booking || booking.status !== "completed") return err("Can only review completed bookings");

  const reviewee_id = userId === booking.client_id ? booking.provider_id : booking.client_id;
  const { data, error } = await sb.from("reviews").insert({
    booking_id, reviewer_id: userId, reviewee_id, rating, comment,
  }).select().single();
  if (error) return err("Review already submitted or error: " + error.message, 409);

  // Update user's average rating
  const { data: allReviews } = await sb.from("reviews").select("rating").eq("reviewee_id", reviewee_id);
  const avg = (allReviews || []).reduce((s: number, r: { rating: number }) => s + r.rating, 0) / (allReviews?.length || 1);
  await sb.from("user_profiles").update({
    rating_avg: Math.round(avg * 10) / 10,
    rating_count: allReviews?.length || 0,
  }).eq("id", reviewee_id);

  return json(data, 201);
}

async function getUserReviews(userId: string) {
  const sb = getServiceClient();
  const { data } = await sb
    .from("reviews")
    .select("*, reviewer:user_profiles!reviews_reviewer_id_fkey(display_name, avatar_url)")
    .eq("reviewee_id", userId)
    .order("created_at", { ascending: false });
  return json(data || []);
}

// ── Notifications ────────────────────────────────────────────────────────────
async function getNotifications(userId: string, params: Record<string, string>) {
  const sb = getServiceClient();
  const page = parseInt(params.page || "1");
  const limit = parseInt(params.limit || "30");
  const offset = (page - 1) * limit;

  const { data } = await sb
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  return json(data || []);
}

async function markAllRead(userId: string) {
  const sb = getServiceClient();
  await sb.from("notifications").update({ is_read: true }).eq("user_id", userId).eq("is_read", false);
  return json({ success: true });
}

async function markNotifRead(notifId: string, userId: string) {
  const sb = getServiceClient();
  await sb.from("notifications").update({ is_read: true }).eq("id", notifId).eq("user_id", userId);
  return json({ success: true });
}

// ── Discover / Matching ──────────────────────────────────────────────────────
async function getMatches(userId: string, _params: Record<string, string>) {
  const cacheKey = `matches:${userId}`;
  const cached = await redisGet(cacheKey);
  if (cached) return json(JSON.parse(cached as string));

  const sb = getServiceClient();
  const [meRes, myRolesRes, mySkillsRes, candidatesRes] = await Promise.all([
    sb.from("user_profiles").select("location_city").eq("id", userId).single(),
    sb.from("user_roles").select("role").eq("user_id", userId),
    sb.from("user_skills").select("skill").eq("user_id", userId),
    sb.from("user_profiles")
      .select("*, user_roles(role), user_skills(skill)")
      .neq("id", userId)
      .limit(100),
  ]);

  const me = meRes.data;
  const myRoles = (myRolesRes.data || []).map((r: { role: string }) => r.role);
  const mySkillSet = new Set((mySkillsRes.data || []).map((s: { skill: string }) => s.skill));

  const scored = (candidatesRes.data || [])
    .map(u => ({
      ...u,
      matchScore: matchScore(me, myRoles, mySkillSet, u),
    }))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 20);

  await redisSet(cacheKey, JSON.stringify(scored), 3600);
  return json(scored);
}

function matchScore(
  me: { location_city?: string } | null,
  myRoles: string[],
  mySkillSet: Set<string>,
  candidate: { user_roles?: { role: string }[]; user_skills?: { skill: string }[]; location_city?: string; profile_completion_pct?: number; rating_avg?: number }
) {
  const complementary: Record<string, string[]> = {
    investor: ["founder"], founder: ["investor","freelancer","mentor"],
    freelancer: ["founder","service_provider"], farmer: ["investor","service_provider"],
    student: ["mentor"], mentor: ["student","founder"],
  };
  const candRoles = (candidate.user_roles || []).map(r => r.role);
  const candSkills = new Set((candidate.user_skills || []).map(s => s.skill));

  let score = 0;
  if (myRoles.some(mr => (complementary[mr] || []).some(cr => candRoles.includes(cr)))) score += 35;
  score += Math.min([...mySkillSet].filter(s => candSkills.has(s)).length * 5, 20);
  if (me?.location_city && candidate.location_city === me.location_city) score += 15;
  score += Math.round((candidate.profile_completion_pct || 0) * 0.10);
  score += Math.min(candidate.rating_avg || 0, 5);
  return Math.min(score, 100);
}

async function searchUsers(userId: string, params: Record<string, string>) {
  const sb = getServiceClient();
  const { q, role, page = "1", limit = "20" } = params;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = sb
    .from("user_profiles")
    .select("*, user_roles(role)")
    .neq("id", userId)
    .range(offset, offset + parseInt(limit) - 1);

  if (q) query = query.or(`display_name.ilike.%${q}%,bio.ilike.%${q}%`);

  const { data } = await query;
  let results = data || [];
  if (role) results = results.filter((u: { user_roles?: { role: string }[] }) => (u.user_roles || []).some((r) => r.role === role));
  return json(results);
}

// ── Upload presign ────────────────────────────────────────────────────────────
async function presignUpload(userId: string, body: { fileName: string; bucket?: string }) {
  const sb = getServiceClient();
  const bucket = body.bucket || "media";
  const key = `${userId}/${Date.now()}-${body.fileName}`;
  const { data, error } = await sb.storage.from(bucket).createSignedUploadUrl(key);
  if (error) return err(error.message, 500);
  return json({ signedUrl: data.signedUrl, path: key, publicUrl: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${bucket}/${key}` });
}

// ── Admin ─────────────────────────────────────────────────────────────────────
async function adminRouter(path: string, method: string, userId: string, body: Record<string, unknown>, _params: Record<string, string>) {
  const sb = getServiceClient();
  // Verify admin
  const { data: user } = await sb.from("users").select("is_admin").eq("id", userId).single();
  if (!user?.is_admin) return err("Admin only", 403);

  if (method === "GET" && path === "/admin/stats") {
    const [users, posts, bookings, revenue] = await Promise.all([
      sb.from("users").select("id", { count: "exact", head: true }),
      sb.from("posts").select("id", { count: "exact", head: true }).eq("status", "active"),
      sb.from("bookings").select("id", { count: "exact", head: true }),
      sb.from("transactions").select("net_amount").eq("status", "completed"),
    ]);
    const totalRevenue = (revenue.data || []).reduce((s: number, t: { net_amount: number }) => s + t.net_amount, 0);
    return json({ users: users.count, posts: posts.count, bookings: bookings.count, revenue: totalRevenue });
  }

  if (method === "GET" && path === "/admin/reports") {
    const { data } = await sb
      .from("reports")
      .select("*, reporter:user_profiles!reports_reporter_id_fkey(display_name)")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    return json(data || []);
  }

  const suspendMatch = path.match(/^\/admin\/users\/([^/]+)\/suspend$/);
  if (suspendMatch && method === "PUT") {
    const targetId = suspendMatch[1];
    const { reason, days = 7 } = body as { reason: string; days: number };
    const until = new Date(Date.now() + (days as number) * 86_400_000).toISOString();
    await Promise.all([
      sb.from("user_suspensions").insert({ user_id: targetId, suspended_until: until, reason, created_by: userId }),
      sb.from("users").update({ is_suspended: true }).eq("id", targetId),
    ]);
    return json({ success: true });
  }

  return err("Admin route not found", 404);
}

// ── Shared notification helper ────────────────────────────────────────────────
async function createNotif(
  sb: ReturnType<typeof getServiceClient>,
  userId: string,
  type: string,
  { title, body, data }: { title: string; body: string; data: Record<string, unknown> }
) {
  await sb.from("notifications").insert({ user_id: userId, type, title, body, data, is_read: false });
}
