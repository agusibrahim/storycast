import { estimateSeconds, dataUrlToBlob, type AspectRatio, type StoryboardDraft } from "./robin";

export type SceneStatus = "idle" | "working" | "ready" | "error";
export type ImageSource = "moment" | "ai";

export type StoryScene = {
  id: string;
  index: number;
  narration: string;
  imagePrompt: string;
  /** The AI's own depiction from the storyboard JSON. */
  aiImagePrompt: string;
  /** Which text is sent on (re)generate: moment+style wrapper, or AI depiction raw. */
  imageSource: ImageSource;
  /**
   * Explicit reference scene (0-based index) whose generated image is sent as
   * visual reference. null = auto: the previous scene, when it has an image.
   * Scene 1 instead uses characterRef.
   */
  /**
   * Explicit reference scenes (0-based). null = Auto: previous generated scene.
   * Non-empty = manual checklist (min 1 enforced by UI).
   */
  refScenes: number[] | null;
  /** What reference was actually attached at the last successful generate. */
  refUsed: string | null;
  /** Per-scene render quality (512px/1K/2K/4K). */
  imageQuality: string;
  /** Per-scene TTS model. */
  voiceModel: string;
  /** Per-scene video render (mp4 object/R2 URL, never base64 in storage). */
  videoUrl: string | null;
  videoStatus: SceneStatus;
  videoError: string;
  videoRes: string;
  videoDur: number;
  /**
   * True only when the last generate wanted a reference but the worker
   * got none (fetch failed). False/undefined = no evidence of failure —
   * including freshly loaded projects where history is unknown, so the
   * UI must NOT warn in that case.
   */
  refFailed?: boolean;
  /** Full-size file downloaded in the background (modal + zip). Not persisted. */
  imageLargeReady: boolean;
  /** Remote full-size URL (persisted) so export/modal can retry it later. */
  imageLargeUrl: string | null;
  imageUrl: string | null;
  audioUrl: string | null;
  audioSeconds: number | null;
  /** Word-level timings from the narration service (null until audio is generated). */
  captions: import("./robin").CaptionWord[] | null;
  imageStatus: SceneStatus;
  audioStatus: SceneStatus;
  imageError: string;
  audioError: string;
};

export type StoryProject = {
  id: string;
  title: string;
  subtitle: string;
  topic: string;
  style: string;
  styleLabel: string;
  /** Rich English style prompt (anchor) — sent to the image AI. Falls back to styleLabel. */
  styleAnchor: string;
  /** Regenerate support: how the script was born (local-only, never synced). */
  storyMode: "protagonist" | "narrator";
  protagonist: { gender: string; age: string; species: string } | null;
  charName: string;
  persona: string;
  design: string;
  lang: string;
  langName: string;
  voice: string;
  /** Voice direction = style prompt sent with every narration (lever 1). */
  voiceStyle: string;
  /** Number of scenes requested — sent to the AI so it returns exactly this many. */
  sceneCount: number;
  /** Cover prompt written by the story AI (may be empty on old projects). */
  posterPrompt: string;
  /** Display posters (base64 at first, R2 URL after background upload). */
  posterH: string | null;
  posterV: string | null;
  posterStatus: SceneStatus;
  posterError: string;
  /** Display format selected in the form; drives image composition + preview stage. */
  aspect: AspectRatio;
  genre: string;
  /** Background music (proxy URL at first, R2 URL after upload). */
  musicTitle: string;
  musicUrl: string | null;
  /** Character look reference (cast hero/thumb or uploaded portrait). Used for scene 1. */
  characterRef: string;
  created: number;
  scenes: StoryScene[];
};

const KEY = "storycast-image-stories";
const LAST_KEY = "storycast-story-id";

const uid = () => Math.random().toString(36).slice(2, 10);

export const DEFAULT_VOICE_STYLE = "Narrate warmly, like a friendly storyteller telling a tale to a curious friend";

export function projectFromDraft(
  draft: StoryboardDraft,
  meta: { topic: string; style: string; styleLabel: string; styleAnchor: string; storyMode: "protagonist" | "narrator"; protagonist: { gender: string; age: string; species: string } | null; charName: string; persona: string; design: string; lang: string; langName: string; voice: string; scenes: number; aspect: AspectRatio; characterRef: string; genre: string },
): StoryProject {
  return {
    id: uid(),
    title: draft.title || meta.topic,
    subtitle: draft.subtitle || "",
    topic: meta.topic,
    style: meta.style,
    styleLabel: meta.styleLabel,
    styleAnchor: meta.styleAnchor,
    storyMode: meta.storyMode,
    protagonist: meta.protagonist,
    charName: meta.charName,
    persona: meta.persona,
    design: meta.design,
    lang: meta.lang,
    langName: meta.langName,
    voice: meta.voice || "Kore",
    voiceStyle: DEFAULT_VOICE_STYLE,
    sceneCount: meta.scenes,
    aspect: meta.aspect,
    characterRef: meta.characterRef,
    genre: meta.genre || "edukasi",
    musicTitle: "",
    musicUrl: null,
    posterPrompt: draft.poster,
    posterH: null,
    posterV: null,
    posterStatus: "idle",
    posterError: "",
    created: Date.now() / 1000,
    scenes: draft.scenes.map((s, i) => ({
      id: uid(),
      index: i,
      narration: s.narration,
      imagePrompt: s.moment,
      aiImagePrompt: s.depiction,
      imageSource: "moment" as ImageSource,
      refScenes: null,
      refUsed: null as string | null,
      imageQuality: "2K",
      voiceModel: "gemini-3.8-flash-tts",
      videoUrl: null,
      videoStatus: "idle",
      videoError: "",
      videoRes: "360p",
      videoDur: 3,
      refFailed: false,
      imageLargeReady: false,
      imageLargeUrl: null,
      imageUrl: null,
      audioUrl: null,
      audioSeconds: null,
      captions: null,
      imageStatus: "idle",
      audioStatus: "idle",
      imageError: "",
      audioError: "",
    })),
  };
}

function readAll(): Record<string, StoryProject> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, StoryProject>;
  } catch {
    return {};
  }
}

export function saveProject(p: StoryProject) {
  try {
    const all = readAll();
    all[p.id] = p;
    localStorage.setItem(KEY, JSON.stringify(all));
    localStorage.setItem(LAST_KEY, p.id);
  } catch {
    // Quota exceeded (2K base64 images are MBs): persist text + remote URLs,
    // drop inline base64 so the project itself always survives reload.
    try {
      const all = readAll();
      all[p.id] = stripInlineBlobs(p);
      localStorage.setItem(KEY, JSON.stringify(all));
      localStorage.setItem(LAST_KEY, p.id);
    } catch {}
  }
}

const isInline = (u: string | null) => !!u && u.startsWith("data:");
const isDead = (u: string | null) => !!u && (u.startsWith("data:") || u.startsWith("blob:"));

/** Drop inline base64 media (kept in R2/cloud) so local save never blows quota. */
export function stripInlineBlobs(p: StoryProject): StoryProject {
  return {
    ...p,
    posterH: isInline(p.posterH) ? null : p.posterH,
    posterV: isInline(p.posterV) ? null : p.posterV,
    scenes: p.scenes.map((s) => ({
      ...s,
      imageUrl: isDead(s.imageUrl) ? null : s.imageUrl,
      imageLargeUrl: isDead(s.imageLargeUrl) ? null : s.imageLargeUrl,
      audioUrl: isDead(s.audioUrl) ? null : s.audioUrl,
      videoUrl: null,
    })),
  };
}

export function loadProject(id: string): StoryProject | null {
  const p = readAll()[id];
  return p ? normalize(p) : null;
}

function normalizeRefScenes(s: Partial<StoryScene> & { refScene?: number | null }): number[] | null {
  if (Array.isArray(s.refScenes)) {
    const list = s.refScenes.filter((k) => Number.isInteger(k) && (k as number) >= 0).slice(0, 8) as number[];
    return list.length ? list : null;
  }
  // Legacy single value.
  if (Number.isInteger(s.refScene) && (s.refScene as number) >= 0) return [s.refScene as number];
  return null;
}

function normalize(p: StoryProject): StoryProject {
  return {
    ...p,
    voiceStyle: p.voiceStyle || DEFAULT_VOICE_STYLE,
    sceneCount: p.sceneCount ?? p.scenes.length,
    aspect: p.aspect ?? "16:9",
    characterRef: p.characterRef ?? "",
    genre: p.genre || "edukasi",
    styleAnchor: p.styleAnchor ?? "",
    storyMode: p.storyMode === "protagonist" ? "protagonist" : "narrator",
    protagonist: p.protagonist ?? null,
    charName: p.charName ?? "",
    persona: p.persona ?? "",
    design: p.design ?? "",
    musicTitle: p.musicTitle ?? "",
    musicUrl: p.musicUrl ?? null,
    posterPrompt: p.posterPrompt ?? "",
    posterH: p.posterH ?? null,
    posterV: p.posterV ?? null,
    posterStatus: p.posterStatus === "working" ? "idle" : (p.posterStatus ?? "idle"),
    posterError: "",
    scenes: p.scenes.map((s) => ({
      ...s,
      imageStatus: s.imageStatus === "working" ? ("idle" as const) : s.imageStatus,
      audioStatus: s.audioStatus === "working" ? ("idle" as const) : s.audioStatus,
      imageSource: s.imageSource ?? ("moment" as ImageSource),
      aiImagePrompt: s.aiImagePrompt ?? "",
      refScenes: normalizeRefScenes(s),
      refUsed: s.refUsed ?? null,
      imageQuality: ["512px", "1K", "2K", "4K"].includes(s.imageQuality) ? s.imageQuality : "2K",
      voiceModel: ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"].includes(s.voiceModel) ? s.voiceModel : "gemini-3.8-flash-tts",
      videoUrl: typeof s.videoUrl === "string" && s.videoUrl && !s.videoUrl.startsWith("blob:") ? s.videoUrl : null,
      videoStatus: typeof s.videoUrl === "string" && s.videoUrl && !s.videoUrl.startsWith("blob:") ? ("ready" as const) : ("idle" as const),
      videoError: "",
      videoRes: ["360p", "720p", "1080p"].includes(s.videoRes) ? s.videoRes : "360p",
      videoDur: [3, 5, 8, 10].includes(s.videoDur) ? s.videoDur : 3,
      refFailed: s.refFailed ?? false,
      imageLargeReady: false,
      imageLargeUrl: s.imageLargeUrl ?? null,
      captions: Array.isArray(s.captions)
        ? s.captions
            .filter((w) => w && typeof w.text === "string" && w.text.trim())
            .map((w) => ({ text: String(w.text).trim(), start: Number(w.start) || 0, end: Number(w.end) || 0 }))
            .slice(0, 400)
        : null,
    })),
  };
}

export function loadLastProject(): StoryProject | null {
  try {
    const id = localStorage.getItem(LAST_KEY);
    return id ? loadProject(id) : null;
  } catch {
    return null;
  }
}

export function forgetProject(id: string) {
  try {
    const all = readAll();
    delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
    if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY);
  } catch {}
}

export const sceneSeconds = (s: StoryScene): number => s.audioSeconds ?? estimateSeconds(s.narration);

/** captions.json — per scene, per word, so players can highlight word by word. */
export function buildCaptionsJson(scenes: StoryScene[]): string | null {
  if (!scenes.some((s) => s.captions?.length)) return null;
  let offset = 0;
  const out = scenes.map((s, i) => {
    const words = (s.captions ?? []).map((w) => ({ text: w.text, start: w.start, end: w.end }));
    const entry = {
      scene: i + 1,
      audio: s.audioUrl ? `voiceovers/scene-${String(i + 1).padStart(2, "0")}-voice.wav` : null,
      offset: Math.round(offset * 100) / 100,
      duration: Math.round(sceneSeconds(s) * 100) / 100,
      words,
    };
    offset += sceneSeconds(s);
    return entry;
  });
  return JSON.stringify({ scenes: out }, null, 2);
}

// ------------------------------------------------- session media cache
// REMOVED (over-engineering that caused crossed wires): no more in-memory
// blob maps or object-URL caches. Every generate commits straight to R2 and
// only R2 URLs ever enter scene state — refresh simply reloads from R2.

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cross-scene duplicate detection: input hash (ref+prompt) and output hash (bytes). */
export const videoInputHashes = new Map<string, string>();
export const videoOutputHashes = new Map<string, string>();

// ------------------------------------------------------------- zip export

async function urlToBlob(url: string): Promise<Blob> {
  if (url.startsWith("data:")) return dataUrlToBlob(url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  return r.blob();
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 48) || "story";

/** TTS markup tags are instructions, not spoken script — strip them. */
export const cleanScript = (s: string) => s.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();

function wrap60(s: string): string {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > 60 && line) {
      lines.push(line);
      line = w;
    } else {
      line = (line + " " + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/** Convert any image blob to PNG so the zip matches the scene-NN.png spec. */
async function toPng(blob: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return blob;
      ctx.drawImage(bmp, 0, 0);
      return (await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"))) ?? blob;
    } finally {
      bmp.close();
    }
  } catch {
    return blob;
  }
}

export async function exportZip(project: StoryProject, onStep?: (msg: string) => void): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const name = `${slug(project.title)}-storyboard`;
  const img = zip.folder("images");
  const aud = zip.folder("voiceovers");
  const vid = zip.folder("videos");
  if (!img || !aud || !vid) throw new Error("zip init failed");

  const activePrompt = (s: StoryScene) => (s.imageSource === "ai" && s.aiImagePrompt.trim() ? s.aiImagePrompt : s.imagePrompt);
  const sceneFiles: { scene: number; script: string; prompt: string; has_image: boolean; has_voiceover: boolean; has_video: boolean }[] = [];

  for (let i = 0; i < project.scenes.length; i++) {
    const s = project.scenes[i];
    const n = String(i + 1).padStart(2, "0");
    // Everything lives in R2 — fetch straight from the scene URLs.
    let imageBlob: Blob | null = null;
    try {
      if (s.imageLargeUrl) imageBlob = await urlToBlob(s.imageLargeUrl);
      else if (s.imageUrl) imageBlob = await urlToBlob(s.imageUrl);
    } catch {}
    let has_image = false;
    if (imageBlob) {
      onStep?.(`Packing image ${i + 1}/${project.scenes.length}`);
      img.file(`scene-${n}.png`, await toPng(imageBlob));
      has_image = true;
    }
    let has_voiceover = false;
    if (s.audioUrl) {
      try {
        aud.file(`scene-${n}-voice.wav`, await urlToBlob(s.audioUrl));
        has_voiceover = true;
      } catch {}
    }
    let has_video = false;
    if (s.videoUrl) {
      try {
        onStep?.(`Packing video ${i + 1}/${project.scenes.length}`);
        vid.file(`scene-${n}.mp4`, await urlToBlob(s.videoUrl));
        has_video = true;
      } catch {}
    }
    sceneFiles.push({ scene: i + 1, script: cleanScript(s.narration), prompt: activePrompt(s), has_image, has_voiceover, has_video });
  }

  const allLarge = project.scenes.length > 0 && project.scenes.every((s) => !!s.imageLargeUrl);
  zip.file(
    "story_project.json",
    JSON.stringify(
      {
        title: project.title,
        topic: project.topic,
        genre: project.genre || "edukasi",
        style: project.styleLabel,
        aspectRatio: project.aspect,
        quality: allLarge ? "large" : "medium",
        created_at: new Date(project.created * 1000).toISOString(),
        total_scenes: project.scenes.length,
        music: project.musicUrl ? "music.m4a" : null,
        scenes: sceneFiles,
      },
      null,
      2,
    ),
  );

  const vo: string[] = ["NASKAH VOICEOVER LENGKAP", `Judul / Topik: ${project.title}`, `Jumlah Scene: ${project.scenes.length}`, ""];
  project.scenes.forEach((s, i) => {
    vo.push("====================", `SCENE ${i + 1}`, "====================", "Naskah VO:", wrap60(cleanScript(s.narration)), "");
  });
  zip.file("voiceover_lengkap.txt", vo.join("\n"));

  const captions = buildCaptionsJson(project.scenes);
  if (captions) zip.file("captions.json", captions);

  if (project.musicUrl) {
    try {
      onStep?.("Packing music…");
      zip.file("music.m4a", await urlToBlob(project.musicUrl));
    } catch {}
  }

  onStep?.("Compressing zip…");
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${name}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
  return `${name}.zip`;
}
