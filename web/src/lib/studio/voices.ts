import { studioData } from "./data";
import { auditionRobinVoice, geminiFetch, PREVIEW_VOICES_MAP, ROBIN_PREVIEW_LINE } from "@/lib/story/robin";
import { cacheGet, cacheSet } from "./store";
import { SHARE_API } from "@/lib/share";
import type { Voice, VoiceFacets, VoicePage, VoiceQuery } from "@/lib/api";

export const PREVIEW_LINE = "Hi! I'm your narrator. Sit back, and let me tell you a story you won't forget.";
export const TOPIC_LINE = "Hi, I'm your narrator. Today's story: {topic}.";

const EMPTY_FACETS: VoiceFacets = { total: 0, gender: [], age: [], accent: [], category: [], tags: [], languages: [] };

async function voiceApi<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${SHARE_API}${path}?${new URLSearchParams(params)}`, { signal });
  if (!r.ok) throw new Error(`voices unavailable (${r.status})`);
  return r.json();
}

let facetCache: Promise<VoiceFacets> | null = null;
export function facets(): Promise<VoiceFacets> {
  facetCache ??= voiceApi<VoiceFacets>("/api/voices/facets", {}).catch(() => EMPTY_FACETS);
  return facetCache;
}

export async function search(q: VoiceQuery, page = 0, signal?: AbortSignal): Promise<VoicePage> {
  return voiceApi<VoicePage>("/api/voices", { q: JSON.stringify(q), page: String(page) }, signal);
}

export type VoiceCheck = { voice: Voice | null; speaks: boolean; native: Voice | null };

export async function checkVoice(by: { id?: string; name?: string }, lang: string): Promise<VoiceCheck> {
  const none = { voice: null, speaks: true, native: null };
  if (!(by.id || by.name)) return none;
  const language = (await studioData()).languages.find((l) => l.code === lang)?.name ?? "English";
  return voiceApi<VoiceCheck>("/api/voices/check", { ...(by.id ? { id: by.id } : { name: by.name! }), lang, language }).catch(() => none);
}

export async function line(template: string, lang: string): Promise<string> {
  if (lang === "en") return template;
  const key = `${lang}|${template}`;
  const hit = cacheGet("lines", key);
  if (hit) return hit;
  try {
    const langName = (await studioData()).languages.find((l) => l.code === lang)?.name ?? "Indonesian";
    const r = await geminiFetch("/v1beta/models/gemini-3.8-flash:generateContent", {
      contents: [{ role: "user", parts: [{ text: `Translate into ${langName}, keeping any {placeholder} unchanged. Reply with the translated sentence only: "${template}"` }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 256 },
    });
    if (r.ok) {
      const d = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const t = (d.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim().replace(/^["']|["']$/g, "");
      if (t) {
        cacheSet("lines", key, t);
        return t;
      }
    }
  } catch {}
  return template;
}

function resolveGeminiVoice(voiceId: string, gender?: string): string {
  if (PREVIEW_VOICES_MAP[voiceId]) return PREVIEW_VOICES_MAP[voiceId];
  const clean = voiceId.split(/\s+[-–]\s+/)[0].trim();
  const cap = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  if (PREVIEW_VOICES_MAP[cap]) return PREVIEW_VOICES_MAP[cap];
  return gender?.toLowerCase() === "male" ? "Puck" : "Kore";
}

export async function sample(voiceId: string, text: string, _lang = "en", gender?: string): Promise<string> {
  void _lang;
  const clean = Array.from(text.split(/\s+/).filter(Boolean).join(" ")).slice(0, 320).join("");
  const gVoice = resolveGeminiVoice(voiceId, gender);
  return auditionRobinVoice(gVoice, clean || ROBIN_PREVIEW_LINE);
}

export async function audition(voiceId: string, topic: string, lang: string) {
  const text = topic.trim() ? (await line(TOPIC_LINE, lang)).replace("{topic}", topic.trim().slice(0, 160)) : await line(PREVIEW_LINE, lang);
  return sample(voiceId, text, lang);
}

export async function characterIntro(characterId: string, lang: string) {
  const c = (await studioData()).characters.find((x) => x.id === characterId);
  if (!c) throw new Error("unknown character");
  const text = await line(`Hi, I'm ${c.name}! ${c.personality}.`, lang);
  return sample(c.voice.voice_id || c.voice.name, text, lang, c.voice.gender);
}

export async function preview(v: Voice, lang: string) {
  const name = (await studioData()).languages.find((l) => l.code === lang)?.name ?? "English";
  const native = lang === "en" || (v.languages ?? []).includes(name.split(" ")[0].toLowerCase());
  if (v.preview_url && native) return v.preview_url;
  return sample(v.voice_id, await line(PREVIEW_LINE, lang), lang, v.gender);
}
