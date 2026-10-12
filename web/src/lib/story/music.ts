export const MUSIC_BASE = "https://tiktok-tts-studio.aguzz.workers.dev";

export type MusicTrack = {
  id: string;
  title: string;
  author: string;
  album: string;
  duration: number;
  cover: string;
  playUrl: string;
  /** Pre-resolved playable URL (selected track); skips the proxy wrapper. */
  directUrl?: string;
};

/** Resolvable playback URL for a track. */
export const trackUrl = (t: MusicTrack) => t.directUrl || proxiedAudio(t.playUrl);

type RecItem = {
  id_str?: string;
  id?: number | string;
  title?: string;
  author?: string;
  album?: string;
  duration?: number;
  cover_medium?: { url_list?: string[] };
  cover_thumb?: { url_list?: string[] };
  cover_large?: { url_list?: string[] };
  play_url?: { uri?: string; url_list?: string[] };
};

function normalizeRec(m: RecItem, i = 0): MusicTrack | null {
  const play = m.play_url?.url_list?.[0] || m.play_url?.uri || "";
  if (!play) return null;
  return {
    id: String(m.id_str ?? m.id ?? `${m.title}-${i}`),
    title: m.title || "Untitled",
    author: m.author || "",
    album: m.album || "",
    duration: Number(m.duration) || 0,
    cover: m.cover_medium?.url_list?.[0] || m.cover_thumb?.url_list?.[0] || m.cover_large?.url_list?.[0] || "",
    playUrl: play,
  };
}

export type MusicPage = { tracks: MusicTrack[]; cursor: number; hasMore: boolean };

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const r = await fetch(`${MUSIC_BASE}${path}`, { signal, headers: { accept: "*/*" } });
  if (!r.ok) throw new Error(`music service answered ${r.status}`);
  return r.json();
}

export async function recommendMusic(cursor = 0, count = 20, signal?: AbortSignal): Promise<MusicPage> {
  const d = (await getJson(`/api/sound/recommend?zip_uri=&creation_id=&count=${count}&cursor=${cursor}`, signal)) as {
    music_list?: RecItem[];
    cursor?: number;
    has_more?: number | boolean;
  };
  const tracks = (d.music_list ?? []).map(normalizeRec).filter((t): t is MusicTrack => !!t);
  return { tracks, cursor: Number(d.cursor ?? cursor + tracks.length), hasMore: d.has_more === 1 || d.has_more === true };
}

export async function searchMusic(keyword: string, cursor = 0, count = 20, signal?: AbortSignal): Promise<MusicPage> {
  const d = (await getJson(`/api/sound/search?keyword=${encodeURIComponent(keyword)}&count=${count}&cursor=${cursor}`, signal)) as {
    data?: { music_info?: RecItem }[];
    cursor?: number;
    has_more?: number | boolean;
  };
  const tracks = (d.data ?? []).map((x) => normalizeRec(x?.music_info ?? {})).filter((t): t is MusicTrack => !!t);
  return { tracks, cursor: Number(d.cursor ?? cursor + tracks.length), hasMore: d.has_more === 1 || d.has_more === true };
}

/** Download MUST go through the proxy (direct tiktokcdn links are not usable). */
export const proxiedAudio = (playUrl: string) => `${MUSIC_BASE}/api/sound/audio?url=${encodeURIComponent(playUrl)}`;

export function fmtDur(s: number) {
  if (!s || s < 0) return "–";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
