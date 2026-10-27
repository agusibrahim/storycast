/**
 * Direct Google Gemini client (no proxy/router worker).
 *
 * Endpoints hit directly at https://generativelanguage.googleapis.com:
 * - POST https://android.googleapis.com/auth                         AAS master token -> ya29 OAuth bearer token
 * - POST /v1beta/models/gemini-3.8-flash:generateContent             storyboard, research, edit & topic ideas
 * - POST /v1beta/interactions (gemini-3.1-flash-image)               image generation with up to 14 reference images
 * - POST /v1beta/interactions (gemini-omni-1.1-flash)                scene video generation (image_to_video / text_to_video)
 * - POST /v1beta/interactions (gemini-3.8-flash-tts / lite-tts)      expressive narration synthesis (WAV 24kHz)
 * - POST /v1beta/interactions (gemini-3.5-transcribe)                word-level caption timestamps
 */

import { SHARE_API } from "@/lib/share";

export const GOOGLE_API_HOST = "https://generativelanguage.googleapis.com";
export const DEFAULT_ROUTER_BASE = GOOGLE_API_HOST;
const ROUTER_KEY = "storycast-router-base";
const CUSTOM_AUTH_KEY = "storycast-gemini-auth";

export function routerBase(): string {
  try {
    const saved = localStorage.getItem(ROUTER_KEY)?.trim().replace(/\/$/, "");
    if (saved && !saved.includes("workers.dev")) return saved;
  } catch {}
  return GOOGLE_API_HOST;
}

export function setRouterBase(base: string) {
  try {
    const clean = base.trim().replace(/\/$/, "");
    if (!clean || clean === GOOGLE_API_HOST || clean.includes("workers.dev")) {
      localStorage.removeItem(ROUTER_KEY);
    } else {
      localStorage.setItem(ROUTER_KEY, clean);
    }
  } catch {}
}

export function geminiAuthInput(): string {
  try {
    return localStorage.getItem(CUSTOM_AUTH_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setGeminiAuthInput(val: string) {
  try {
    const clean = val.trim();
    if (clean) localStorage.setItem(CUSTOM_AUTH_KEY, clean);
    else localStorage.removeItem(CUSTOM_AUTH_KEY);
    tokenCache.clear();
    workerTokenCache = null;
  } catch {}
}

export const DEFAULT_ROBIN_BASE = GOOGLE_API_HOST;
export const robinBase = () => GOOGLE_API_HOST;
export const setRobinBase = (_base: string) => {
  void _base;
};

// ------------------------------------------------ Direct Google AAS Auth Pool
// Zero hardcoded secrets in repo: reads from Vite env (VITE_GOOGLE_AAS_ACCOUNTS /
// VITE_GOOGLE_AAS_ACCOUNT_1..10), user Settings, or CF Worker /api/gemini-token.

type GoogleAccount = {
  id: string;
  email: string;
  authData: string;
  active: boolean;
  errorCount: number;
  cooldownUntil: number;
};

function parseAccountList(): GoogleAccount[] {
  const rawList: string[] = [];
  const custom = geminiAuthInput();
  if (custom && (custom.startsWith("aas_et/") || custom.includes("Token="))) {
    rawList.push(...custom.split(/[\n;]+/).map((s) => s.trim()).filter(Boolean));
  }
  const env = import.meta.env as Record<string, string | undefined>;
  for (let i = 1; i <= 10; i++) {
    const v = env[`VITE_GOOGLE_AAS_ACCOUNT_${i}`];
    if (v && v.trim()) rawList.push(v.trim());
  }
  if (env.VITE_GOOGLE_AAS_ACCOUNTS?.trim()) {
    rawList.push(...env.VITE_GOOGLE_AAS_ACCOUNTS.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean));
  }
  return rawList.map((raw, idx) => {
    const authData = raw.startsWith("aas_et/")
      ? `androidId=3c4096cfd46caf54&Email=user%40gmail.com&Token=${encodeURIComponent(raw)}`
      : raw;
    const m = authData.match(/Email=([^&]+)/i);
    const email = m ? decodeURIComponent(m[1]) : `account_${idx + 1}`;
    return {
      id: `acc_${idx + 1}`,
      email,
      authData,
      active: true,
      errorCount: 0,
      cooldownUntil: cooldownMap.get(`acc_${idx + 1}`) ?? 0,
    };
  });
}

let roundRobinIdx = 0;
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const cooldownMap = new Map<string, number>();
let workerTokenCache: { token: string; accountId: string; expiresAt: number } | null = null;

function nextLocalAccount(): GoogleAccount | null {
  const accounts = parseAccountList();
  if (!accounts.length) return null;
  const now = Date.now();
  const ready = accounts.filter((a) => a.cooldownUntil <= now);
  if (ready.length > 0) {
    const chosen = ready[roundRobinIdx % ready.length];
    roundRobinIdx = (roundRobinIdx + 1) % ready.length;
    return chosen;
  }
  const sorted = [...accounts].sort((a, b) => a.cooldownUntil - b.cooldownUntil);
  return sorted[0] ?? null;
}

async function markAccountError(accountId: string, status: number) {
  tokenCache.delete(accountId);
  cooldownMap.set(accountId, Date.now() + (status === 429 ? 60_000 : 120_000));
  if (workerTokenCache && workerTokenCache.accountId === accountId) {
    workerTokenCache = null;
    if (SHARE_API) {
      fetch(`${SHARE_API}/api/gemini-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brokenAccountId: accountId }),
      }).catch(() => {});
    }
  }
}

async function exchangeAASToken(account: GoogleAccount, signal?: AbortSignal): Promise<string> {
  const now = Date.now();
  const cached = tokenCache.get(account.id);
  if (cached && cached.expiresAt > now + 60_000) return cached.token;

  const params = new URLSearchParams(account.authData);
  const androidId = params.get("androidId") || "3c4096cfd46caf54";
  const email = params.get("Email") || account.email;
  let masterToken = params.get("Token") || "";
  if (masterToken.includes("%")) {
    try {
      masterToken = decodeURIComponent(masterToken);
    } catch {}
  }

  const exchangeBody = new URLSearchParams({
    androidId,
    app: "com.google.android.googlequicksearchbox",
    client_sig: "38918a453d07199354f8b19af05ec6562ced5788",
    callerPkg: "com.google.android.googlequicksearchbox",
    callerSig: "38918a453d07199354f8b19af05ec6562ced5788",
    device_country: "id",
    Email: email,
    google_play_services_version: "263332035",
    lang: "en_US",
    sdk_version: "35",
    service: "oauth2:https://www.googleapis.com/auth/generative-language",
    source: "android",
    Token: masterToken,
  });

  const res = await fetch("https://android.googleapis.com/auth", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: exchangeBody.toString(),
  });

  if (!res.ok) {
    await markAccountError(account.id, res.status);
    throw new Error(`AAS Bearer Exchange Error (${res.status})`);
  }

  const text = await res.text();
  for (const line of text.split("\n")) {
    if (line.startsWith("Auth=")) {
      const token = line.slice(5).trim();
      tokenCache.set(account.id, { token, expiresAt: now + 45 * 60_000 });
      return token;
    }
  }
  await markAccountError(account.id, 401);
  throw new Error("Google Auth response missing Auth= token");
}

async function getDirectAuth(signal?: AbortSignal): Promise<{ headers: Record<string, string>; urlSuffix: string; accountId: string }> {
  const env = import.meta.env as Record<string, string | undefined>;
  const custom = geminiAuthInput() || env.VITE_GEMINI_API_KEY?.trim() || "";
  if (custom.startsWith("AIza")) {
    return { headers: { "Content-Type": "application/json" }, urlSuffix: `?key=${encodeURIComponent(custom)}`, accountId: "apikey" };
  }
  if (custom.startsWith("ya29.")) {
    return { headers: { "Content-Type": "application/json", Authorization: `Bearer ${custom}` }, urlSuffix: "", accountId: "ya29" };
  }

  // 1. Try local / build-time env accounts (VITE_GOOGLE_AAS_ACCOUNT_* or Settings)
  const localAccounts = parseAccountList();
  let lastErr: unknown;
  for (let i = 0; i < localAccounts.length; i++) {
    const acc = nextLocalAccount();
    if (!acc) break;
    try {
      const token = await exchangeAASToken(acc, signal);
      return { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, urlSuffix: "", accountId: acc.id };
    } catch (e) {
      lastErr = e;
    }
  }

  // 2. Fetch short-lived ya29 token from Storycast CF Worker (keeps master aas_et/ in CF Worker secret env)
  if (SHARE_API) {
    const now = Date.now();
    if (workerTokenCache && workerTokenCache.expiresAt > now + 60_000) {
      return {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${workerTokenCache.token}` },
        urlSuffix: "",
        accountId: workerTokenCache.accountId,
      };
    }
    const r = await fetch(`${SHARE_API}/api/gemini-token`, { signal });
    if (r.ok) {
      const d = (await r.json()) as { token?: string; accountId?: string; expiresIn?: number };
      if (d.token) {
        workerTokenCache = {
          token: d.token,
          accountId: d.accountId || "worker",
          expiresAt: now + (d.expiresIn || 2400) * 1000,
        };
        return {
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${d.token}` },
          urlSuffix: "",
          accountId: workerTokenCache.accountId,
        };
      }
    } else {
      lastErr = new Error(await errorMessage(r, `token endpoint answered ${r.status}`));
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("No Gemini credential configured. Set GOOGLE_AAS_ACCOUNT_1 in Cloudflare Worker env, VITE_GOOGLE_AAS_ACCOUNT_1 in .env, or add a token in Settings.");
}

export async function geminiFetch(path: string, body: unknown, signal?: AbortSignal, maxRetries = 3): Promise<Response> {
  const base = routerBase();
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const auth = await getDirectAuth(signal);
    const sep = path.includes("?") ? "&" : "?";
    const url = auth.urlSuffix ? `${base}${path}${sep}${auth.urlSuffix.slice(1)}` : `${base}${path}`;
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: auth.headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    if (res.ok) return res;
    lastRes = res;
    if (res.status === 429 || res.status === 401 || res.status === 403) {
      await markAccountError(auth.accountId, res.status);
      continue;
    }
    if (res.status === 400 && attempt < maxRetries - 1) {
      const clone = res.clone();
      const errText = await clone.text().catch(() => "");
      if (errText.includes("User location is not supported") || errText.includes("RESOURCE_EXHAUSTED")) {
        await markAccountError(auth.accountId, 429);
        continue;
      }
    }
    if (res.status >= 500 && attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    return res;
  }
  return lastRes!;
}

import type { Voice } from "@/lib/api";

/** Official Chirp3-HD sample recordings (Google Cloud docs). Lowercase match. */
const CHIRP_SAMPLES = new Set(
  "achernar achird algenib algieba alnilam aoede autonoe callirrhoe charon despina enceladus erinome fenrir gacrux iapetus kore laomedeia leda orus pulcherrima puck rasalgethi sadachbia sadaltager schedar sulafat umbriel vindemiatrix zephyr zubenelgenubi".split(" "),
);

export type RobinVoice = { name: string; gender: string; tone: string; description: string };

/** All 30 official Google Gemini Studio Voices. */
export const GEMINI_STUDIO_VOICES: Record<string, RobinVoice> = {
  Achernar: { name: "Achernar", gender: "Female", tone: "Soft", description: "Soft & gentle voice" },
  Achird: { name: "Achird", gender: "Male", tone: "Friendly", description: "Friendly & approachable voice" },
  Algenib: { name: "Algenib", gender: "Male", tone: "Gravelly", description: "Gravelly & textured voice" },
  Algieba: { name: "Algieba", gender: "Male", tone: "Smooth", description: "Smooth & resonant voice" },
  Alnilam: { name: "Alnilam", gender: "Male", tone: "Firm", description: "Firm & steady voice" },
  Aoede: { name: "Aoede", gender: "Female", tone: "Breezy", description: "Breezy & warm storyteller" },
  Autonoe: { name: "Autonoe", gender: "Female", tone: "Bright", description: "Bright & clear voice" },
  Callirrhoe: { name: "Callirrhoe", gender: "Female", tone: "Easy-going", description: "Easy-going & relaxed voice" },
  Charon: { name: "Charon", gender: "Male", tone: "Informative", description: "Deep & informative narrator" },
  Despina: { name: "Despina", gender: "Female", tone: "Smooth", description: "Smooth & flowing voice" },
  Enceladus: { name: "Enceladus", gender: "Male", tone: "Breathy", description: "Breathy & intimate voice" },
  Erinome: { name: "Erinome", gender: "Female", tone: "Clear", description: "Clear & articulate voice" },
  Fenrir: { name: "Fenrir", gender: "Male", tone: "Excitable", description: "Excitable & authoritative voice" },
  Gacrux: { name: "Gacrux", gender: "Female", tone: "Mature", description: "Mature & composed voice" },
  Iapetus: { name: "Iapetus", gender: "Male", tone: "Clear", description: "Clear & balanced voice" },
  Kore: { name: "Kore", gender: "Female", tone: "Friendly", description: "Soft, firm & friendly narrator" },
  Laomedeia: { name: "Laomedeia", gender: "Female", tone: "Upbeat", description: "Upbeat & cheerful voice" },
  Leda: { name: "Leda", gender: "Female", tone: "Youthful", description: "Youthful & expressive voice" },
  Orus: { name: "Orus", gender: "Male", tone: "Firm", description: "Firm & confident voice" },
  Puck: { name: "Puck", gender: "Male", tone: "Upbeat", description: "Upbeat & energetic storyteller" },
  Pulcherrima: { name: "Pulcherrima", gender: "Female", tone: "Forward", description: "Forward & bright voice" },
  Rasalgethi: { name: "Rasalgethi", gender: "Male", tone: "Informative", description: "Informative & thoughtful voice" },
  Sadachbia: { name: "Sadachbia", gender: "Male", tone: "Lively", description: "Lively & animated voice" },
  Sadaltager: { name: "Sadaltager", gender: "Male", tone: "Knowledgeable", description: "Knowledgeable & calm voice" },
  Schedar: { name: "Schedar", gender: "Male", tone: "Even", description: "Even & composed voice" },
  Sulafat: { name: "Sulafat", gender: "Female", tone: "Warm", description: "Warm & soothing voice" },
  Umbriel: { name: "Umbriel", gender: "Male", tone: "Easy-going", description: "Easy-going & natural voice" },
  Vindemiatrix: { name: "Vindemiatrix", gender: "Female", tone: "Gentle", description: "Gentle & kind voice" },
  Zephyr: { name: "Zephyr", gender: "Female", tone: "Bright", description: "Bright & airy voice" },
  Zubenelgenubi: { name: "Zubenelgenubi", gender: "Male", tone: "Casual", description: "Casual & conversational voice" },
};

export const PREVIEW_VOICES_MAP: Record<string, string> = Object.fromEntries(
  Object.keys(GEMINI_STUDIO_VOICES).map((k) => [k, k]),
);

export function robinSampleUrl(voiceId: string): string | null {
  const slug = voiceId.toLowerCase();
  return CHIRP_SAMPLES.has(slug) ? `https://docs.cloud.google.com/static/text-to-speech/docs/audio/chirp3-hd-${slug}.wav` : null;
}

/** Gemini Studio TTS voices mapped to the studio Voice shape. */
export async function robinVoices(signal?: AbortSignal): Promise<Voice[]> {
  void signal;
  return Object.entries(GEMINI_STUDIO_VOICES)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, v]) => ({
      voice_id: id,
      name: v.name || id,
      description: v.description || v.tone || "",
      preview_url: robinSampleUrl(id) ?? "",
      category: "",
      tags: [] as string[],
      gender: v.gender || "",
      age: "",
      accent: "",
      collections: 0,
      curated: false,
    }));
}

export type ChatResponse = {
  status: string;
  mode: string;
  model?: string;
  model_name?: string;
  title?: string;
  text?: string;
  has_image?: boolean;
  handle?: string | null;
  data_url?: string | null;
  download_url?: string | null;
  download_urls?: { small?: string; medium?: string; large?: string } | null;
  remote_url?: string | null;
  images?: string[];
  resolution?: string | null;
  has_full_res?: boolean;
  elapsed_seconds?: number;
};

export class RobinError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

/** Dig out the real upstream message (often nested JSON-in-JSON). */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const t = await res.text();
    // Unwrap {"error":{"message":"{\"error\":{\"message\":\"...\"}}"}} chains.
    let cur: unknown = t;
    for (let i = 0; i < 3; i++) {
      if (typeof cur === "string") {
        try {
          cur = JSON.parse(cur) as unknown;
          continue;
        } catch {
          break;
        }
      }
      if (cur && typeof cur === "object" && "error" in cur) {
        const e = (cur as { error: unknown }).error;
        cur = typeof e === "string" ? e : (e as { message?: unknown })?.message ?? cur;
        continue;
      }
      break;
    }
    const msg = typeof cur === "string" ? cur : fallback;
    return msg.slice(0, 220) || fallback;
  } catch {
    return fallback;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Upstream geo-gate / rate / server errors are transient — worth one more shot. */
function retryable(status: number, message: string): boolean {
  return status === 429 || status >= 500 || /FAILED_PRECONDITION|not supported for the API|location|overloaded|try again/i.test(message);
}

const SAFETY_OFF = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

type GenPart = { text?: string; thought?: boolean; inlineData?: { mimeType?: string; data?: string } };

function partsText(parts: GenPart[] | undefined): string {
  const all = parts ?? [];
  const nonThought = all.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  return nonThought || all.map((p) => p.text ?? "").join("");
}

async function chat(
  prompt: string,
  _model = "flash",
  signal?: AbortSignal,
  maxTokens = 4000,
  tools?: { googleSearch: Record<string, unknown> }[],
  temperature = 0.7,
  jsonMode = false,
): Promise<ChatResponse> {
  void _model;
  const r = await geminiFetch(
    "/v1beta/models/gemini-3.8-flash:generateContent",
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        topP: 0.95,
        topK: 40,
        thinkingConfig: { thinkingBudget: 0 },
        ...(jsonMode && !tools?.length ? { responseMimeType: "application/json" } : {}),
      },
      safetySettings: SAFETY_OFF,
      ...(tools?.length ? { tools } : {}),
    },
    signal,
  );
  if (!r.ok) throw new RobinError(await errorMessage(r, `story service answered ${r.status}`), r.status);
  const d = (await r.json()) as {
    candidates?: { finishReason?: string; content?: { parts?: GenPart[] } }[];
  };
  const c = d.candidates?.[0];
  if (!c) throw new RobinError("story service came back empty");
  if (c.finishReason && !["STOP", "MAX_TOKENS"].includes(c.finishReason)) throw new RobinError(`story stopped: ${c.finishReason}`);
  return { status: "ok", mode: "text", text: partsText(c.content?.parts), has_image: false };
}

// ---------------------------------------------------------------- storyboard

export type StorySceneDraft = { narration: string; moment: string; depiction: string };
export type StoryboardDraft = { title: string; subtitle: string; poster: string; scenes: StorySceneDraft[] };

export const SCENE_MIN = 7;
export const SCENE_MAX = 20;
export const clampScenes = (n: number) => Math.max(SCENE_MIN, Math.min(SCENE_MAX, Math.round(n) || SCENE_MIN));

export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "21:9";

export const ASPECTS: { id: AspectRatio; sub: string; frame: string; iconW: number; iconH: number }[] = [
  { id: "16:9", sub: "Landscape", frame: "widescreen 16:9 landscape composition", iconW: 40, iconH: 23 },
  { id: "9:16", sub: "Shorts / Reels", frame: "vertical 9:16 portrait composition for Shorts and Reels, main subject centered with comfortable headroom", iconW: 20, iconH: 36 },
  { id: "1:1", sub: "Square", frame: "square 1:1 composition with balanced, centered framing", iconW: 26, iconH: 26 },
  { id: "4:3", sub: "Standard", frame: "classic 4:3 composition", iconW: 34, iconH: 26 },
  { id: "21:9", sub: "Cinema", frame: "ultrawide 21:9 cinematic composition with expansive lateral space", iconW: 46, iconH: 20 },
];

export const aspectFrame = (a: AspectRatio): string => ASPECTS.find((x) => x.id === a)?.frame ?? ASPECTS[0].frame;

/**
 * Hand-drawn print styles (adopted from story_maker2): these need a strict
 * sketch-only prompt system with hard bans on photo/cine/3D vocabulary.
 * Painted/digital styles (watercolor, gouache, vector, anime, 3D) go general.
 */
const SKETCH_RE = /sketch|pencil|doodl|hand-draw|drawing|sketsa|scribble|cross-hatch|chalk|charcoal|crayon|\bink\b|sumi|minimal line|stick|whiteboard|notebook|brush/i;
const PAINTED_RE = /watercolor|gouache|vector|anime|3d|pixar|cinematic/i;

export function isHandDrawing(styleLabel: string): boolean {
  if (PAINTED_RE.test(styleLabel)) return false;
  return SKETCH_RE.test(styleLabel);
}

const SKETCH_BANS =
  `never write photo, camera, film or 3D words: no lens mentions (35mm, 50mm, 85mm, f/1.8, f/2.8), ` +
  `no depth of field, no bokeh, no god rays, no dust motes, no photorealistic, no film still, ` +
  `no 3D render, no CGI, no digital painting, no unreal engine, no cinematic lighting, no watercolor washes`;

const SKETCH_CLOSER = `raw authentic hand-drawn sketch on paper, physical print illustration, no photography, no 3D, no digital CGI`;

/** How the step-1 tale writer should stage each "moment" for the frame. */
const ORIENTATION_NOTE: Record<AspectRatio, string> = {
  "16:9": "a wide sideways frame — stage the action across the width",
  "9:16": "a tall upright phone frame — stack the action vertically, keep the teller centered with breathing room above the head, never a wide panorama",
  "1:1": "a square frame — keep the subject centered and balanced",
  "4:3": "a classic slightly-wide frame — stage the action across the middle",
  "21:9": "an extra-wide cinema frame — use the lateral space, place subjects off-center with room to the sides",
};

/**
 * Step 1 prompt. Deliberately avoids image-trigger words (image, picture,
 * draw, render, illustration, keyframe, style) — the worker classifies intent
 * and those words flip it into picture mode (see HAR: "Used Nano Banana…").
 * The "moment" line becomes the image prompt later in step 2, where the
 * style label is prepended by generateSceneImage.
 */
export type ProtagonistBrief = { gender: string; age: string; species: string };

const AGE_EN: Record<string, string> = { "Anak-anak": "young", Remaja: "teenage", Dewasa: "adult", Lansia: "elderly" };
const GENDER_EN: Record<string, string> = { "Laki-laki": "male", Perempuan: "female" };
const SPECIES_EN: Record<string, string> = { Manusia: "human", Hewan: "animal", Fantasi: "fantasy creature", Acak: "character of any species you choose" };

const FACTUAL_GENRES = new Set(["edukasi", "sains", "sejarah"]);

const GENRE_RULES: Record<string, string> = {
  edukasi: "Teach exactly one idea. The hero discovers it by doing something, not by being lectured. The last line states the idea in plain words a child can repeat.",
  petualangan: "A goal, a hard obstacle, and a narrow escape earned by a clever or brave choice. Danger stays mild and non-graphic.",
  fantasi: "One impossible rule governs this world. The hero learns the rule by breaking it once, then uses it on purpose to solve the problem.",
  fabel: "Animals act out one human flaw. The last scene shows the lesson through what happens, then says it in one short sentence.",
  legenda: "Tell it as a legend and hedge what is not known. Keep one wonder, one human reason, and an ending that explains why the place or custom exists.",
  dongeng: "A wish, a rule that must not be broken, a breaking, and a last chance to put it right. Wonder stays kind.",
  sains: "Show one real mechanism as a cause the hero can see. No magic standing in for the science. End by naming the mechanism.",
  sejarah: "Stay in one time and place. One real event, one person's choice inside it, and what changed because of that choice. Hedge anything uncertain.",
  komedi: "The joke is the hero's plan going wrong in a way that follows from their personality. No random gags. The last scene pays off a setup from the first.",
  misteri: "Plant one strange clue in part 1. Each later part reveals one new clue that re-reads an earlier one. The answer arrives only in the last part, and it must fit every clue.",
  persahabatan: "Two characters want the same thing in different ways. A misunderstanding splits them. One of them chooses to listen, and that repairs it.",
  keluarga: "A family habit causes friction. A child and an elder each give something up. The ending shows the home changed, not a speech about love.",
  alam: "The place is a character. Weather or season forces a choice. The hero adapts instead of conquering. End on the place at rest.",
  hewan: "The animal's real behavior drives the plot. Do not give it human tools. The animal solves the problem the way that species actually would.",
  antariksa: "One space fact creates the problem. The solution obeys that fact. Wonder, not battle.",
  laut: "The sea sets the terms: tide, depth, current, or a creature's real habit. The hero respects it. End when the water has the last move.",
  pahlawan: "Courage is a specific choice that costs the hero something small and real. No fight choreography. Someone weaker is safer because of it.",
  olahraga: "One skill the hero lacks, one practice that fails, one adjustment, then the moment that uses the adjustment. The win can be small.",
  musik: "A sound or song is heard, lost, and found again changed. The last part is the performance that only works because of the loss.",
  budaya: "One custom is shown from the inside, through someone learning when and why it is done. No outsider mockery. End with the custom practiced correctly.",
};

const genreKey = (genre: string) => genre.trim().toLowerCase();

function genreRule(genre: string, role: string): string {
  const rule = GENRE_RULES[genreKey(genre)];
  if (!rule) return `Genre: a tale with one want, one obstacle, one choice, and an ending that changes the ${role}. `;
  return `Genre (${genre.trim()}): ${rule} `;
}

function spine(count: number, role: string): string {
  const mid = Math.max(2, Math.min(count - 1, Math.round(count / 2)));
  const knot = Math.max(2, Math.min(mid, Math.round(count / 3)));
  return (
    `Story spine, mandatory, across exactly ${count} parts: ` +
    `Part 1 plants one question the viewer wants answered, and a want for the ${role}. ` +
    `By part ${knot} an obstacle blocks the easy way. ` +
    `Part ${mid} is the turn: new information, or a choice that changes the goal. ` +
    `Every part after the turn shows the cost of that choice. ` +
    `Part ${count} answers the question from part 1 and does not open a new topic. `
  );
}

function storyboardPrompt(topic: string, count: number, langName: string, character: string, aspect: AspectRatio, persona = "", design = "", styleLabel = "", protagonist: ProtagonistBrief | null = null, styleAnchor = "", genre = "", facts = ""): string {
  // Protagonist mode: the AI invents the hero (gender/age/species fixed) and
  // the tale is told ABOUT the hero. Narrator mode: the chosen character tells it.
  const role = protagonist ? "hero" : "teller";
  const factLine = facts.trim()
    ? `Use only these researched facts, and no others: ${facts.trim()}. Hedge anything uncertain ("people say", "scientists think"). Do not invent numbers, dates, or names. `
    : FACTUAL_GENRES.has(genreKey(genre))
      ? `Keep every fact accurate. If you are not sure, hedge it. Do not invent numbers, dates, or names. `
      : `Keep facts accurate; hedge legends ("people say"). `;
  const causality =
    `Causality: each part follows the one before with THEREFORE (it happens because of what just happened) or BUT (it happens against what the ${role} expected). ` +
    `A part that could be swapped with another is a failed part. ` +
    `Stay in the same place while the action is still unfolding. Change what the ${role} knows, decides, or risks — not the backdrop — unless the tale itself travels. `;
  const choices =
    `Choices: at least every third part, the ${role} decides (goes, refuses, asks, shares, fixes, or risks something). ` +
    `The very next part shows what that decision caused. The ${role} is never only watching. `;
  // The anchor (rich English style prompt) describes the look far better than
  // the short display label — and matches the sketch detector's English terms.
  const look = styleAnchor.trim() || styleLabel || "pencil sketch";
  const sketch = isHandDrawing(styleAnchor.trim() ? `${styleAnchor} ${styleLabel}` : styleLabel || "pencil sketch");
  const artSystem = sketch
    ? `Art system for every moment and depiction: pure hand-drawn sketchbook art on physical paper (${look}). ` +
      `Describe real hand media only (graphite pencil, fountain-pen scribbles, cross-hatching, stippling, contour linework, chalk or charcoal), ` +
      `always on a physical paper canvas with visible texture and clean negative space ready for print. ` +
      `HARD BANS: ${SKETCH_BANS}. This is never a film, never a photo, never a 3D render. ` +
      `End every depiction with exactly: "${SKETCH_CLOSER}". ` +
      `Parts 2 onward keep the same sketch media, strokes and paper canvas as part 1. `
    : `Art system for every moment and depiction: ${look} look. ` +
      `Give exact faces, hair, attire with fabric detail, expressive micro-emotions, full environment with foreground and background, ` +
      `lighting that reflects the look, and varied shot staging (wide group views alternate with close personal moments). ` +
      `Parts 2 onward open the depiction — the depiction ONLY, never the narration — with "Seamless continuation from the previous part:" and name the exact same ${role} design. ` +
      `Narration holds nothing but spoken words in the spoken language: no English openers, no markers, no descriptions, no design phrases. `;
  const teller = protagonist
    ? `Hero: a ${AGE_EN[protagonist.age] ?? "young"} ${GENDER_EN[protagonist.gender] ?? ""} ${SPECIES_EN[protagonist.species] ?? "character"}${persona ? ` — ${persona}` : ""}. The tale is told ABOUT the hero in third person — the hero takes part in most parts of the tale, acting true to this nature. ` +
      `Invent one fixed design for the hero (face, outfit, colors, one prop) and reuse it VERBATIM in every moment and depiction — never redesign mid-tale. Give the hero a memorable name and use it in every narration. `
    : character
    ? `Teller: ${character}${persona ? ` — ${persona}` : ""}. The teller takes part in most parts of the tale, acting true to this nature. ` +
      (design
        ? `Fixed design: ${design}. Reuse this exact design VERBATIM for the teller in every moment and depiction below — never redesign, restyle or redress the teller. `
        : `Invent one fixed design for the teller (face, outfit, colors, one prop) and reuse it VERBATIM in every moment and depiction — never redesign mid-tale. `)
    : `Invent one warm teller who takes part in most parts of the tale. ` +
      `Invent one fixed design for the teller (face, outfit, colors, one prop) and reuse it VERBATIM in every moment and depiction — never redesign mid-tale. `;
  return (
    `Reply with JSON text only, nothing else. ` +
    `Write a short narrated tale in ${count} parts. TOPIC: ${topic}. ` +
    teller +
    artSystem +
    genreRule(genre, role) +
    spine(count, role) +
    `Spoken language: ${langName}. ${factLine}` +
    `Each part: 1-3 spoken sentences (20-40 words). No "this video" talk. ` +
    `Each part also has a "moment": one sentence describing the setting, the light, and what the ${role} is doing. ` +
    `Match rule — each moment must SHOW exactly what its own narration SAYS: same subjects, same place, same action. ` +
    `If the narration tells of the ${role} following bees to learn where the honey went, the moment shows that same search — ` +
    `never an unrelated act somewhere else. A viewer who mutes the sound must still follow the tale from the moments alone. ` +
    causality +
    choices +
    `CAMERA BRIEF (mandatory): end every moment with a camera directive sentence starting exactly with "Camera: ". ` +
    `Pick a different shot for every part and never repeat the previous part's shot — rotate through: wide establishing shot, ` +
    `eye-level medium shot, low-angle shot, high-angle shot, close-up on the ${role}'s face, over-the-shoulder shot, side-profile shot, ` +
    `bird's-eye view, ${role} seen from behind looking at the scene. Also vary the ${role}'s screen position every part ` +
    `(left third, right third, center, small in the distance, large in the foreground) — never park the ${role} in the same spot twice in a row. ` +
    `Example ending: "Camera: low-angle medium shot, ${role} standing at the right third looking up." ` +
    `Stage every moment for ${ORIENTATION_NOTE[aspect]}. ` +
    `Each part also has a "depiction": your own richly detailed single sentence describing the artwork for this part — textures, fabrics, light direction, ` +
    `atmosphere, depth, background elements, and staging for ${ORIENTATION_NOTE[aspect]}. ` +
    `The depiction shows the same subjects, place and action as its narration and moment. No readable text anywhere in the artwork. ` +
    `Lock the ${role}'s look: the fixed design above appears identically word for word inside every depiction, so every part shares one unchanging design. ` +
    `Write "moment" and "depiction" always in rich, complex English — even when the narration itself is in another language. ` +
    `Pack them like a premium artwork description: exact subject with concrete visual traits, fabrics and textures, light direction and mood, ` +
    `color palette, atmosphere, depth, background elements, and precise staging. One dense sentence each, no filler. ` +
    `Moment and depiction are ALWAYS written in English, even when the narration is Indonesian — a non-English moment or depiction makes the whole answer invalid. ` +
    `Start every moment and depiction directly with the subject — never open with frame talk like "wide frame showing" or "horizontal composition". ` +
    `VOICE EXPRESSION TAGS: you may embed these bracketed tags inside "narration" where they genuinely fit the feeling — at most 1-2 tags per part, never in every sentence. ` +
    `Sound tags (heard, not spoken): [sigh] a sigh, [laughing] a laugh, [uhm] a hesitation. ` +
    `Tone tags (shape the next words): [whispering] quiet, [shouting] loud, [sarcasm] sarcastic, [robotic] robotic, [extremely fast] very fast. ` +
    `Pause tags (silence): [short pause] brief beat, [medium pause] sentence-break beat, [long pause] dramatic 1s+ beat, e.g. "The answer is... [long pause] ...no." ` +
    `A tag must match the part's feeling — a scared line gets fear, not laughter; do not force tags where the line is neutral. ` +
    `Return ONLY this JSON, no prose, no markdown fences: ` +
    `{"title": "tale title in Title Case", "subtitle": "2-5 Words In Title Case", "poster": "one rich English sentence describing the cover artwork", ` +
    `"parts": [{"narration": "spoken line", "moment": "An English visual sentence", "depiction": "An English artwork sentence"}]} ` +
    `LAST RULE, HIGHEST PRIORITY: every "moment" and "depiction" string is written in English. Only "narration" uses the spoken language. ` +
    `Title and subtitle use Title Case: every word starts with a capital letter, never all-lowercase. An all-lowercase title or subtitle makes the whole answer invalid. ` +
    `The poster shows the ${role} plus key motifs from the tale in one iconic arrangement, calm open space at the top, no readable text anywhere. ` +
    `Return exactly ${count} parts — no fewer, no more.`
  );
}

function extractJson(text: string): unknown {
  const t = text
    .trim()
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```\s*$/g, "")
    // The model sometimes bullets each part object ("*  {" or "1. {") — strip those markers.
    .replace(/^\s*[*•\-+]\s*(?=\{)/gm, "")
    .replace(/^\s*\d{1,2}[.)]\s*(?=\{)/gm, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object found");
  return JSON.parse(t.slice(start, end + 1));
}

/** Safety net: the model sometimes returns all-lowercase despite the brief. */
function titleCase(s: string): string {
  const t = s.trim();
  if (!t || t !== t.toLowerCase()) return t;
  return t.replace(/\b\p{L}[\p{L}'-]*/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

function looksIndonesian(s: string): boolean {
  return /\b(yang|dengan|dari|untuk|adalah|itu|ini|dan|pada|sebuah|dalam|secara|tersebut|karena|ketika|seperti|seorang|tengah|sambil|sudah|telah)\b/i.test(` ${s} `);
}

function extractJsonArray(text: string): unknown[] {
  const t = text.trim().replace(/```(?:json)?\s*/gi, "").replace(/```\s*$/g, "");
  const arr = JSON.parse(t.slice(t.indexOf("["), t.lastIndexOf("]") + 1)) as unknown;
  return Array.isArray(arr) ? arr : [];
}

/** Safety net: the continuity marker belongs to depiction — never narration. */
function cleanNarration(s: string): string {
  return s
    .replace(/^\s*seamless continuation from the previous part:\s*/i, "")
    .replace(/\s*seamless continuation from the previous part:\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
async function ensureEnglish(draft: StoryboardDraft, signal?: AbortSignal): Promise<StoryboardDraft> {  type Entry = { scene: number; field: "moment" | "depiction" | "poster" };
  const entries: Entry[] = [];
  draft.scenes.forEach((s, i) => {
    if (looksIndonesian(s.moment)) entries.push({ scene: i, field: "moment" });
    if (looksIndonesian(s.depiction)) entries.push({ scene: i, field: "depiction" });
  });
  if (draft.poster && looksIndonesian(draft.poster)) entries.push({ scene: -1, field: "poster" });
  if (!entries.length) return draft;
  try {
    const lines = entries.map((e, k) => `[${k}] ${e.field === "poster" ? draft.poster : draft.scenes[e.scene][e.field]}`);
    const r = await chat(
      `Rewrite each numbered line below as a rich, complex English image-generation prompt with concrete visual traits, textures, light and staging. ` +
        `Return ONLY a JSON array of translated strings in the same order and numbering, no other text.\n\n${lines.join("\n")}`,
      "flash",
      signal,
    );
    const arr = extractJsonArray(String(r.text ?? ""));
    entries.forEach((e, k) => {
      const t = typeof arr[k] === "string" ? (arr[k] as string).trim() : "";
      if (!t) return;
      if (e.field === "poster") draft.poster = t.slice(0, 800);
      else draft.scenes[e.scene][e.field] = t.slice(0, 800);
    });
  } catch {
    // Keep the originals — the image model still understands them.
  }
  return draft;
}

function scenesFromList(list: unknown, count: number): StorySceneDraft[] {
  return (Array.isArray(list) ? list : [])
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      const narration = cleanNarration(String(o.narration ?? o.text ?? "").slice(0, 600));
      const moment = String(o.moment ?? o.visual ?? o.description ?? "").slice(0, 600);
      const depiction = String(o.depiction ?? o.artwork ?? o.image ?? "").slice(0, 800);
      return { narration, moment, depiction };
    })
    .filter((s) => s.narration || s.moment || s.depiction)
    .slice(0, count);
}

function boardFromText(raw: string, topic: string, count: number): StoryboardDraft {
  const parsed = extractJson(raw) as { title?: unknown; subtitle?: unknown; poster?: unknown; scenes?: unknown; parts?: unknown };
  const list = Array.isArray(parsed.parts) ? parsed.parts : parsed.scenes;
  const scenes = scenesFromList(list, count);
  if (!scenes.length) throw new Error("empty scenes");
  return {
    title: titleCase(String(parsed.title ?? topic).slice(0, 120)) || topic,
    subtitle: titleCase(String(parsed.subtitle ?? "").slice(0, 160)),
    poster: String(parsed.poster ?? "").slice(0, 800),
    scenes,
  };
}

type StoryboardInput = {
  topic: string;
  scenes: number;
  langName: string;
  character: string;
  aspect: AspectRatio;
  persona?: string;
  design?: string;
  styleLabel?: string;
  protagonist?: ProtagonistBrief | null;
  styleAnchor?: string;
  genre?: string;
};

async function askBoard(prompt: string, topic: string, count: number, signal?: AbortSignal): Promise<StoryboardDraft> {
  let promptNow = prompt;
  for (let i = 0; i < 2; i++) {
    const r = await chat(promptNow, "flash", signal, Math.min(24000, 4000 + 1200 * count), undefined, 0.7, true);
    const raw = String(r.text ?? "");
    if (raw.trim().length < 100) {
      promptNow = `${prompt}\n\nYour previous answer was too short. Return ONLY the JSON object with exactly ${count} parts.`;
      continue;
    }
    try {
      return boardFromText(raw, topic, count);
    } catch {
      promptNow = `${prompt}\n\nYour previous answer was not valid JSON. Return ONLY the JSON object.`;
    }
  }
  throw new RobinError("the story service came back unreadable — please try again");
}

async function fillMissing(draft: StoryboardDraft, input: StoryboardInput, count: number, facts: string, signal?: AbortSignal): Promise<StoryboardDraft> {
  const need = count - draft.scenes.length;
  if (need <= 0) return draft;
  const role = input.protagonist ? "hero" : "teller";
  const soFar = draft.scenes.map((s, i) => `${i + 1}. ${s.narration}`).join("\n");
  const prompt =
    `The tale is unfinished. Write exactly ${need} new parts, continuing from part ${draft.scenes.length}. ` +
    `Part ${count} must answer the question opened in part 1. ` +
    `Each new part follows the previous by THEREFORE or BUT. The ${role} decides, and the next part shows the consequence. ` +
    `Do not repeat an earlier beat. Spoken language: ${input.langName}. moment and depiction in English only. ` +
    genreRule(input.genre ?? "", role) +
    (facts ? `Facts you may use: ${facts}. ` : "") +
    `Return ONLY JSON {"parts":[{"narration":"","moment":"","depiction":""}]} with exactly ${need} parts.\n\nTITLE: ${draft.title}\nSO FAR:\n${soFar}`;
  let more: StorySceneDraft[] = [];
  try {
    const r = await chat(prompt, "flash", signal, Math.min(16000, 2000 + 1200 * need), undefined, 0.7, true);
    const parsed = extractJson(String(r.text ?? "")) as { parts?: unknown; scenes?: unknown };
    const list = Array.isArray(parsed.parts) ? parsed.parts : parsed.scenes;
    more = scenesFromList(list, need);
  } catch {
    more = [];
  }
  if (more.length < need) throw new RobinError("the story came back short — please try again");
  return { ...draft, scenes: [...draft.scenes, ...more].slice(0, count) };
}

export async function generateStoryboard(input: StoryboardInput, signal?: AbortSignal): Promise<StoryboardDraft> {
  const count = clampScenes(input.scenes);
  const genre = input.genre ?? "";
  const base = storyboardPrompt(input.topic, count, input.langName, input.character, input.aspect, input.persona ?? "", input.design ?? "", input.styleLabel ?? "", input.protagonist ?? null, input.styleAnchor ?? "", genre, "");
  let draft = await askBoard(base, input.topic, count, signal);
  if (draft.scenes.length < count) draft = await fillMissing(draft, input, count, "", signal);
  return ensureEnglish(draft, signal);
}

// ------------------------------------------------------------------- image

async function fetchRef(url: string, signal?: AbortSignal): Promise<Blob | null> {
  try {
    const r = await fetch(url, { signal });
    if (!r.ok) return null;
    const b = await r.blob();
    return b.type.startsWith("image/") ? b : null;
  } catch {
    return null;
  }
}

export type SceneImage = { url: string; dataUrl: string | null; resolution: string | null; largeUrl: string | null; refAttached: boolean };

export const IMAGE_SIZES = ["512px", "1K", "2K", "4K"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export async function generateSceneImage(
  imagePrompt: string,
  styleLabel: string,
  aspect: AspectRatio = "16:9",
  opts?: { raw?: boolean; signal?: AbortSignal; refs?: (string | Blob)[]; imageSize?: string; anchor?: string },
): Promise<SceneImage> {
  const safety = `Strictly no readable text, no letters, no numbers, no signs, no logos, no watermarks, no borders, no extra limbs, no deformed faces.`;
  // Sketch styles get the story_maker2 treatment: hard photo/cine/3D bans
  // plus a mandatory print-sketch closer, or the model drifts to Pixar.
  const sketchTail = isHandDrawing(styleLabel) ? ` ${SKETCH_BANS}. End with exactly: "${SKETCH_CLOSER}".` : "";
  // raw = the AI's own depiction, sent as written (only the safety net added).
  // Otherwise the moment is expanded with the locked style + aspect + detailing.
  // The wrapper leads with medium fidelity so a sketch never drifts into 3D.
  // anchor = the style's rich English prompt (falls back to the display label).
  const styleText = opts?.anchor?.trim() || styleLabel;
  const body = opts?.raw
    ? `${imagePrompt}`
    : (
        `Artwork in this exact style: ${styleText}. Composed as ${aspectFrame(aspect)}. ` +
        `Moment: ${imagePrompt}. ` +
        `Render faithfully in this exact medium and look — match its linework, texture, flatness and palette; ` +
        `never drift into photorealism, 3D or cinematic rendering. ` +
        `Depict the moment with clear readable shapes and setting detail suited to the medium, mood-appropriate lighting, ` +
        `a balanced rule-of-thirds composition with one clear focal point, natural depth and layered background elements that tell the story; ` +
        `coherent anatomy and proportions, expressive faces, consistent character design — same face, outfit, colors and props in every scene; ` +
        `keep the teller identical in every scene: same face, same outfit, same colors, same props, only the pose, gesture and framing change; ` +
        `candid yet composed framing, authentic atmosphere and mood. `
      );
  // References go inline as input content items (official interactions shape:
  // {type:"image", mime_type, data} + {type:"text", text}). A top-level
  // reference_images field is silently ignored — identity is lost that way.
  const refItems: { type: string; mime_type: string; data: string }[] = [];
  for (const ref of opts?.refs ?? []) {
    let blob: Blob | null = null;
    if (typeof ref !== "string") {
      blob = ref;
    } else if (ref.startsWith("data:")) {
      // Previous scenes are base64 before their R2 upload — decode directly,
      // fetch(data:) is blocked by CSP connect-src.
      try {
        blob = dataUrlToBlob(ref);
      } catch {
        blob = null;
      }
    } else {
      blob = await fetchRef(ref, opts?.signal);
    }
    if (!blob) continue;
    // Shrink refs (character portraits can be multi-MB): small payloads,
    // no stack pressure, identity unaffected.
    blob = await shrinkForRef(blob);
    const url = await blobToDataUrl(blob);
    const comma = url.indexOf(",");
    refItems.push({
      type: "image",
      mime_type: url.slice(url.indexOf(":") + 1, url.indexOf(";")) || blob.type || "image/png",
      data: url.slice(comma + 1),
    });
    if (refItems.length >= 4) break;
  }
  const refNote = refItems.length ? `Use the attached reference image as the FULL visual reference — render in the same art style and medium, with matching linework, texture, color palette, lighting mood and background treatment, so the new frame looks like it comes from the same film. Keep the teller's design identical (same face, outfit, colors and props). The reference fixes IDENTITY and STYLE ONLY — never copy its camera angle, camera position, framing or where the teller stands in the frame. Pose, gesture, camera angle, camera position, screen placement and framing must follow the moment description instead and must differ visibly from the reference, especially the moment's Camera directive which always overrides the reference. Never render photorealistic or 3D unless the reference itself is. ` : "";
  const prompt = `${refNote}${body} ${safety}${sketchTail}`;
  const size = (IMAGE_SIZES as readonly string[]).includes(opts?.imageSize ?? "") ? (opts?.imageSize as ImageSize) : "2K";
  // Proven by live test: at 512px the router drops input images entirely
  // (reference AND prompt ignored). 1K and up honor them — force minimum 1K.
  const effectiveSize = size === "512px" && refItems.length ? ("1K" as ImageSize) : size;
  const payload = {
    model: "gemini-3.1-flash-image",
    input: refItems.length ? [...refItems, { type: "text", text: prompt }] : prompt,
    response_format: {
      type: "image",
      mime_type: "image/jpeg",
      aspect_ratio: aspect,
      image_size: effectiveSize,
    },
    generation_config: {
      thinking_level: "minimal",
    },
  };
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2000 * attempt);
    const r = await geminiFetch("/v1beta/interactions", payload, opts?.signal);
    if (r.ok) {
      const d = (await r.json()) as {
        output_image?: { data?: string };
        steps?: { type?: string; content?: { type?: string; data?: string }[] }[];
        error?: { message?: string } | string;
      };
      let b64 = d.output_image?.data || "";
      if (!b64 && Array.isArray(d.steps)) {
        for (const step of d.steps) {
          if (step.type === "model_output" && Array.isArray(step.content)) {
            for (const blk of step.content) {
              if (blk.type === "image" && blk.data) {
                b64 = blk.data;
                break;
              }
            }
          }
          if (b64) break;
        }
      }
      if (!b64) {
        // Fallback to native :generateContent if interactions returns no image block
        const fb = await geminiFetch(
          "/v1beta/models/gemini-3.1-flash-image:generateContent",
          {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } },
          },
          opts?.signal,
        );
        if (fb.ok) {
          const fd = (await fb.json()) as { candidates?: { content?: { parts?: GenPart[] } }[] };
          b64 = fd.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
        }
      }
      if (!b64) {
        const errStr = typeof d.error === "string" ? d.error : d.error?.message;
        throw new RobinError(errStr || "image service came back empty");
      }
      const mime = b64.startsWith("/9j/") ? "image/jpeg" : b64.startsWith("iVBOR") ? "image/png" : "image/jpeg";
      const url = `data:${mime};base64,${b64}`;
      return { url, dataUrl: url, resolution: effectiveSize, largeUrl: url, refAttached: refItems.length > 0 };
    }
    lastError = await errorMessage(r, `image service answered ${r.status}`);
    if (!retryable(r.status, lastError)) throw new RobinError(lastError, r.status);
  }
  throw new RobinError(lastError || "image service is busy — retry", 400);
}

// --------------------------------------------------------------------- video

export type SceneVideo = { url: string; dataUrl: string };

export const VIDEO_RESOLUTIONS = ["360p", "720p", "1080p"] as const;
export const VIDEO_DURATIONS = [3, 5, 8, 10] as const;

export async function generateSceneVideo(
  ref: Blob | null,
  prompt: string,
  aspect: AspectRatio = "16:9",
  opts?: { resolution?: string; duration?: number; signal?: AbortSignal },
): Promise<SceneVideo> {
  const resolution = (VIDEO_RESOLUTIONS as readonly string[]).includes(opts?.resolution ?? "") ? (opts?.resolution as string) : "360p";
  const seconds = (VIDEO_DURATIONS as readonly number[]).includes(opts?.duration ?? 0) ? (opts?.duration as number) : 3;
  let interactionsInput: unknown = prompt;
  if (ref) {
    const url = await blobToDataUrl(ref);
    const comma = url.indexOf(",");
    const finalPrompt =
      !prompt.includes("<IMAGE_REF_") && !prompt.includes("<FIRST_FRAME>")
        ? `${prompt} [# References <IMAGE_REF_0>@Image1]`
        : prompt;
    interactionsInput = [
      {
        type: "image",
        mime_type: url.slice(url.indexOf(":") + 1, url.indexOf(";")) || ref.type || "image/png",
        data: url.slice(comma + 1),
      },
      { type: "text", text: finalPrompt },
    ];
  }
  const payload = {
    model: "gemini-omni-1.1-flash",
    input: interactionsInput,
    response_format: {
      type: "video",
      aspect_ratio: aspect,
      resolution,
      duration: `${seconds}s`,
    },
    generation_config: {
      video_config: {
        task: ref ? "image_to_video" : "text_to_video",
      },
    },
  };
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2000 * attempt);
    const r = await geminiFetch("/v1beta/interactions", payload, opts?.signal);
    if (r.ok) {
      const d = (await r.json()) as {
        output_video?: { data?: string; uri?: string };
        steps?: { type?: string; content?: { type?: string; data?: string; uri?: string }[] }[];
        error?: { message?: string } | string;
      };
      let b64 = d.output_video?.data || "";
      let videoUri = d.output_video?.uri || "";
      if (!b64 && !videoUri && Array.isArray(d.steps)) {
        for (const step of d.steps) {
          if (step.type === "model_output" && Array.isArray(step.content)) {
            for (const blk of step.content) {
              if (blk.type === "video") {
                if (blk.data) b64 = blk.data;
                if (blk.uri) videoUri = blk.uri;
                break;
              }
            }
          }
          if (b64 || videoUri) break;
        }
      }
      if (!b64 && videoUri) {
        const vr = await fetch(videoUri, { signal: opts?.signal });
        if (vr.ok) {
          const vblob = await vr.blob();
          const dataUrl = await blobToDataUrl(vblob);
          return { url: dataUrl, dataUrl };
        }
      }
      if (!b64) {
        const errStr = typeof d.error === "string" ? d.error : d.error?.message;
        throw new RobinError(errStr || "video service came back empty");
      }
      const url = `data:video/mp4;base64,${b64}`;
      return { url, dataUrl: url };
    }
    lastError = await errorMessage(r, `video service answered ${r.status}`);
    if (!retryable(r.status, lastError)) throw new RobinError(lastError, r.status);
  }
  throw new RobinError(lastError || "video service is busy — retry", 400);
}

// --------------------------------------------------------------------- TTS

type TokenCache = { token: string; model: string; voices: Record<string, RobinVoice>; at: number };
let tokenOnlyCache: TokenCache | null = null;

export async function ttsToken(signal?: AbortSignal): Promise<TokenCache> {
  if (tokenOnlyCache && Date.now() - tokenOnlyCache.at < 45 * 60 * 1000) return tokenOnlyCache;
  const auth = await getDirectAuth(signal);
  const bearer = (auth.headers.Authorization || "").replace(/^Bearer\s+/i, "");
  tokenOnlyCache = { token: bearer, model: "gemini-3.8-flash-tts", voices: GEMINI_STUDIO_VOICES, at: Date.now() };
  return tokenOnlyCache;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** data: URL -> Blob without fetch() (fetch(data:) is blocked by CSP connect-src). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const head = dataUrl.slice(0, dataUrl.indexOf(","));
  const mime = head.slice(head.indexOf(":") + 1, head.indexOf(";")) || "application/octet-stream";
  return new Blob([base64ToBytes(dataUrl.slice(dataUrl.indexOf(",") + 1)) as BlobPart], { type: mime });
}


function blobToDataUrl(blob: Blob): Promise<string> {
  // FileReader, not spread/btoa: zero stack risk on multi-MB blobs.
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error("encode failed"));
    fr.readAsDataURL(blob);
  });
}

/** Shrink a reference image (longest side 1024, JPEG) — refs don't need full size. */async function shrinkForRef(blob: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
      if (scale >= 1 && blob.size <= 700_000) return blob;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return blob;
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return (await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85))) ?? blob;
    } finally {
      bmp.close();
    }
  } catch {
    return blob;
  }
}

const VIDEO_FRAME_WIDTHS: Record<string, number> = { "360p": 640, "720p": 1280, "1080p": 1920 };

/** Exact video frame dims for an aspect + quality tier. */
export function videoFrameSize(aspect: AspectRatio, resolution: string): [number, number] {
  const w = VIDEO_FRAME_WIDTHS[resolution] ?? 640;
  const [aw, ah] = aspect.split(":").map(Number);
  return [w, Math.round((w * (ah || 9)) / (aw || 16))];
}

/** Cover-crop an image blob to exact W×H so ref and video frames match precisely. */
export async function fitToFrame(blob: Blob, width: number, height: number): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    try {
      const s = Math.max(width / bmp.width, height / bmp.height);
      const dw = bmp.width * s;
      const dh = bmp.height * s;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return blob;
      ctx.drawImage(bmp, (width - dw) / 2, (height - dh) / 2, dw, dh);
      return (await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92))) ?? blob;
    } finally {
      bmp.close();
    }
  } catch {
    return blob;
  }
}

export type CaptionWord = { text: string; start: number; end: number };
export type SceneAudio = { dataUrl: string; seconds: number; captions: CaptionWord[] };

/**
 * Pause tags are translated to punctuation the TTS model reliably renders
 * as silence. All other markup tags ([sigh], [laughing], [whispering], …)
 * are passed through untouched — test new tags once before bulk use,
 * an untested tag can end up spoken aloud.
 */
export function applyPauseTags(text: string): string {
  return text
    .replace(/\[\s*long pause\s*\]/gi, "… ")
    .replace(/\[\s*medium pause\s*\]/gi, ". ")
    .replace(/\[\s*short pause\s*\]/gi, ", ");
}

export const TTS_MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"] as const;

function pcmToWav(pcmData: Uint8Array, sampleRate = 24000, channels = 1, bitsPerSample = 16): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcmData.length;

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  const wav = new Uint8Array(44 + dataSize);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcmData, 44);
  return wav;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function parseOffsetSeconds(offsetStr?: string): number {
  if (!offsetStr) return 0;
  const num = parseFloat(String(offsetStr).replace("s", ""));
  return Number.isNaN(num) ? 0 : Math.round(num * 1000) / 1000;
}

async function transcribeDirect(audioBase64: string, mimeType = "audio/wav", signal?: AbortSignal): Promise<CaptionWord[]> {
  try {
    const r = await geminiFetch(
      "/v1beta/interactions",
      {
        model: "gemini-3.5-transcribe",
        input: [{ type: "audio", mime_type: mimeType, data: audioBase64 }],
        generation_config: {
          transcription_config: {
            mode: {
              type: "verbatim",
              timestamp_granularities: ["word"],
            },
          },
        },
      },
      signal,
    );
    if (!r.ok) return [];
    const rawData = (await r.json()) as {
      steps?: {
        content?: {
          text?: string;
          annotations?: { type?: string; text?: string; start_offset?: string; end_offset?: string }[];
        }[];
      }[];
    };
    const words: CaptionWord[] = [];
    for (const step of rawData.steps ?? []) {
      for (const cnt of step.content ?? []) {
        for (const ann of cnt.annotations ?? []) {
          if ((ann.type === "word_info" || ann.text) && typeof ann.text === "string" && ann.text.trim()) {
            words.push({
              text: ann.text.trim(),
              start: parseOffsetSeconds(ann.start_offset),
              end: parseOffsetSeconds(ann.end_offset),
            });
          }
        }
      }
    }
    return words;
  } catch {
    return [];
  }
}

export async function synthesizeNarration(
  text: string,
  voiceName: string,
  opts?: { style?: string; signal?: AbortSignal; model?: string; withCaptions?: boolean },
): Promise<SceneAudio> {
  const signal = opts?.signal;
  const clean = applyPauseTags(text).replace(/\s+/g, " ").trim().slice(0, 900);
  if (!clean) throw new RobinError("empty narration");
  const style = opts?.style?.trim();
  const model = (TTS_MODELS as readonly string[]).includes(opts?.model ?? "") ? (opts?.model as string) : TTS_MODELS[0];
  const canonicalVoice = voiceName ? voiceName.charAt(0).toUpperCase() + voiceName.slice(1).toLowerCase() : "Kore";

  const annotations = style ? [{ type: "speech_metadata", style }] : undefined;
  const interactionsPayload = {
    model,
    input: [
      {
        type: "user_input",
        content: [
          {
            type: "text",
            text: clean,
            ...(annotations ? { annotations } : {}),
          },
        ],
      },
    ],
    response_format: { type: "audio" },
    generation_config: {
      speech_config: [{ voice: canonicalVoice }],
    },
  };

  let b64 = "";
  const r = await geminiFetch("/v1beta/interactions", interactionsPayload, signal);
  if (r.ok) {
    const d = (await r.json()) as {
      steps?: { type?: string; content?: { type?: string; data?: string }[] }[];
    };
    for (const step of d.steps ?? []) {
      if (step.type === "model_output") {
        for (const blk of step.content ?? []) {
          if (blk.type === "audio" && blk.data) {
            b64 = blk.data;
            break;
          }
        }
      }
      if (b64) break;
    }
  } else {
    // Fallback to :generateContent if interactions endpoint rejects the TTS model
    const fb = await geminiFetch(
      `/v1beta/models/${model}:generateContent`,
      {
        contents: [{ parts: [{ text: clean }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: canonicalVoice } } },
        },
      },
      signal,
    );
    if (!fb.ok) throw new RobinError(await errorMessage(r, `narration service answered ${r.status}`), r.status);
    const fd = (await fb.json()) as { candidates?: { content?: { parts?: GenPart[] } }[] };
    const rawPcmB64 = fd.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
    if (rawPcmB64) {
      const wavBytes = pcmToWav(base64ToBytes(rawPcmB64), 24000);
      b64 = bytesToBase64(wavBytes);
    }
  }

  if (!b64) throw new RobinError("narration came back empty");
  let bytes = base64ToBytes(b64);
  // Ensure RIFF WAV header if raw PCM came back
  if (bytes.length > 4 && !(bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46)) {
    bytes = pcmToWav(bytes, 24000);
    b64 = bytesToBase64(bytes);
  }

  const captions = opts?.withCaptions === false ? [] : await transcribeDirect(b64, "audio/wav", signal);
  return { dataUrl: `data:audio/wav;base64,${b64}`, seconds: wavSeconds(bytes), captions };
}

/** Duration from a WAV byte buffer (walks chunks, falls back to 24k mono16). */
function wavSeconds(bytes: Uint8Array): number {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const rate = v.getUint32(24, true) || 24000;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      const size = v.getUint32(offset + 4, true);
      if (id === "data") {
        const ch = v.getUint16(22, true) || 1;
        const bits = v.getUint16(34, true) || 16;
        if (!rate || !ch || !bits) return 5;
        return Math.max(1, Math.round((size / (rate * ch * (bits / 8))) * 10) / 10);
      }
      if (size <= 0) break;
      offset += 8 + size;
    }
    return Math.max(1, Math.round((bytes.length / (rate * 2)) * 10) / 10);
  } catch {
    return 5;
  }
}

export function estimateSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.round((words / 2.25) * 10) / 10);
}

export const ROBIN_PREVIEW_LINE = "Halo! Aku narator ceritamu. Duduk yang nyaman, dan dengarkan kisah yang tak terlupakan.";

/** Fresh kids-story topic ideas, grounded on current trends via Google Search. */
export async function suggestTopics(count = 20, exclude: string[] = [], signal?: AbortSignal): Promise<string[]> {
  const nonce = Math.floor(Math.random() * 1_000_000);
  const avoid = exclude
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(-80);
  const r = await chat(
    `Suggest ${count} short, catchy topics for a kids' narrated picture story in Indonesia, following what is trending and in season right now, ` +
      `all different from each other, spanning animals, space, ocean, science, history, food and everyday wonders. ` +
      (avoid.length ? `Do NOT repeat any of these: ${avoid.join(" | ")}. ` : ``) +
      `Return ONLY a JSON array of strings, no other text. (batch #${nonce})`,
    "flash",
    signal,
    3000,
    [{ googleSearch: {} }],
  );
  let arr: unknown;
  try {
    arr = extractJsonArray(String(r.text ?? ""));
  } catch {
    arr = [];
  }
  let out = (Array.isArray(arr) ? arr : []).map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, count);
  if (!out.length) {
    // Fallback: one idea per non-empty line.
    out = String(r.text ?? "")
      .split("\n")
      .map((l) => l.replace(/^[\s*\d.)\-•]+/, "").trim())
      .filter((l) => l.length > 3)
      .slice(0, count);
  }
  if (!out.length) throw new RobinError("the idea service came back empty");
  return out;
}

const auditionCache = new Map<string, string>();

/** Synthesized previews, cached in memory per voice+text. */
export async function auditionRobinVoice(voiceId: string, text: string): Promise<string> {
  const key = `${voiceId}|${text}`;
  const hit = auditionCache.get(key);
  if (hit) return hit;
  const r = await synthesizeNarration(text, voiceId, { withCaptions: false });
  auditionCache.set(key, r.dataUrl);
  return r.dataUrl;
}
