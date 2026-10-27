import { listFacets, loadVoices, nativeVoice, parseQuery, searchList, speaks } from "./voices";

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS?: Fetcher;
  ALLOWED_ORIGINS?: string;
  IP_SALT?: string;
  TURNSTILE_SECRET?: string;
  FAL_KEY?: string;
  GEMINI_ACCOUNTS_KV?: KVNamespace;
  GOOGLE_AAS_ACCOUNTS?: string;
  GOOGLE_AAS_ACCOUNT_1?: string;
  GOOGLE_AAS_ACCOUNT_2?: string;
  GOOGLE_AAS_ACCOUNT_3?: string;
  GOOGLE_AAS_ACCOUNT_4?: string;
  GOOGLE_AAS_ACCOUNT_5?: string;
  GOOGLE_AAS_ACCOUNT_6?: string;
  GOOGLE_AAS_ACCOUNT_7?: string;
  GOOGLE_AAS_ACCOUNT_8?: string;
  GOOGLE_AAS_ACCOUNT_9?: string;
  GOOGLE_AAS_ACCOUNT_10?: string;
  VOICE_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

type Status = "unlisted" | "pending" | "public" | "hidden";
type Media = { video: string; clean: string | null; poster: string | null; keyframes: string[] };
type Story = { script: string[]; kinds: string[]; events: { t: number; stage: string; msg: string }[] };
type Row = {
  id: string;
  owner_hash: string;
  status: Status;
  created: number;
  shared: number;
  title: string;
  subtitle: string;
  topic: string;
  lang: string;
  style: string;
  style_label: string;
  narrator: string;
  voice: string;
  character_id: string;
  minutes: number | null;
  duration: number;
  media: string;
  story: string;
  views: number;
  reports: number;
  link_at: number | null;
  flag: string;
  moderation: string;
};

const MB = 1024 * 1024;
const HOUR = 3600;
const DAY = 24 * HOUR;
const LINKS_PER_DAY = 10;
const EXPLORE_PER_DAY = 10;
const SHARES_PER_DAY_ALL = 500;
const REPORTS_TO_REVIEW = 3;
const ISSUES_PER_DAY = 20;
const ISSUE_KINDS = ["voice", "edit", "picture", "subtitles", "story", "other"];
const REFUSE_BELOW = 0.2;
const REVIEW_BELOW = 0.7;

class HttpError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const now = () => Math.floor(Date.now() / 1000);

function randomId(n: number) {
  const abc = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => abc[b % abc.length]).join("");
}

async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const ipHash = (req: Request, env: Env) => sha256(`${env.IP_SALT ?? "storycast"}|${req.headers.get("cf-connecting-ip") ?? ""}`);

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const reqOrigin = new URL(req.url).origin;
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = !origin || origin === reqOrigin || allowed.includes(origin) || allowed.includes("*");
  if (!ok) return {};
  return {
    "access-control-allow-origin": origin || reqOrigin,
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

const json = (data: unknown, req: Request, env: Env, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors(req, env) } });

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // Query params arrive as strings — the binary /media upload reads scene
  // from the query, and without this every video landed on scene 0.
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
};

function falUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || !(u.hostname === "fal.media" || u.hostname.endsWith(".fal.media"))) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const EXT_TYPES: Record<string, string> = { mp4: "video/mp4", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

const PART = 5 * MB;

async function putStream(env: Env, key: string, body: ReadableStream<Uint8Array>, type: string, maxBytes: number) {
  const meta = { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } };
  const reader = body.getReader();
  let buf = new Uint8Array(PART);
  let fill = 0;
  let total = 0;
  let upload: R2MultipartUpload | null = null;
  const parts: R2UploadedPart[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        total += value.length;
        if (total > maxBytes) throw new HttpError(413, "the file is too large");
        let off = 0;
        while (off < value.length) {
          const n = Math.min(PART - fill, value.length - off);
          buf.set(value.subarray(off, off + n), fill);
          fill += n;
          off += n;
          if (fill === PART) {
            upload ??= await env.MEDIA.createMultipartUpload(key, meta);
            parts.push(await upload.uploadPart(parts.length + 1, buf));
            buf = new Uint8Array(PART);
            fill = 0;
          }
        }
      }
      if (done) break;
    }
    if (!total) throw new HttpError(422, "the file is empty");
    if (!upload) {
      await env.MEDIA.put(key, buf.subarray(0, fill), meta);
      return;
    }
    if (fill) parts.push(await upload.uploadPart(parts.length + 1, buf.subarray(0, fill)));
    await upload.complete(parts);
  } catch (e) {
    await upload?.abort().catch(() => {});
    await reader.cancel().catch(() => {});
    throw e;
  }
}

async function copy(env: Env, url: string, key: string, kind: "video" | "image", maxBytes: number) {
  const r = await fetch(url, { headers: { "accept-encoding": "identity" } });
  if (!r.ok || !r.body) throw new HttpError(422, `could not read the ${kind} from fal (${r.status})`);
  const ext = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";

  const ALLOWED = kind === "video" ? ["video/mp4"] : ["image/png", "image/jpeg", "image/webp"];
  let type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED.includes(type)) type = EXT_TYPES[ext] ?? "";
  if (!ALLOWED.includes(type)) throw new HttpError(422, `that ${kind} is not a supported ${kind} file`);

  let length = Number(r.headers.get("content-length"));
  if (!length) length = Number((await fetch(url, { method: "HEAD", headers: { "accept-encoding": "identity" } })).headers.get("content-length"));
  if (length > maxBytes) throw new HttpError(413, `the ${kind} is too large`);
  const name = `${key}.${type === "video/mp4" ? "mp4" : (Object.entries(EXT_TYPES).find(([, t]) => t === type)?.[0] ?? "bin")}`;
  if (length > 0) {
    const body = r.headers.get("content-length") ? r.body : r.body.pipeThrough(new FixedLengthStream(length));
    await env.MEDIA.put(name, body, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  } else await putStream(env, name, r.body, type, maxBytes);
  return name;
}

async function pool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function falRun<T>(env: Env, app: string, input: Record<string, unknown>): Promise<T> {
  const r = await fetch(`https://fal.run/${app}`, {
    method: "POST",
    headers: { authorization: `Key ${env.FAL_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`${app} answered ${r.status}`);
  return (await r.json()) as T;
}

const DESCRIBE =
  "You are a content safety describer. Describe factually and briefly what the images show. Always mention any nudity or sexual " +
  "content, violence, blood or gore, weapons, drugs, hate symbols, real recognisable people or celebrities, brand logos, visible text, " +
  "URLs or QR codes. Do not judge, only describe.";

const QUESTIONS = {
  allowed: {
    type: "noul",
    instructions: "Is this shared story fine to show publicly on a family-friendly site of short narrated explainer films?",
    criteria: {
      true: "Harmless storytelling or explanation on any topic, including history, science, nature and everyday life.",
      false:
        "Sexual content, hate or harassment, graphic violence or gore, self-harm, illegal activity, spam or ads, scams or phishing, " +
        "personal data, a video that does not match the story, or content that is not a story at all.",
    },
  },
  category: {
    type: "choice",
    instructions: "What is the main problem, if any?",
    criteria: {
      none: "No problem",
      sexual: "Sexual or adult content",
      hate: "Hate, harassment or bullying",
      violence: "Graphic violence or gore",
      illegal: "Illegal activity, drugs or weapons",
      spam: "Spam, ads, links, scams or phishing",
      personal: "Personal data about real private people",
      mismatch: "The video does not match the story",
      other: "Something else unsafe",
    },
  },
};

const shareTokenCache = new Map<string, { token: string; exp: number }>();
const shareCooldown = new Map<string, number>();
let shareAccIdx = 0;

async function loadEnvAccounts(env: Env): Promise<{ id: string; authData: string }[]> {
  const list: { id: string; authData: string }[] = [];
  const envAny = env as unknown as Record<string, unknown>;
  for (let i = 1; i <= 10; i++) {
    const val = envAny[`GOOGLE_AAS_ACCOUNT_${i}`];
    if (typeof val === "string" && val.trim()) {
      list.push({ id: `env_acc_${i}`, authData: val.trim() });
    }
  }
  if (typeof env.GOOGLE_AAS_ACCOUNTS === "string" && env.GOOGLE_AAS_ACCOUNTS.trim()) {
    const parts = env.GOOGLE_AAS_ACCOUNTS.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    parts.forEach((raw, idx) => list.push({ id: `env_list_${idx + 1}`, authData: raw }));
  }
  if (env.GEMINI_ACCOUNTS_KV) {
    try {
      const raw = await env.GEMINI_ACCOUNTS_KV.get("custom_accounts");
      if (raw) {
        const parsed = JSON.parse(raw) as { id?: string; authData?: string; active?: boolean; deleted?: boolean }[];
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.authData && item.active !== false && !item.deleted) {
              list.push({ id: item.id || `kv_${list.length + 1}`, authData: item.authData });
            }
          }
        }
      }
    } catch {}
  }
  return list;
}

async function getShareGeminiToken(env: Env): Promise<{ token: string; accountId: string; expiresIn: number }> {
  const accounts = await loadEnvAccounts(env);
  if (!accounts.length) throw new HttpError(503, "No GOOGLE_AAS_ACCOUNT configured in Worker environment");
  const nowMs = Date.now();
  const ready = accounts.filter((a) => (shareCooldown.get(a.id) ?? 0) <= nowMs);
  const pool = ready.length ? ready : accounts;

  for (let i = 0; i < pool.length; i++) {
    const acc = pool[shareAccIdx % pool.length];
    shareAccIdx = (shareAccIdx + 1) % pool.length;

    const cached = shareTokenCache.get(acc.id);
    if (cached && cached.exp > nowMs + 60_000) {
      return { token: cached.token, accountId: acc.id, expiresIn: Math.round((cached.exp - nowMs) / 1000) };
    }

    const raw = acc.authData.startsWith("aas_et/")
      ? `androidId=3c4096cfd46caf54&Email=user%40gmail.com&Token=${encodeURIComponent(acc.authData)}`
      : acc.authData;
    const p = new URLSearchParams(raw);
    let master = p.get("Token") || "";
    if (master.includes("%")) {
      try {
        master = decodeURIComponent(master);
      } catch {}
    }
    const body = new URLSearchParams({
      androidId: p.get("androidId") || "3c4096cfd46caf54",
      app: "com.google.android.googlequicksearchbox",
      client_sig: "38918a453d07199354f8b19af05ec6562ced5788",
      callerPkg: "com.google.android.googlequicksearchbox",
      callerSig: "38918a453d07199354f8b19af05ec6562ced5788",
      device_country: "id",
      Email: p.get("Email") || "",
      google_play_services_version: "263332035",
      lang: "en_US",
      sdk_version: "35",
      service: "oauth2:https://www.googleapis.com/auth/generative-language",
      source: "android",
      Token: master,
    });
    const res = await fetch("https://android.googleapis.com/auth", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "GoogleAuth/1.4" },
      body: body.toString(),
    });
    if (!res.ok) {
      shareCooldown.set(acc.id, nowMs + 120_000);
      continue;
    }
    const t = await res.text();
    for (const line of t.split("\n")) {
      if (line.startsWith("Auth=")) {
        const token = line.slice(5).trim();
        const exp = nowMs + 45 * 60_000;
        shareTokenCache.set(acc.id, { token, exp });
        return { token, accountId: acc.id, expiresIn: 2700 };
      }
    }
  }
  throw new HttpError(502, "Failed to exchange Google AAS token from Worker environment");
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  return btoa(bin);
}

type Verdict = { allowed: number | null; category: string; seen: string };

async function moderate(env: Env, video: string, images: string[], text: Record<string, unknown>): Promise<Verdict> {
  if (!env.FAL_KEY) return { allowed: null, category: "unchecked", seen: "" };
  try {
    const frames = await Promise.all(
      ["first", "middle", "last"].map((frame_type) =>
        falRun<{ images?: { url: string }[] }>(env, "fal-ai/ffmpeg-api/extract-frame", { video_url: video, frame_type })
          .then((r) => r.images?.[0]?.url ?? null)
          .catch(() => null),
      ),
    );
    const got = frames.filter((u): u is string => !!u);
    if (!got.length) return { allowed: null, category: "unreadable", seen: "" };
    const { token } = await getShareGeminiToken(env);
    const imgParts = (
      await Promise.all(
        [...got, ...images.slice(0, 3)].map(async (u) => {
          try {
            const r = await fetch(u);
            if (!r.ok) return null;
            const b = await r.arrayBuffer();
            const mime = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
            return { inlineData: { mimeType: mime, data: bufToB64(b) } };
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean);

    const vr = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: DESCRIBE }] },
        contents: [
          {
            role: "user",
            parts: [
              ...imgParts,
              { text: "The first images are frames from one short video, the rest are illustrations shown with it. Describe them in at most 120 words." },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 1500 },
      }),
    });
    const vd = (await vr.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const seen = (vd.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").slice(0, 2000);

    const dr = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Evaluate this shared story based on the criteria: ${JSON.stringify(QUESTIONS)}\nState: ${JSON.stringify({ ...text, what_the_video_shows: seen })}\nReturn ONLY JSON: {"allowed": 0.0 to 1.0, "category": "none|sexual|hate|violence|illegal|spam|personal|mismatch|other"}`,
              },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 256, responseMimeType: "application/json" },
      }),
    });
    const dd = (await dr.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const rawJson = JSON.parse((dd.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}").trim()) as { allowed?: number; category?: string };
    return { allowed: typeof rawJson.allowed === "number" ? rawJson.allowed : null, category: rawJson.category ?? "none", seen };
  } catch {
    return { allowed: null, category: "unchecked", seen: "" };
  }
}

async function verifyTurnstile(env: Env, token: unknown, req: Request) {
  if (!env.TURNSTILE_SECRET) return;
  if (typeof token !== "string" || !token) throw new HttpError(403, "the bot check is missing, please try again");
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET);
  form.set("response", token);
  form.set("remoteip", req.headers.get("cf-connecting-ip") ?? "");
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const d = (await r.json()) as { success?: boolean; hostname?: string };
  if (!d.success) throw new HttpError(403, "the bot check failed, please try again");

  const origins = env.ALLOWED_ORIGINS.split(",").map((o) => new URL(o.trim()).hostname);
  if (d.hostname && !origins.includes(d.hostname)) throw new HttpError(403, "the bot check failed, please try again");
}

const sigHash = async (env: Env, id: string, exp: number) => (await sha256(`${env.IP_SALT}|media|${id}|${exp}`)).slice(0, 24);

async function mediaSig(env: Env, id: string) {
  const exp = (Math.floor(now() / HOUR) + 2) * HOUR;
  return `${exp}.${await sigHash(env, id, exp)}`;
}
async function validSig(env: Env, id: string, sig: string | null) {
  const [exp, hash] = (sig ?? "").split(".");
  const e = Number(exp);
  return Number.isFinite(e) && e > now() && e - now() <= 2 * HOUR && same(hash ?? "", await sigHash(env, id, e));
}

function mediaUrl(req: Request, key: string | null, sig = "") {
  return key ? `${new URL(req.url).origin}/m/${key}${sig ? `?s=${sig}` : ""}` : null;
}

function toFilm(req: Request, row: Row, full: boolean, sig = "") {
  const m = JSON.parse(row.media) as Media;
  const s = JSON.parse(row.story) as Story;
  const poster = mediaUrl(req, m.poster, sig);
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    topic: row.topic,
    style: row.style,
    style_label: row.style_label,
    lang: row.lang,
    minutes: row.minutes,
    duration: row.duration,
    created: row.shared,
    narrator: row.narrator,
    voice: row.voice,
    video: mediaUrl(req, m.video, sig),
    clean: mediaUrl(req, m.clean, sig),
    poster,
    thumb: poster,
    keyframes: m.keyframes.map((k) => mediaUrl(req, k, sig)),
    script: s.script,
    kinds: s.kinds,
    character_id: row.character_id,
    events: full ? s.events : [],
    community: true,
    status: row.status,
    in_review: row.status === "hidden" && !!row.flag,
    views: row.views,
  };
}

async function quota(env: Env, ip: string) {
  const t = now();
  const q = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM films WHERE link_ip = ?1 AND link_at > ?2) AS links,
       (SELECT MIN(link_at) FROM films WHERE link_ip = ?1 AND link_at > ?2) AS oldest,
       (SELECT COUNT(*) FROM films WHERE ip_hash = ?1 AND shared > ?2 AND link_at IS NULL) AS explore,
       (SELECT COUNT(*) FROM films WHERE shared > ?2) AS everyone`,
  )
    .bind(ip, t - DAY)
    .first<{ links: number; oldest: number | null; explore: number; everyone: number }>();
  return {
    links_left: Math.max(0, LINKS_PER_DAY - (q?.links ?? 0)),
    links_reset_at: q?.oldest ? q.oldest + DAY : null,
    explore_left: Math.max(0, EXPLORE_PER_DAY - (q?.explore ?? 0)),
    busy: (q?.everyone ?? 0) >= SHARES_PER_DAY_ALL,
  };
}

function linkLimit(q: Awaited<ReturnType<typeof quota>>) {
  return new HttpError(429, `you have shared ${LINKS_PER_DAY} links today`, { code: "link_limit", reset_at: q.links_reset_at, limit: LINKS_PER_DAY });
}

async function getRow(env: Env, id: string) {
  return env.DB.prepare("SELECT * FROM films WHERE id = ?").bind(id).first<Row>();
}

async function ownerOf(req: Request, env: Env, id: string) {
  const row = await getRow(env, id);
  if (!row) throw new HttpError(404, "film not found");
  const token = (req.headers.get("authorization") ?? "").replace(/^Owner\s+/i, "");
  if (!token || !same(await sha256(token), row.owner_hash)) throw new HttpError(403, "this browser did not share that film");
  return row;
}

async function removeFilm(env: Env, id: string) {
  const listed = await env.MEDIA.list({ prefix: `media/${id}/` });
  if (listed.objects.length) await env.MEDIA.delete(listed.objects.map((o) => o.key));
  await env.DB.batch([env.DB.prepare("DELETE FROM films WHERE id = ?").bind(id), env.DB.prepare("DELETE FROM reports WHERE film_id = ?").bind(id)]);
}

async function share(req: Request, env: Env) {
  const body = (await req.json().catch(() => null)) as { film?: Record<string, unknown>; visibility?: string; turnstile?: string } | null;
  const f = body?.film;
  if (!f) throw new HttpError(400, "no film in the request");
  await verifyTurnstile(env, body?.turnstile, req);

  const ip = await ipHash(req, env);
  const t = now();
  const wantsLink = body?.visibility !== "public";
  const q = await quota(env, ip);
  if (q.busy) throw new HttpError(429, "Storycast has had a lot of shares today, please try again tomorrow", { code: "busy" });
  if (wantsLink && q.links_left <= 0) throw linkLimit(q);
  if (!wantsLink && q.explore_left <= 0) throw new HttpError(429, "you have sent a lot of stories to Explore today", { code: "explore_limit" });

  const video = falUrl(f.video);
  if (!video) throw new HttpError(400, "the film's video must be a fal media URL");
  const clean = falUrl(f.clean);
  const keyframeUrls = (Array.isArray(f.keyframes) ? f.keyframes : []).map(falUrl).filter((u): u is string => !!u).slice(0, 24);
  const posterUrl = falUrl(f.poster) ?? keyframeUrls[0] ?? null;
  const title = str(f.title, 160).trim();
  if (!title) throw new HttpError(400, "the film has no title");

  const id = randomId(10);
  const base = `media/${id}`;
  const lines = (Array.isArray(f.script) ? f.script : []).slice(0, 200).map((x) => str(x, 2000));
  let media: Media;
  let verdict: Verdict;
  try {
    const check = moderate(env, video, [posterUrl, ...keyframeUrls].filter((u): u is string => !!u), {
      title,
      subtitle: str(f.subtitle, 200),
      topic: str(f.topic, 600),
      narrator: str(f.narrator, 80),
      script: lines.join("\n").slice(0, 6000),
    });

    const videos = async () => {
      const film = await copy(env, video, `${base}/film`, "video", 160 * MB);
      return [film, clean ? await copy(env, clean, `${base}/clean`, "video", 160 * MB) : null] as const;
    };
    const [[v, c], p, k] = await Promise.all([
      videos(),
      posterUrl ? copy(env, posterUrl, `${base}/poster`, "image", 12 * MB) : Promise.resolve(null),
      pool(keyframeUrls, 3, (u, i) => copy(env, u, `${base}/kf-${String(i).padStart(2, "0")}`, "image", 12 * MB)),
    ]);
    media = { video: v, clean: c, poster: p, keyframes: k };
    verdict = await check;
  } catch (e) {
    await removeFilm(env, id).catch(() => {});
    throw e;
  }
  if (verdict.allowed !== null && verdict.allowed < REFUSE_BELOW) {
    await removeFilm(env, id).catch(() => {});
    throw new HttpError(422, "This story can't be shared on Storycast: it did not pass the safety check.", { code: "refused", reason: verdict.category });
  }

  const review = verdict.allowed === null || verdict.allowed < REVIEW_BELOW;
  const story: Story = {
    script: lines,
    kinds: (Array.isArray(f.kinds) ? f.kinds : []).slice(0, lines.length).map((k) => (k === "T" ? "T" : "V")),
    events: (Array.isArray(f.events) ? f.events : []).slice(0, 60).map((e) => {
      const ev = (e ?? {}) as Record<string, unknown>;
      return { t: num(ev.t), stage: str(ev.stage, 24), msg: str(ev.msg, 300) };
    }),
  };
  const owner = randomId(32);
  const status: Status = review ? "hidden" : wantsLink ? "unlisted" : "pending";
  const linked = wantsLink && !review;
  await env.DB.prepare(
    `INSERT INTO films (id, owner_hash, status, created, shared, title, subtitle, topic, lang, style, style_label, narrator, voice,
       character_id, minutes, duration, media, story, ip_hash, link_at, link_ip, flag, moderation, wants)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      await sha256(owner),
      status,
      Math.floor(num(f.created)) || t,
      t,
      title,
      str(f.subtitle, 200),
      str(f.topic, 600),
      str(f.lang, 12) || "en",
      str(f.style, 60),
      str(f.style_label, 80),
      str(f.narrator, 80),
      str(f.voice, 120),
      str(f.character_id, 60),
      num(f.minutes) || null,
      num(f.duration),
      JSON.stringify(media),
      JSON.stringify(story),
      ip,
      linked ? t : null,
      linked ? ip : "",
      review ? verdict.category || "unsure" : "",
      JSON.stringify(verdict),
      wantsLink ? "unlisted" : "public",
    )
    .run();
  const left = await quota(env, ip);
  return json({ id, owner, status, in_review: review, links_left: left.links_left }, req, env, 201);
}

async function report(req: Request, env: Env, id: string) {
  const row = await getRow(env, id);
  if (!row || row.status === "hidden") throw new HttpError(404, "film not found");
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const ip = await ipHash(req, env);
  const added = await env.DB.prepare("INSERT OR IGNORE INTO reports (film_id, ip_hash, reason, created) VALUES (?,?,?,?)")
    .bind(id, ip, str(body.reason, 500), now())
    .run();
  if (added.meta.changes) {
    await env.DB.prepare(
      "UPDATE films SET reports = reports + 1, status = CASE WHEN status = 'public' AND reports + 1 >= ? THEN 'pending' ELSE status END WHERE id = ?",
    )
      .bind(REPORTS_TO_REVIEW, id)
      .run();
  }
  return json({ ok: true }, req, env);
}

async function issue(req: Request, env: Env) {
  if (!Object.keys(cors(req, env)).length) throw new HttpError(403, "not allowed");
  const body = (await req.json().catch(() => ({}))) as { film?: unknown; kind?: unknown; note?: unknown; at?: unknown; title?: unknown; video?: unknown };
  const film = str(body.film, 16);
  const kind = str(body.kind, 16);
  if (!/^[A-Za-z0-9]{8,10}$/.test(film) || !ISSUE_KINDS.includes(kind)) throw new HttpError(400, "bad report");
  const at = num(body.at);
  const own = typeof body.video === "string" && body.video.startsWith(new URL(req.url).origin + "/m/") ? body.video.slice(0, 300) : "";
  const video = falUrl(body.video) ?? own;
  const ip = await ipHash(req, env);
  const t = now();
  const added = await env.DB.prepare(
    "INSERT INTO issues (film_id, kind, note, title, video, at, ip_hash, created) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM issues WHERE ip_hash = ? AND created > ?) < ?",
  )
    .bind(film, kind, str(body.note, 1000).trim(), str(body.title, 200), video, at > 0 ? Math.round(at * 10) / 10 : null, ip, t, ip, t - DAY, ISSUES_PER_DAY)
    .run();
  if (!added.meta.changes) throw new HttpError(429, "you have sent a lot of reports today");
  return json({ ok: true }, req, env, 201);
}

const statusCache = new Map<string, { status: Status | null; at: number }>();
async function filmStatus(env: Env, id: string) {
  const hit = statusCache.get(id);
  if (hit && Date.now() - hit.at < 30_000) return hit.status;
  const row = await env.DB.prepare("SELECT status FROM films WHERE id = ?").bind(id).first<{ status: Status }>();
  statusCache.set(id, { status: row?.status ?? null, at: Date.now() });
  if (statusCache.size > 5000) statusCache.clear();
  return row?.status ?? null;
}

async function serveMedia(req: Request, env: Env, ctx: ExecutionContext, key: string) {
  const id = key.split("/")[1];
  const status = await filmStatus(env, id);
  if (!status) return new Response("not found", { status: 404 });

  if (status !== "public" && status !== "unlisted" && !(await validSig(env, id, new URL(req.url).searchParams.get("s"))))
    return new Response("not found", { status: 404 });
  const cache = caches.default;
  const cacheKey = new URL(req.url).toString();
  if (req.method === "GET") {
    const range = req.headers.get("range");
    const hit = await cache.match(new Request(cacheKey, { headers: range ? { range } : {} }));
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set("access-control-allow-origin", "*");
      return res;
    }
  }
  const obj = await env.MEDIA.get(key, { range: req.headers, onlyIf: req.headers });
  if (!obj) return new Response("not found", { status: 404 });
  const headers = new Headers({ "access-control-allow-origin": "*", "accept-ranges": "bytes", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  if (req.method === "GET" && obj.size <= 200 * MB) {
    ctx.waitUntil(
      (async () => {
        const full = await env.MEDIA.get(key);
        if (!full) return;
        const h = new Headers({ "accept-ranges": "bytes", "content-length": String(full.size), "cache-control": "public, max-age=604800" });
        full.writeHttpMetadata(h);
        h.set("cache-control", "public, max-age=604800");
        h.set("etag", full.httpEtag);
        await cache.put(cacheKey, new Response(full.body, { headers: h }));
      })().catch(() => {}),
    );
  }
  const range = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && req.headers.has("range")) {
    const offset = range.suffix !== undefined ? obj.size - range.suffix : (range.offset ?? 0);
    const length = range.suffix !== undefined ? range.suffix : (range.length ?? obj.size - offset);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(req.method === "HEAD" ? null : obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(req.method === "HEAD" ? null : obj.body, { headers });
}

async function voices(req: Request, env: Env, path: string) {
  if (!Object.keys(cors(req, env)).length) throw new HttpError(403, "not allowed");
  const ip = await ipHash(req, env);
  if (env.VOICE_LIMIT && !(await env.VOICE_LIMIT.limit({ key: ip })).success) throw new HttpError(429, "too many requests, slow down");
  const url = new URL(req.url);
  const send = (data: unknown) => {
    const r = json(data, req, env);
    r.headers.set("cache-control", "private, max-age=300");
    return r;
  };
  const list = await loadVoices(env.MEDIA);
  if (path === "/api/voices") {
    const q = parseQuery(url.searchParams.get("q"));
    const page = Number(url.searchParams.get("page"));
    return send(searchList(list, q, page));
  }
  if (path === "/api/voices/facets") return send(listFacets(list));
  if (path === "/api/voices/check") {
    const id = str(url.searchParams.get("id"), 64);
    const name = str(url.searchParams.get("name"), 200);
    const lang = str(url.searchParams.get("lang"), 12) || "en";
    const language = str(url.searchParams.get("language"), 60) || "English";
    const voice = list.find((v) => (id ? v.voice_id === id : v.name === name)) ?? null;
    const ok = voice ? speaks(voice, lang, language) : true;
    const native = voice && !ok ? nativeVoice(list, lang, language, voice) : null;
    return send({ voice, speaks: ok, native });
  }
  throw new HttpError(404, "not found");
}

// ---------------------------------------------------------- story projects
// No-auth cloud save for image stories: D1 holds the project + scene text,
// R2 holds the files (display image, full-size image, narration audio).
// Ownership = random owner token, same pattern as films.

type StorySceneRow = {
  narration: string;
  imagePrompt: string;
  aiImagePrompt: string;
  imageSource: string;
  refScene: number | null;
  refScenes: number[] | null;
  audioSeconds: number | null;
  captions: { text: string; start: number; end: number }[] | null;
  image: string | null;
  imageLarge: string | null;
  audio: string | null;
  quality: string;
  voiceModel: string;
  video: string | null;
  videoRes: string;
  videoDur: number;
};

type StoryRow = {
  id: string;
  owner_hash: string;
  ip_hash: string;
  created: number;
  updated: number;
  title: string;
  subtitle: string;
  topic: string;
  style: string;
  style_label: string;
  lang: string;
  lang_name: string;
  voice: string;
  voice_style: string;
  scene_count: number;
  aspect: string;
  character_ref: string;
  poster_prompt: string;
  poster_h: string;
  poster_v: string;
  genre: string;
  music_title: string;
  music_url: string;
  scenes: string;
};

const STORIES_PER_DAY = 20;
const STORY_MEDIA_MAX = 8 * MB;
/** Scene videos (mp4) run much larger than images/audio — own ceiling. Binary streaming keeps CPU near zero. */
const STORY_VIDEO_MAX = 64 * MB;
const STORY_MEDIA_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
};
const STORY_MEDIA_FIELDS: Record<string, "image" | "imageLarge" | "audio" | "video" | "music"> = {
  image: "image",
  "image-large": "imageLarge",
  audio: "audio",
  video: "video",
  music: "music",
};

function storyUrl(req: Request, key: string | null, v?: number) {
  return key ? `${new URL(req.url).origin}/s/${key}${v ? `?v=${v}` : ""}` : null;
}

/** Write one scene media reference with optimistic concurrency (see storyMedia). */
async function commitSceneKey(env: Env, id: string, scene: number, field: "image" | "imageLarge" | "audio" | "video", key: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const fresh = await env.DB.prepare("SELECT * FROM story_projects WHERE id = ?").bind(id).first<StoryRow>();
    if (!fresh) throw new HttpError(404, "story not found");
    const scenes = readScenes(fresh);
    if (scene >= scenes.length) throw new HttpError(400, "bad media upload");
    scenes[scene][field] = key;
    const t = now();
    const res = await env.DB.prepare("UPDATE story_projects SET updated = ?, scene_count = ?, scenes = ? WHERE id = ? AND updated = ?")
      .bind(t, scenes.length, JSON.stringify(scenes), id, fresh.updated)
      .run();
    if ((res.meta.changes ?? 0) > 0) return t;
    await new Promise((r) => setTimeout(r, 150 * (attempt + 1) + Math.random() * 150));
  }
  throw new HttpError(409, "concurrent update — please retry the upload");
}

/** Remove sibling files after a deterministic put (legacy stamped versions, other exts). */
async function cleanSiblings(env: Env, id: string, prefix: string, keep: string) {
  const stale = await env.MEDIA.list({ prefix: `stories/${id}/${prefix}`, limit: 100 });
  const others = stale.objects.map((o) => o.key).filter((k) => k !== keep);
  if (others.length) await env.MEDIA.delete(others);
}

function parseScenes(v: unknown, max = 40): StorySceneRow[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, max).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const rawRef = o.refScene;
    const rawRefs = Array.isArray(o.refScenes) ? (o.refScenes as unknown[]) : null;
    const listRefs = rawRefs
      ? rawRefs.filter((k) => Number.isInteger(k) && (k as number) >= 0).slice(0, 8) as number[]
      : null;
    return {
      narration: str(o.narration, 1200),
      imagePrompt: str(o.imagePrompt ?? o.moment, 800),
      aiImagePrompt: str(o.aiImagePrompt ?? o.depiction, 1000),
      imageSource: o.imageSource === "ai" ? "ai" : "moment",
      refScene: Number.isInteger(rawRef) && (rawRef as number) >= 0 ? (rawRef as number) : null,
      refScenes: listRefs && listRefs.length ? listRefs : null,
      audioSeconds: num(o.audioSeconds) > 0 ? Math.round(num(o.audioSeconds) * 10) / 10 : null,
      captions: Array.isArray(o.captions)
        ? (o.captions as unknown[])
            .filter((w) => w && typeof (w as Record<string, unknown>).text === "string" && String((w as Record<string, unknown>).text).trim())
            .slice(0, 400)
            .map((w) => {
              const c = w as Record<string, unknown>;
              return { text: String(c.text).trim().slice(0, 60), start: num(c.start) || 0, end: num(c.end) || 0 };
            })
        : null,
      quality: ["512px", "1K", "2K", "4K"].includes(str(o.quality, 8)) ? str(o.quality, 8) : "2K",
      voiceModel: ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"].includes(str(o.voiceModel, 40))
        ? str(o.voiceModel, 40)
        : "gemini-3.8-flash-tts",
      video: null,
      videoRes: ["360p", "720p", "1080p"].includes(str(o.videoRes, 8)) ? str(o.videoRes, 8) : "360p",
      videoDur: [3, 5, 8, 10].includes(num(o.videoDur)) ? Math.floor(num(o.videoDur)) : 3,
      image: null,
      imageLarge: null,
      audio: null,
    };
  });
}

function readScenes(row: StoryRow): StorySceneRow[] {
  try {
    const arr = JSON.parse(row.scenes) as StorySceneRow[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function toStoryList(req: Request, row: StoryRow) {
  const scenes = readScenes(row);
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    topic: row.topic,
    style_label: row.style_label,
    lang: row.lang,
    voice: row.voice,
    aspect: row.aspect,
    scene_count: scenes.length,
    images: scenes.filter((s) => s.image).length,
    audios: scenes.filter((s) => s.audio).length,
    duration: Math.round(scenes.reduce((a, s) => a + (s.audioSeconds ?? 0), 0) * 10) / 10,
    created: row.created,
    updated: row.updated,
    thumb: storyUrl(req, row.poster_h || scenes.find((s) => s.image)?.image || null, row.updated),
  };
}

function toStoryFull(req: Request, row: StoryRow) {
  const scenes = readScenes(row);
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    topic: row.topic,
    style: row.style,
    style_label: row.style_label,
    lang: row.lang,
    lang_name: row.lang_name,
    voice: row.voice,
    voice_style: row.voice_style,
    scene_count: row.scene_count,
    aspect: row.aspect,
    character_ref: row.character_ref,
    poster_prompt: row.poster_prompt,
    poster_h: storyUrl(req, row.poster_h || null, row.updated),
    poster_v: storyUrl(req, row.poster_v || null, row.updated),
    genre: row.genre || "edukasi",
    music_title: row.music_title,
    music_url: storyUrl(req, row.music_url || null, row.updated),
    created: row.created,
    updated: row.updated,
    scenes: scenes.map((s, i) => ({
      index: i,
      narration: s.narration,
      imagePrompt: s.imagePrompt,
      aiImagePrompt: s.aiImagePrompt,
      imageSource: s.imageSource,
      refScene: s.refScene,
      refScenes: s.refScenes,
      audioSeconds: s.audioSeconds,
      captions: s.captions,
      quality: s.quality,
      voiceModel: s.voiceModel,
      video: storyUrl(req, s.video, row.updated),
      videoRes: s.videoRes,
      videoDur: s.videoDur,
      image: storyUrl(req, s.image, row.updated),
      imageLarge: storyUrl(req, s.imageLarge, row.updated),
      audio: storyUrl(req, s.audio, row.updated),
    })),
  };
}

async function storyOwner(req: Request, env: Env, id: string) {
  const row = await env.DB.prepare("SELECT * FROM story_projects WHERE id = ?").bind(id).first<StoryRow>();
  if (!row) throw new HttpError(404, "story not found");
  const token = (req.headers.get("authorization") ?? "").replace(/^Owner\s+/i, "");
  if (!token || !same(await sha256(token), row.owner_hash)) throw new HttpError(403, "this browser did not create that story");
  return row;
}

async function createStory(req: Request, env: Env) {
  const body = (await req.json().catch(() => null)) as { id?: unknown; project?: Record<string, unknown> } | null;
  const p = body?.project;
  if (!p) throw new HttpError(400, "no story in the request");
  const ip = await ipHash(req, env);
  const t = now();
  const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM story_projects WHERE ip_hash = ? AND created > ?")
    .bind(ip, t - DAY)
    .first<{ n: number }>();
  if ((used?.n ?? 0) >= STORIES_PER_DAY) throw new HttpError(429, "you have created a lot of stories today");

  let id = /^[A-Za-z0-9]{8,12}$/.test(str(body.id, 12)) ? str(body.id, 12) : randomId(10);
  if (await env.DB.prepare("SELECT id FROM story_projects WHERE id = ?").bind(id).first()) id = randomId(10);
  const scenes = parseScenes(p.scenes);
  const owner = randomId(32);
  await env.DB.prepare(
    `INSERT INTO story_projects (id, owner_hash, ip_hash, created, updated, title, subtitle, topic, style, style_label,
      lang, lang_name, voice, voice_style, scene_count, aspect, character_ref, poster_prompt, genre, music_title, scenes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      await sha256(owner),
      ip,
      t,
      t,
      str(p.title, 120),
      str(p.subtitle, 160),
      str(p.topic, 600),
      str(p.style, 60),
      str(p.styleLabel ?? p.style_label, 80),
      str(p.lang, 12) || "id",
      str(p.langName ?? p.lang_name, 60),
      str(p.voice, 60),
      str(p.voiceStyle ?? p.voice_style, 300),
      scenes.length,
      ["16:9", "9:16", "1:1", "4:3", "21:9"].includes(str(p.aspect, 8)) ? str(p.aspect, 8) : "16:9",
      str(p.characterRef, 500).startsWith("data:") ? "" : str(p.characterRef, 500),
      str(p.posterPrompt ?? p.poster_prompt, 800),
      str(p.genre, 40) || "edukasi",
      str(p.musicTitle ?? p.music_title, 160),
      JSON.stringify(scenes),
    )
    .run();
  return json({ id, owner }, req, env, 201);
}

async function patchStory(req: Request, env: Env, id: string) {
  const row = await storyOwner(req, env, id);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const next = parseScenes(body.scenes, 40);
  for (let attempt = 0; attempt < 10; attempt++) {
    const fresh = await env.DB.prepare("SELECT * FROM story_projects WHERE id = ?").bind(id).first<StoryRow>();
    if (!fresh) throw new HttpError(404, "story not found");
    const prev = readScenes(fresh);
    // Preserve R2 keys by index — media is managed via /media only.
    const merged = next.map((s, i) => ({ ...s, image: prev[i]?.image ?? null, imageLarge: prev[i]?.imageLarge ?? null, audio: prev[i]?.audio ?? null, video: (prev[i] as StorySceneRow | undefined)?.video ?? null }));
    const res = await env.DB.prepare(
      `UPDATE story_projects SET updated = ?, title = ?, subtitle = ?, voice = ?, voice_style = ?, scene_count = ?, poster_prompt = ?, genre = ?, music_title = ?, scenes = ? WHERE id = ? AND updated = ?`,
    )
      .bind(
        now(),
        body.title === undefined ? fresh.title : str(body.title, 120),
        body.subtitle === undefined ? fresh.subtitle : str(body.subtitle, 160),
        body.voice === undefined ? fresh.voice : str(body.voice, 60),
        body.voiceStyle === undefined ? fresh.voice_style : str(body.voiceStyle, 300),
        merged.length,
        body.posterPrompt === undefined ? fresh.poster_prompt : str(body.posterPrompt, 800),
        body.genre === undefined ? fresh.genre : str(body.genre, 40) || "edukasi",
        body.musicTitle === undefined ? fresh.music_title : str(body.musicTitle, 160),
        JSON.stringify(merged),
        id,
        fresh.updated,
      )
      .run();
    if ((res.meta.changes ?? 0) > 0) return json({ id, updated: now() }, req, env);
    await new Promise((r) => setTimeout(r, 150 * (attempt + 1) + Math.random() * 150));
  }
  throw new HttpError(409, "concurrent update — please retry");
}

async function storyPoster(req: Request, env: Env, id: string) {
  await storyOwner(req, env, id);
  const ctype = req.headers.get("content-type") || "";
  if (!ctype.includes("application/json")) {
    const q = new URL(req.url).searchParams;
    const which = str(q.get("which"), 8);
    if (which !== "h" && which !== "v") throw new HttpError(400, "which must be h or v");
    const mime = ctype.split(";")[0].trim().toLowerCase();
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime) || !req.body) throw new HttpError(400, "bad poster upload");
    const key = `stories/${id}/poster-${which}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`;
    await env.MEDIA.put(key, req.body, { httpMetadata: { contentType: mime, cacheControl: "public, max-age=31536000, immutable" } });
    await cleanSiblings(env, id, `poster-${which}`, key);
    const col = which === "h" ? "poster_h" : "poster_v";
    const t = now();
    await env.DB.prepare(`UPDATE story_projects SET updated = ?, ${col} = ? WHERE id = ?`).bind(t, key, id).run();
    return json({ url: storyUrl(req, key, t), which }, req, env, 201);
  }
  const body = (await req.json().catch(() => ({}))) as { which?: unknown; contentType?: unknown; data?: unknown };
  const which = str(body.which, 8);
  if (which !== "h" && which !== "v") throw new HttpError(400, "which must be h or v");
  const mime = str(body.contentType, 40).toLowerCase();
  const data = typeof body.data === "string" ? body.data : "";
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime) || !data.startsWith("data:")) throw new HttpError(400, "bad poster upload");
  const bytes = Math.floor((data.length - data.indexOf(",") - 1) * 0.75);
  if (bytes <= 0 || bytes > STORY_MEDIA_MAX) throw new HttpError(413, "the file is too large");
  const bin = Uint8Array.from(atob(data.slice(data.indexOf(",") + 1)), (c) => c.charCodeAt(0));
  const key = `stories/${id}/poster-${which}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`;
  await env.MEDIA.put(key, bin, { httpMetadata: { contentType: mime, cacheControl: "public, max-age=31536000, immutable" } });
  await cleanSiblings(env, id, `poster-${which}`, key);
  const col = which === "h" ? "poster_h" : "poster_v";
  const t = now();
  await env.DB.prepare(`UPDATE story_projects SET updated = ?, ${col} = ? WHERE id = ?`).bind(t, key, id).run();
  return json({ url: storyUrl(req, key, t), which }, req, env, 201);
}

async function storyMedia(req: Request, env: Env, id: string) {
  const row = await storyOwner(req, env, id);
  const ctype = req.headers.get("content-type") || "";
  // Binary mode (used by all media uploads): raw bytes in the body, metadata in the
  // query. Streams straight into R2 — no base64, no giant JSON parse, so no
  // CPU-limit 503 on images, audio, music, or videos.
  if (!ctype.includes("application/json")) {
    const q = new URL(req.url).searchParams;
    const scene = Math.floor(num(q.get("scene")));
    const kind = str(q.get("kind"), 16);
    const field = STORY_MEDIA_FIELDS[kind];
    const mime = ctype.split(";")[0].trim().toLowerCase();
    if (kind === "music") {
      const ext = mime === "audio/mpeg" ? "mp3" : mime === "audio/wav" || mime === "audio/x-wav" ? "wav" : mime === "audio/mp4" || mime === "audio/x-m4a" || mime === "audio/aac" ? "m4a" : "";
      if (!ext || !req.body) throw new HttpError(400, "bad music upload");
      const key = `stories/${id}/music.${ext}`;
      await env.MEDIA.put(key, req.body, { httpMetadata: { contentType: mime, cacheControl: "public, max-age=31536000, immutable" } });
      await cleanSiblings(env, id, "music", key);
      const t = now();
      await env.DB.prepare("UPDATE story_projects SET updated = ?, music_url = ? WHERE id = ?").bind(t, key, id).run();
      return json({ url: storyUrl(req, key, t), kind }, req, env, 201);
    }
    const type = STORY_MEDIA_TYPES[mime];
    const scenes = readScenes(row);
    if (!field || field === "music" || !type || scene < 0 || scene >= scenes.length) throw new HttpError(400, "bad media upload");
    const len = Number(req.headers.get("content-length"));
    const cap = kind === "video" ? STORY_VIDEO_MAX : STORY_MEDIA_MAX;
    if (len > cap) throw new HttpError(413, `the file is too large (max ${cap / MB}MB)`);
    if (!req.body) throw new HttpError(400, "empty body");
    const nn = String(scene).padStart(2, "0");
    const key = `stories/${id}/${kind}-${nn}.${type}`;
    await env.MEDIA.put(key, req.body, { httpMetadata: { contentType: mime, cacheControl: "public, max-age=31536000, immutable" } });
    await cleanSiblings(env, id, `${kind}-${nn}`, key);
    const t = await commitSceneKey(env, id, scene, field as "image" | "imageLarge" | "audio" | "video", key);
    return json({ url: storyUrl(req, key, t), scene, kind }, req, env, 201);
  }
  const body = (await req.json().catch(() => ({}))) as { scene?: unknown; kind?: unknown; contentType?: unknown; data?: unknown };
  const scene = Math.floor(num(body.scene));
  const field = STORY_MEDIA_FIELDS[str(body.kind, 16)];
  const type = STORY_MEDIA_TYPES[str(body.contentType, 40).toLowerCase()];
  const data = typeof body.data === "string" ? body.data : "";
  const scenes = readScenes(row);
  const kind = str(body.kind, 16);
  if (kind === "music") {
    // Project-level background track (no scene). Replaces any previous one.
    const mime = str(body.contentType, 40).toLowerCase();
    const ext = mime === "audio/mpeg" ? "mp3" : mime === "audio/wav" || mime === "audio/x-wav" ? "wav" : mime === "audio/mp4" || mime === "audio/x-m4a" || mime === "audio/aac" ? "m4a" : "";
    const data = typeof body.data === "string" ? body.data : "";
    if (!ext || !data.startsWith("data:")) throw new HttpError(400, "bad music upload");
    const bytes = Math.floor((data.length - data.indexOf(",") - 1) * 0.75);
    if (bytes <= 0 || bytes > STORY_MEDIA_MAX) throw new HttpError(413, "the file is too large");
    const bin = Uint8Array.from(atob(data.slice(data.indexOf(",") + 1)), (c) => c.charCodeAt(0));
    const key = `stories/${id}/music.${ext}`;
    await env.MEDIA.put(key, bin, { httpMetadata: { contentType: mime, cacheControl: "public, max-age=31536000, immutable" } });
    await cleanSiblings(env, id, "music", key);
    const t = now();
    await env.DB.prepare("UPDATE story_projects SET updated = ?, music_url = ? WHERE id = ?").bind(t, key, id).run();
    return json({ url: storyUrl(req, key, t), kind }, req, env, 201);
  }
  if (!field || !type || !data.startsWith("data:") || scene < 0 || scene >= scenes.length) throw new HttpError(400, "bad media upload");
  const bytes = Math.floor((data.length - data.indexOf(",") - 1) * 0.75);
  const cap = kind === "video" ? STORY_VIDEO_MAX : STORY_MEDIA_MAX;
  if (bytes <= 0 || bytes > cap) throw new HttpError(413, `the file is too large (max ${cap / MB}MB)`);
  const bin = Uint8Array.from(atob(data.slice(data.indexOf(",") + 1)), (c) => c.charCodeAt(0));
  const nn = String(scene).padStart(2, "0");
  const key = `stories/${id}/${kind}-${nn}.${type}`;
  await env.MEDIA.put(key, bin, { httpMetadata: { contentType: str(body.contentType, 40).toLowerCase(), cacheControl: "public, max-age=31536000, immutable" } });
  await cleanSiblings(env, id, `${kind}-${nn}`, key);
  const t = await commitSceneKey(env, id, scene, field as "image" | "imageLarge" | "audio" | "video", key);
  return json({ url: storyUrl(req, key, t), scene, kind }, req, env, 201);
}

const ADOPT_EXTS: Record<string, string[]> = {
  image: ["jpg", "png", "webp"],
  "image-large": ["jpg", "png", "webp"],
  audio: ["wav", "mp3"],
  video: ["mp4", "webm"],
};

/**
 * Re-link a file that reached R2 but whose DB reference was lost (refresh
 * during upload, crashed tab). Deterministic keys make the file findable.
 */
async function adoptMedia(req: Request, env: Env, id: string) {
  const row = await storyOwner(req, env, id);
  const body = (await req.json().catch(() => ({}))) as { scene?: unknown; kind?: unknown };
  const scene = Math.floor(num(body.scene));
  const kind = str(body.kind, 16);
  const field = STORY_MEDIA_FIELDS[kind];
  const exts = ADOPT_EXTS[kind];
  const scenes = readScenes(row);
  if (!field || !exts || field === "music" || scene < 0 || scene >= scenes.length) throw new HttpError(400, "bad adopt request");
  if (scenes[scene][field as "image" | "imageLarge" | "audio" | "video"]) return json({ url: storyUrl(req, scenes[scene][field as "image" | "imageLarge" | "audio" | "video"], row.updated), scene, kind, adopted: false }, req, env);
  const nn = String(scene).padStart(2, "0");
  for (const ext of exts) {
    const key = `stories/${id}/${kind}-${nn}.${ext}`;
    if (await env.MEDIA.head(key)) {
      const t = await commitSceneKey(env, id, scene, field as "image" | "imageLarge" | "audio" | "video", key);
      return json({ url: storyUrl(req, key, t), scene, kind, adopted: true }, req, env);
    }
  }
  // Legacy fallback: pre-deterministic stamped files ({kind}-{nn}-{stamp}.ext).
  const legacy = await env.MEDIA.list({ prefix: `stories/${id}/${kind}-${nn}-`, limit: 20 });
  const cands = legacy.objects.map((o) => o.key).filter((k) => /\.(mp4|webm|wav|mp3|jpg|png|webp)$/i.test(k)).sort();
  if (cands.length) {
    const key = cands[cands.length - 1];
    const t = await commitSceneKey(env, id, scene, field as "image" | "imageLarge" | "audio" | "video", key);
    return json({ url: storyUrl(req, key, t), scene, kind, adopted: true }, req, env);
  }
  throw new HttpError(404, "no saved file for that scene");
}

async function deleteStory(req: Request, env: Env, id: string) {
  await storyOwner(req, env, id);
  const listed = await env.MEDIA.list({ prefix: `stories/${id}/` });
  if (listed.objects.length) await env.MEDIA.delete(listed.objects.map((o) => o.key));
  await env.DB.prepare("DELETE FROM story_projects WHERE id = ?").bind(id).run();
  return json({ ok: true }, req, env);
}

async function serveStoryMedia(req: Request, env: Env, key: string) {
  const obj = await env.MEDIA.get(key, { range: req.headers, onlyIf: req.headers });
  if (!obj) return new Response("not found", { status: 404 });
  const headers = new Headers({
    "access-control-allow-origin": "*",
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
    "cache-control": "public, max-age=31536000, immutable",
  });
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  const range = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && req.headers.has("range")) {
    const offset = range.suffix !== undefined ? obj.size - range.suffix : (range.offset ?? 0);
    const length = range.suffix !== undefined ? range.suffix : (range.length ?? obj.size - offset);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(req.method === "HEAD" ? null : obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(req.method === "HEAD" ? null : obj.body, { headers });
}

// ---------------------------------------------------------- characters
// Global catalog, no auth. Images live in R2 (characters/{id}/{kind}.ext).

type CharacterRow = {
  id: string;
  name: string;
  personality: string;
  group_name: string;
  style: string;
  style_label: string;
  traits: string;
  pronoun: string;
  voice_id: string;
  voice_name: string;
  voice_gender: string;
  voice_age: string;
  voice_accent: string;
  voice_desc: string;
  thumb: string;
  hero: string;
  sheet: string;
  sort: number;
  created: number;
  updated: number;
};

const CHARACTER_IMG_KINDS = ["thumb", "hero", "sheet"] as const;

function charUrl(req: Request, key: string | null) {
  return key ? `${new URL(req.url).origin}/s/${key}` : "";
}

function toCharacter(req: Request, row: CharacterRow) {
  return {
    id: row.id,
    name: row.name,
    personality: row.personality,
    group: row.group_name,
    style: row.style,
    style_label: row.style_label,
    traits: row.traits,
    pronoun: row.pronoun,
    voice: {
      voice_id: row.voice_id,
      name: row.voice_name,
      gender: row.voice_gender,
      age: row.voice_age,
      accent: row.voice_accent,
      description: row.voice_desc,
    },
    thumb: charUrl(req, row.thumb),
    hero: charUrl(req, row.hero),
    sheet: charUrl(req, row.sheet),
    created: row.created,
    updated: row.updated,
  };
}

function charId(v: unknown, fallback: string) {
  const s = str(v, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || fallback;
}

async function createCharacter(req: Request, env: Env) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = str(body.name, 80).trim();
  if (!name) throw new HttpError(400, "the character needs a name");
  let id = charId(body.id, randomId(8));
  if (await env.DB.prepare("SELECT id FROM characters WHERE id = ?").bind(id).first()) id = `${id}-${randomId(4)}`.slice(0, 40);
  const t = now();
  const voice = (body.voice ?? {}) as Record<string, unknown>;
  await env.DB.prepare(
    `INSERT INTO characters (id, name, personality, group_name, style, style_label, traits, pronoun,
      voice_id, voice_name, voice_gender, voice_age, voice_accent, voice_desc, sort, created, updated)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id, name, str(body.personality, 500), str(body.group, 60), str(body.style, 60), str(body.styleLabel ?? body.style_label, 80),
      str(body.traits, 600), ["his", "her", "its"].includes(str(body.pronoun, 8)) ? str(body.pronoun, 8) : "its",
      str(voice.voice_id, 80), str(voice.name, 160), str(voice.gender, 24), str(voice.age, 24), str(voice.accent, 40), str(voice.description, 600),
      Math.floor(num((body as Record<string, unknown>).sort)), t, t,
    )
    .run();
  const row = await env.DB.prepare("SELECT * FROM characters WHERE id = ?").bind(id).first<CharacterRow>();
  return json({ character: row ? toCharacter(req, row) : { id } }, req, env, 201);
}

async function patchCharacter(req: Request, env: Env, id: string) {
  const row = await env.DB.prepare("SELECT * FROM characters WHERE id = ?").bind(id).first<CharacterRow>();
  if (!row) throw new HttpError(404, "character not found");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const voice = (body.voice ?? {}) as Record<string, unknown>;
  await env.DB.prepare(
    `UPDATE characters SET name = ?, personality = ?, group_name = ?, style = ?, style_label = ?, traits = ?, pronoun = ?,
      voice_id = ?, voice_name = ?, voice_gender = ?, voice_age = ?, voice_accent = ?, voice_desc = ?, sort = ?, updated = ? WHERE id = ?`,
  )
    .bind(
      body.name === undefined ? row.name : str(body.name, 80).trim() || row.name,
      body.personality === undefined ? row.personality : str(body.personality, 500),
      body.group === undefined ? row.group_name : str(body.group, 60),
      body.style === undefined ? row.style : str(body.style, 60),
      body.styleLabel === undefined && body.style_label === undefined ? row.style_label : str(body.styleLabel ?? body.style_label, 80),
      body.traits === undefined ? row.traits : str(body.traits, 600),
      body.pronoun === undefined ? row.pronoun : (["his", "her", "its"].includes(str(body.pronoun, 8)) ? str(body.pronoun, 8) : row.pronoun),
      voice.voice_id === undefined ? row.voice_id : str(voice.voice_id, 80),
      voice.name === undefined ? row.voice_name : str(voice.name, 160),
      voice.gender === undefined ? row.voice_gender : str(voice.gender, 24),
      voice.age === undefined ? row.voice_age : str(voice.age, 24),
      voice.accent === undefined ? row.voice_accent : str(voice.accent, 40),
      voice.description === undefined ? row.voice_desc : str(voice.description, 600),
      body.sort === undefined ? row.sort : Math.floor(num(body.sort)),
      now(), id,
    )
    .run();
  const updated = await env.DB.prepare("SELECT * FROM characters WHERE id = ?").bind(id).first<CharacterRow>();
  return json({ character: updated ? toCharacter(req, updated) : { id } }, req, env);
}

async function deleteCharacter(req: Request, env: Env, id: string) {
  const row = await env.DB.prepare("SELECT * FROM characters WHERE id = ?").bind(id).first<CharacterRow>();
  if (!row) throw new HttpError(404, "character not found");
  const listed = await env.MEDIA.list({ prefix: `characters/${id}/` });
  if (listed.objects.length) await env.MEDIA.delete(listed.objects.map((o) => o.key));
  await env.DB.prepare("DELETE FROM characters WHERE id = ?").bind(id).run();
  return json({ ok: true }, req, env);
}

async function characterImage(req: Request, env: Env, id: string) {
  const row = await env.DB.prepare("SELECT * FROM characters WHERE id = ?").bind(id).first<CharacterRow>();
  if (!row) throw new HttpError(404, "character not found");
  const body = (await req.json().catch(() => ({}))) as { kind?: unknown; url?: unknown; contentType?: unknown; data?: unknown };
  const kind = str(body.kind, 16);
  if (!CHARACTER_IMG_KINDS.includes(kind as (typeof CHARACTER_IMG_KINDS)[number])) throw new HttpError(400, "kind must be thumb, hero or sheet");
  let bytes: Uint8Array;
  let type: string;
  if (typeof body.url === "string" && /^https?:\/\//.test(body.url)) {
    // Server-side import: no browser CORS involved.
    const r = await fetch(body.url.slice(0, 1000), { headers: { "accept-encoding": "identity" } });
    if (!r.ok) throw new HttpError(422, `could not fetch the image (${r.status})`);
    type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!["image/png", "image/jpeg", "image/webp"].includes(type)) throw new HttpError(422, "that file is not a supported image");
    const buf = await r.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > STORY_MEDIA_MAX) throw new HttpError(413, "the image is too large");
    bytes = new Uint8Array(buf);
  } else {
    const data = typeof body.data === "string" ? body.data : "";
    type = STORY_MEDIA_TYPES[str(body.contentType, 40).toLowerCase()] ? str(body.contentType, 40).toLowerCase() : "";
    if (!data.startsWith("data:") || !type.startsWith("image/")) throw new HttpError(400, "bad image upload");
    const size = Math.floor((data.length - data.indexOf(",") - 1) * 0.75);
    if (size <= 0 || size > STORY_MEDIA_MAX) throw new HttpError(413, "the image is too large");
    bytes = Uint8Array.from(atob(data.slice(data.indexOf(",") + 1)), (c) => c.charCodeAt(0));
  }
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const key = `characters/${id}/${kind}.${ext}`;
  // Remove a stale sibling with another extension first.
  const listed = await env.MEDIA.list({ prefix: `characters/${id}/${kind}.` });
  if (listed.objects.length) await env.MEDIA.delete(listed.objects.map((o) => o.key));
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  const col = kind === "thumb" ? "thumb" : kind === "hero" ? "hero" : "sheet";
  await env.DB.prepare(`UPDATE characters SET ${col} = ?, updated = ? WHERE id = ?`).bind(key, now(), id).run();
  return json({ url: charUrl(req, key), kind }, req, env, 201);
}

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {  const url = new URL(req.url);
  const path = url.pathname;
  const m = req.method;

  if (m === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, env) });
  if ((m === "GET" || m === "HEAD") && path.startsWith("/m/media/")) return serveMedia(req, env, ctx, decodeURIComponent(path.slice(3)));
  // Public R2 surfaces only: stories/ + characters/ + styles/. Never private/ (voices catalog).
  if ((m === "GET" || m === "HEAD") && (path.startsWith("/s/stories/") || path.startsWith("/s/characters/") || path.startsWith("/s/styles/")))
    return serveStoryMedia(req, env, decodeURIComponent(path.slice(3)));

  if (path === "/api/gemini-token" && (m === "GET" || m === "POST")) {
    if (!Object.keys(cors(req, env)).length) throw new HttpError(403, "not allowed");
    if (m === "POST") {
      const body = (await req.json().catch(() => ({}))) as { brokenAccountId?: string };
      if (typeof body.brokenAccountId === "string" && body.brokenAccountId) {
        shareTokenCache.delete(body.brokenAccountId);
        shareCooldown.set(body.brokenAccountId, Date.now() + 60_000);
      }
    }
    const res = await getShareGeminiToken(env);
    return json(res, req, env);
  }
  if (path === "/api/stories" && m === "POST") return createStory(req, env);
  if (path === "/api/characters" && m === "POST") return createCharacter(req, env);
  if (path === "/api/characters" && m === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM characters ORDER BY sort ASC, updated DESC LIMIT 200").all<CharacterRow>();
    return json({ characters: rows.results.map((r) => toCharacter(req, r)) }, req, env);
  }
  const character = path.match(/^\/api\/characters\/([A-Za-z0-9-]{1,40})(\/images)?$/);
  if (character) {
    const [, id, images] = character;
    if (images && m === "POST") return characterImage(req, env, id);
    if (!images && m === "PATCH") return patchCharacter(req, env, id);
    if (!images && m === "DELETE") return deleteCharacter(req, env, id);
    if (!images && m === "GET") {
      const row = await env.DB.prepare("SELECT * FROM characters WHERE id = ?").bind(id).first<CharacterRow>();
      if (!row) throw new HttpError(404, "character not found");
      return json({ character: toCharacter(req, row) }, req, env);
    }
  }
  if (path === "/api/stories" && m === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM story_projects ORDER BY updated DESC LIMIT 100").all<StoryRow>();
    return json({ stories: rows.results.map((r) => toStoryList(req, r)) }, req, env);
  }
  const story = path.match(/^\/api\/stories\/([A-Za-z0-9]{8,12})(\/media|\/poster|\/adopt)?$/);
  if (story) {
    const [, id, sub] = story;
    if (sub === "/media" && m === "POST") return storyMedia(req, env, id);
    if (sub === "/poster" && m === "POST") return storyPoster(req, env, id);
    if (sub === "/adopt" && m === "POST") return adoptMedia(req, env, id);
    if (!sub && m === "GET") {
      const row = await env.DB.prepare("SELECT * FROM story_projects WHERE id = ?").bind(id).first<StoryRow>();
      if (!row) throw new HttpError(404, "story not found");
      return json({ story: toStoryFull(req, row) }, req, env);
    }
    if (!sub && m === "PATCH") return patchStory(req, env, id);
    if (!sub && m === "DELETE") return deleteStory(req, env, id);
  }

  if (path === "/api/share" && m === "POST") return share(req, env);
  if (path === "/api/issues" && m === "POST") return issue(req, env);
  if (path.startsWith("/api/voices") && m === "GET") return voices(req, env, path);
  if (path === "/api/quota" && m === "GET") {
    const q = await quota(env, await ipHash(req, env));
    return json({ ...q, links_per_day: LINKS_PER_DAY }, req, env);
  }

  if (path === "/api/films" && m === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM films WHERE status = 'public' ORDER BY shared DESC LIMIT 500").all<Row>();
    return json({ films: rows.results.map((r) => toFilm(req, r, false)) }, req, env);
  }

  const film = path.match(/^\/api\/films\/([A-Za-z0-9]{10})(\/report|\/view)?$/);
  if (film) {
    const [, id, action] = film;
    if (action === "/report" && m === "POST") return report(req, env, id);
    if (action === "/view" && m === "POST") {
      await env.DB.prepare("UPDATE films SET views = views + 1 WHERE id = ? AND status != 'hidden'").bind(id).run();
      return json({ ok: true }, req, env);
    }
    if (!action && m === "GET") {
      const row = await getRow(env, id);
      if (!row) throw new HttpError(404, "film not found");
      if (row.status === "public" || row.status === "unlisted") return json({ film: toFilm(req, row, true) }, req, env);

      const token = (req.headers.get("authorization") ?? "").replace(/^Owner\s+/i, "");
      if (token && same(await sha256(token), row.owner_hash)) return json({ film: toFilm(req, row, true, await mediaSig(env, id)) }, req, env);
      if (row.status === "pending" || row.flag) throw new HttpError(403, "this story is waiting for review", { code: "in_review" });
      throw new HttpError(404, "film not found");
    }
    if (!action && m === "PATCH") {
      const row = await ownerOf(req, env, id);
      const body = (await req.json().catch(() => ({}))) as { visibility?: string };
      if (row.status === "hidden") throw new HttpError(403, row.flag ? "this story is waiting for a manual review" : "this film was taken down");
      if (body.visibility === "public") {
        const status: Status = row.status === "public" ? "public" : "pending";
        await env.DB.prepare("UPDATE films SET status = ? WHERE id = ?").bind(status, id).run();
        return json({ id, status }, req, env);
      }

      if (row.link_at === null) {
        const ip = await ipHash(req, env);
        const q = await quota(env, ip);
        if (q.links_left <= 0) throw linkLimit(q);
        await env.DB.prepare("UPDATE films SET status = 'unlisted', link_at = ?, link_ip = ? WHERE id = ?").bind(now(), ip, id).run();
      } else await env.DB.prepare("UPDATE films SET status = 'unlisted' WHERE id = ?").bind(id).run();
      return json({ id, status: "unlisted" }, req, env);
    }
    if (!action && m === "DELETE") {
      await ownerOf(req, env, id);
      await removeFilm(env, id);
      return json({ ok: true }, req, env);
    }
  }

  if (env.ASSETS) return env.ASSETS.fetch(req);
  if (path === "/" && m === "GET") return new Response("Storycast API", { headers: { "content-type": "text/plain" } });
  throw new HttpError(404, "not found");
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(req, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, req, env, e.status);
      console.error(e);
      return json({ error: "something went wrong" }, req, env, 500);
    }
  },
} satisfies ExportedHandler<Env>;
