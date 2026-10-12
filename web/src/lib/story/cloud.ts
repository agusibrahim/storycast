import { SHARE_API } from "@/lib/share";
import type { AspectRatio } from "./robin";
import type { ImageSource, StoryProject } from "./project";

export const CLOUD = Boolean(SHARE_API);

const OWNERS_KEY = "storycast-story-owners";

function readOwners(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(OWNERS_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export const cloudOwner = (id: string): string | null => readOwners()[id] ?? null;

export function saveCloudOwner(id: string, owner: string) {
  try {
    const all = readOwners();
    all[id] = owner;
    localStorage.setItem(OWNERS_KEY, JSON.stringify(all));
  } catch {}
}

export function forgetCloudOwner(id: string) {
  try {
    const all = readOwners();
    delete all[id];
    localStorage.setItem(OWNERS_KEY, JSON.stringify(all));
  } catch {}
}

async function call<T>(path: string, init: RequestInit = {}, owner?: string | null, timeoutMs = 30000): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(new Error("cloud request timed out")), timeoutMs);
  let r: Response;
  try {
    r = await fetch(`${SHARE_API}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { "content-type": "application/json", ...(owner ? { authorization: `Owner ${owner}` } : {}), ...(init.headers || {}) },
    });
  } catch (e) {
    // Bare TypeError/DOMException ("Failed to fetch", timeout abort): the
    // response never arrived — edge rejection, extension block, timeout.
    if (e instanceof TypeError || (e instanceof DOMException && e.name === "AbortError")) {
      throw new Error("request blocked before reaching the server (edge rejection, adblocker, timeout, or dropped connection) — retrying");
    }
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
  const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const e = new Error(String(d.error || `cloud request failed (${r.status})`)) as Error & { status?: number };
    e.status = r.status;
    throw e;
  }
  return d as T;
}

// ------------------------------------------------------------ write queue
// Every cloud write (PATCH + media) goes through ONE fifo per tab, so this
// browser never races itself. The server still retries on cross-tab 409s.
let cloudQueue: Promise<unknown> = Promise.resolve();
let pendingWrites = 0;
/** In-flight cloud writes — the studio warns before unload while > 0. */
export const cloudPending = () => pendingWrites;
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = cloudQueue.then(
    async () => {
      pendingWrites++;
      try {
        return await fn();
      } finally {
        pendingWrites--;
      }
    },
    async () => {
      pendingWrites++;
      try {
        return await fn();
      } finally {
        pendingWrites--;
      }
    },
  );
  cloudQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Retry transient conflicts (409) and server/network blips — never 4xx. */
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const st = (e as { status?: number })?.status;
      const transient = st === 409 || st === 429 || (typeof st === "number" && st >= 500) || st === undefined;
      if (!transient || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1) + Math.random() * 300));
    }
  }
  throw last;
}

const sceneText = (p: StoryProject) =>
  p.scenes.map((s) => ({
    narration: s.narration,
    imagePrompt: s.imagePrompt,
    aiImagePrompt: s.aiImagePrompt,
    imageSource: s.imageSource,
    refScenes: s.refScenes,
    audioSeconds: s.audioSeconds,
    captions: Array.isArray(s.captions) ? s.captions.slice(0, 400) : null,
    quality: s.imageQuality,
    voiceModel: s.voiceModel,
    videoRes: s.videoRes,
    videoDur: s.videoDur,
  }));

export async function createCloudStory(p: StoryProject): Promise<{ id: string; owner: string }> {
  const r = await call<{ id: string; owner: string }>("/api/stories", {
    method: "POST",
    body: JSON.stringify({
      id: p.id,
      project: {
        title: p.title,
        subtitle: p.subtitle,
        topic: p.topic,
        style: p.style,
        styleLabel: p.styleLabel,
        lang: p.lang,
        langName: p.langName,
        voice: p.voice,
        voiceStyle: p.voiceStyle,
        aspect: p.aspect,
        characterRef: p.characterRef,
        posterPrompt: p.posterPrompt,
        genre: p.genre,
        musicTitle: p.musicTitle,
        scenes: sceneText(p),
      },
    }),
  });
  saveCloudOwner(r.id, r.owner);
  return { id: r.id, owner: r.owner };
}

export async function patchCloudStory(p: StoryProject, owner: string): Promise<void> {
  await enqueue(() => withRetry(() => call(`/api/stories/${p.id}`, { method: "PATCH", body: JSON.stringify(patchBody(p)) }, owner)));
}

/** Best-effort flush when the tab hides/closes (keepalive, no response read). */
export function flushCloudStory(p: StoryProject, owner: string) {
  try {
    fetch(`${SHARE_API}/api/stories/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Owner ${owner}` },
      body: JSON.stringify(patchBody(p)),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

function patchBody(p: StoryProject) {
  return {
    title: p.title,
    subtitle: p.subtitle,
    voice: p.voice,
    voiceStyle: p.voiceStyle,
    posterPrompt: p.posterPrompt,
    genre: p.genre,
    musicTitle: p.musicTitle,
    scenes: sceneText(p),
  };
}

export type CloudSummary = {
  id: string;
  title: string;
  subtitle: string;
  topic: string;
  style_label: string;
  lang: string;
  voice: string;
  aspect: string;
  scene_count: number;
  images: number;
  audios: number;
  duration: number;
  created: number;
  updated: number;
  thumb: string | null;
};

export const listCloudStories = () => call<{ stories: CloudSummary[] }>("/api/stories").then((d) => d.stories);

type CloudScene = {
  index: number;
  narration: string;
  imagePrompt: string;
  aiImagePrompt: string;
  imageSource: ImageSource;
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

const uid = () => Math.random().toString(36).slice(2, 10);

export async function loadCloudStory(id: string): Promise<StoryProject> {
  const d = await call<{ story: {
    id: string; title: string; subtitle: string; topic: string; style: string; style_label: string;
    lang: string; lang_name: string; voice: string; voice_style: string; aspect: AspectRatio;
    character_ref: string; poster_prompt: string; poster_h: string | null; poster_v: string | null; genre: string;
    music_title: string; music_url: string | null;
    created: number; updated: number; scenes: CloudScene[];
  } }>(`/api/stories/${id}`);
  const s = d.story;
  return {
    id: s.id,
    title: s.title,
    subtitle: s.subtitle,
    topic: s.topic,
    style: s.style,
    styleLabel: s.style_label,
    // The anchor isn't stored server-side — reloaded stories fall back to the label.
    styleAnchor: "",
    // Regenerate inputs aren't stored server-side either (narrator mode works, protagonist loses specifics).
    storyMode: "narrator",
    protagonist: null,
    charName: "",
    persona: "",
    design: "",
    lang: s.lang,
    langName: s.lang_name,
    voice: s.voice,
    voiceStyle: s.voice_style,
    sceneCount: s.scenes.length,
    aspect: s.aspect,
    characterRef: s.character_ref,
    genre: s.genre || "edukasi",
    musicTitle: s.music_title || "",
    musicUrl: s.music_url,
    posterPrompt: s.poster_prompt,
    posterH: s.poster_h,
    posterV: s.poster_v,
    posterStatus: s.poster_h || s.poster_v ? "ready" as const : "idle" as const,
    posterError: "",
    created: s.created,
    scenes: s.scenes.map((x, i) => ({
      id: uid(),
      index: i,
      narration: x.narration,
      imagePrompt: x.imagePrompt,
      aiImagePrompt: x.aiImagePrompt,
      imageSource: x.imageSource === "ai" ? "ai" : "moment",
    refScenes: Array.isArray(x.refScenes) && x.refScenes.length
      ? x.refScenes.filter((k) => Number.isInteger(k) && k >= 0).slice(0, 8)
      : Number.isInteger(x.refScene) && (x.refScene as number) >= 0
        ? [x.refScene as number]
        : null,
    refUsed: null,
    imageQuality: x.quality || "2K",
    voiceModel: x.voiceModel || "gemini-3.8-flash-tts",
    videoUrl: x.video,
    videoStatus: x.video ? ("ready" as const) : ("idle" as const),
    videoError: "",
    videoRes: x.videoRes || "360p",
    videoDur: x.videoDur || 3,
      refFailed: false,
      imageLargeReady: !!x.imageLarge,
      imageLargeUrl: x.imageLarge,
      imageUrl: x.image,
      audioUrl: x.audio,
      audioSeconds: x.audioSeconds,
      captions: Array.isArray(x.captions)
        ? x.captions
            .filter((w) => w && typeof w.text === "string" && w.text.trim())
            .map((w) => ({ text: String(w.text).trim(), start: Number(w.start) || 0, end: Number(w.end) || 0 }))
            .slice(0, 400)
        : null,
      imageStatus: x.image ? "ready" as const : "idle" as const,
      audioStatus: x.audio ? "ready" as const : "idle" as const,
      imageError: "",
      audioError: "",
    })),
  };
}

export async function deleteCloudStory(id: string, owner: string): Promise<void> {
  await call(`/api/stories/${id}`, { method: "DELETE" }, owner);
  forgetCloudOwner(id);
}

export type CloudMedia = {
  scenes: { image: string | null; imageLarge: string | null; audio: string | null; video: string | null }[];
  posterH: string | null;
  posterV: string | null;
};

/** Media URLs only (keys), to rehydrate a locally-stripped project. */
export async function refreshCloudMedia(id: string): Promise<CloudMedia | null> {
  try {
    const d = await call<{ story: {
      poster_h: string | null; poster_v: string | null;
      scenes: { image: string | null; imageLarge: string | null; audio: string | null; video: string | null }[];
    } }>(`/api/stories/${id}`);
    return {
      scenes: d.story.scenes.map((s) => ({ image: s.image, imageLarge: s.imageLarge, audio: s.audio, video: s.video })),
      posterH: d.story.poster_h,
      posterV: d.story.poster_v,
    };
  } catch {
    return null;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export type MediaKind = "image" | "image-large" | "audio" | "video" | "music";
export type AdoptKind = "image" | "image-large" | "audio" | "video";

/**
 * Re-link a file that reached R2 but lost its DB reference. Returns null when
 * no saved file exists (404) — that scene genuinely needs regenerating.
 */
export async function adoptCloudMedia(id: string, owner: string, scene: number, kind: AdoptKind): Promise<{ url: string; adopted: boolean } | null> {
  try {
    return await call<{ url: string; adopted: boolean }>(`/api/stories/${id}/adopt`, {
      method: "POST",
      body: JSON.stringify({ scene, kind }),
    }, owner);
  } catch (e) {
    if ((e as { status?: number })?.status === 404) return null;
    throw e;
  }
}

export async function uploadCloudMedia(id: string, owner: string, scene: number, kind: MediaKind, blob: Blob): Promise<string> {
  // Videos ride as raw binary (streams server-side, near-zero CPU). Base64
  // JSON of a 20MB mp4 kills the worker with a CPU-limit 503 — see t503test.
  if (kind === "video") {
    const r = await enqueue(() =>
      withRetry(async () => {
        const ctrl = new AbortController();
        // Large streaming PUTs can stall mid-body — cap it so the write
        // queue (and every autosave behind it) can never wedge forever.
        const timer = window.setTimeout(() => ctrl.abort(new Error("video upload timed out")), 120000);
        let res: Response;
        try {
          res = await fetch(`${SHARE_API}/api/stories/${id}/media?scene=${scene}&kind=${encodeURIComponent(kind)}`, {
            method: "POST",
            headers: { "content-type": blob.type || "video/mp4", authorization: `Owner ${owner}` },
            body: blob,
            signal: ctrl.signal,
          } as RequestInit);
        } catch {
          throw new Error("upload blocked before reaching the server (edge rejection, adblocker, timeout, or dropped connection) — retrying");
        } finally {
          window.clearTimeout(timer);
        }
        const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          const e = new Error(String(d.error || `cloud request failed (${res.status})`)) as Error & { status?: number };
          e.status = res.status;
          throw e;
        }
        return d as { url: string };
      }),
    );
    return r.url;
  }
  const data = await blobToDataUrl(blob);
  const r = await enqueue(() =>
    withRetry(() =>
      call<{ url: string }>(`/api/stories/${id}/media`, {
        method: "POST",
        body: JSON.stringify({ scene, kind, contentType: blob.type || "application/octet-stream", data }),
      }, owner),
    ),
  );
  return r.url;
}

export async function uploadCloudPoster(id: string, owner: string, which: "h" | "v", blob: Blob): Promise<string> {
  const data = await blobToDataUrl(blob);
  const r = await enqueue(() =>
    withRetry(() =>
      call<{ url: string }>(`/api/stories/${id}/poster`, {
        method: "POST",
        body: JSON.stringify({ which, contentType: blob.type || "image/jpeg", data }),
      }, owner),
    ),
  );
  return r.url;
}

/** Downscale an image blob so the longest side fits maxDim (JPEG). */
export async function downscale(blob: Blob, maxDim = 768): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    if (scale >= 1 && blob.type !== "image/png") return blob;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    return out ?? blob;
  } finally {
    bmp.close();
  }
}

// ------------------------------------------------------- character catalog
// Global, no auth. Images (thumb/hero/sheet) live in R2.

export type CloudCharacter = {
  id: string;
  name: string;
  personality: string;
  group: string;
  style: string;
  style_label: string;
  traits: string;
  pronoun: string;
  voice: { voice_id: string; name: string; gender: string; age: string; accent: string; description: string };
  thumb: string;
  hero: string;
  sheet: string;
  created: number;
  updated: number;
};

export type CharacterInput = {
  id?: string;
  name: string;
  personality: string;
  group: string;
  style: string;
  styleLabel: string;
  traits: string;
  pronoun: string;
  voice: CloudCharacter["voice"];
  sort?: number;
};

export const listCharacters = () => call<{ characters: CloudCharacter[] }>("/api/characters").then((d) => d.characters);

export async function createCharacter(input: CharacterInput): Promise<CloudCharacter> {
  const d = await call<{ character: CloudCharacter }>("/api/characters", { method: "POST", body: JSON.stringify(input) });
  return d.character;
}

export async function patchCharacter(id: string, input: Partial<CharacterInput>): Promise<CloudCharacter> {
  const d = await call<{ character: CloudCharacter }>(`/api/characters/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  return d.character;
}

export async function deleteCharacter(id: string): Promise<void> {
  await call(`/api/characters/${id}`, { method: "DELETE" });
}

export async function uploadCharacterImage(id: string, kind: "thumb" | "hero" | "sheet", file: File | Blob): Promise<string> {
  const data = await blobToDataUrl(file);
  const d = await call<{ url: string }>(`/api/characters/${id}/images`, {
    method: "POST",
    body: JSON.stringify({ kind, contentType: file.type || "image/jpeg", data }),
  });
  return d.url;
}
