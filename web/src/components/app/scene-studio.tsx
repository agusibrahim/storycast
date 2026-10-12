import { AudioLines, Check, Clapperboard, Cloud, CloudOff, Download, EllipsisVertical, Image as ImageIcon, Images, Loader2, Mic, Music as MusicIcon, Package, Pause, Play, Plus, RefreshCw, Sparkles, Square, Trash2, X, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { StoryPreview } from "@/components/app/story-preview";
import { Lightbox } from "@/components/app/lightbox";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { estimateSeconds, dataUrlToBlob, fitToFrame, generateSceneImage, generateSceneVideo, generateStoryboard, synthesizeNarration, videoFrameSize } from "@/lib/story/robin";
import { CLOUD, cloudOwner, cloudPending, createCloudStory, downscale, flushCloudStory, forgetCloudOwner, patchCloudStory, refreshCloudMedia, uploadCloudMedia, uploadCloudPoster } from "@/lib/story/cloud";
import { exportZip, projectFromDraft, saveProject, sceneSeconds, sha256Hex, videoInputHashes, videoOutputHashes, type StoryProject, type StoryScene } from "@/lib/story/project";
import { AnimatePresence, motion } from "motion/react";
import { RobinVoiceLibrary } from "@/components/app/robin-voice-library";
import { MusicLibrary, type MusicChoice } from "@/components/app/music-library";
import { dismissModal, useModalHash } from "@/lib/router";
import type { Voice } from "@/lib/api";

type Props = { project: StoryProject; onPersist: (p: StoryProject) => void; onToast: (kind: "success" | "error" | "loading", title: string, description?: string) => void };

const uid = () => Math.random().toString(36).slice(2, 10);

const fmtClock = (t: number) => {
  if (!Number.isFinite(t) || t < 0) t = 0;
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
};

function SceneAudio({ src }: { src: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setDur(0);
  }, [src]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  };

  const seek = (e: React.PointerEvent) => {
    const a = audio.current;
    const r = bar.current?.getBoundingClientRect();
    if (!a || !r || !dur) return;
    const x = Math.min(Math.max(0, e.clientX - r.left), r.width);
    a.currentTime = (x / r.width) * dur;
    setTime(a.currentTime);
  };

  return (
    <div className="mt-2 flex items-center gap-2.5 rounded-xl bg-muted/60 py-2 pr-3 pl-2">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause narration" : "Play narration"}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 active:scale-95"
      >
        {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 translate-x-px fill-current" />}
      </button>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
        {fmtClock(time)} / {fmtClock(dur)}
      </span>
      <div ref={bar} role="slider" aria-label="Seek narration" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(time)} onPointerDown={seek} className="flex h-5 flex-1 cursor-pointer items-center">
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${dur ? (time / dur) * 100 : 0}%` }} />
        </div>
      </div>
    </div>
  );
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

function SceneVideo({ src }: { src: string }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setDur(0);
    setSpeed(1);
  }, [src]);

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed, src]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  const seek = (e: React.PointerEvent) => {
    const v = video.current;
    const r = bar.current?.getBoundingClientRect();
    if (!v || !r || !dur) return;
    const x = Math.min(Math.max(0, e.clientX - r.left), r.width);
    v.currentTime = (x / r.width) * dur;
    setTime(v.currentTime);
  };

  const cycleSpeed = () => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]);

  return (
    <div className="group/vid relative mt-2 flex justify-center">
      <video
        ref={video}
        src={src}
        playsInline
        preload="metadata"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        className="h-auto max-h-[46vh] w-auto max-w-full cursor-pointer rounded-lg bg-black object-contain"
      />
      {!playing && (
        <button
          type="button"
          onClick={toggle}
          aria-label="Play video"
          className="absolute top-1/2 left-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
        >
          <Play className="size-5 translate-x-px fill-current" />
        </button>
      )}
      <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-full bg-black/55 px-2 py-1 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/vid:opacity-100 focus-within:opacity-100 hover:opacity-100 max-sm:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          aria-label={playing ? "Pause" : "Play"}
          className="flex size-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/15"
        >
          {playing ? <Pause className="size-3.5 fill-current" /> : <Play className="size-3 translate-x-px fill-current" />}
        </button>
        <span className="shrink-0 font-mono text-[10px] tabular-nums">
          {fmtClock(time)} / {fmtClock(dur)}
        </span>
        <div ref={bar} role="slider" aria-label="Seek video" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(time)} onPointerDown={seek} className="flex h-5 flex-1 cursor-pointer items-center">
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25">
            <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${dur ? (time / dur) * 100 : 0}%` }} />
          </div>
        </div>
        <button
          type="button"
          onClick={cycleSpeed}
          title="Playback speed"
          className="h-7 shrink-0 rounded-full px-2 font-mono text-[11px] transition-colors hover:bg-white/15"
        >
          {speed}×
        </button>
      </div>
    </div>
  );
}

function ProgressRing({ value }: { value: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 18 18" className="size-4 -rotate-90 text-primary" aria-hidden>
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))} strokeLinecap="round" />
    </svg>
  );
}

function VideoMenu({ scene, onPick }: { scene: StoryScene; onPick: (patch: Partial<StoryScene>) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open ]);
  const row = (label: string, value: string, options: (string | number)[], fmt: (v: string | number) => string, apply: (v: string) => void) => (
    <div key={label}>
      <p className="px-3 pt-2 pb-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{label}</p>
      {options.map((o) => {
        const active = String(value) === String(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => {
              apply(String(o));
              setOpen(false);
            }}
            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted"
          >
            {fmt(o)}
            {active && <Check className="size-3.5 text-primary" />}
          </button>
        );
      })}
    </div>
  );
  return (
    <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Video options"
        aria-expanded={open}
        className="flex size-8 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-all hover:bg-black/75 focus-visible:opacity-100 group-hover/vidmenu:opacity-100 max-sm:opacity-100"
      >
        <EllipsisVertical className="size-4" />
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-10 cursor-default" />
          <div className="absolute top-9 right-0 z-20 w-40 overflow-hidden rounded-xl border border-border bg-card pb-1 shadow-xl">
            {row("Quality", scene.videoRes, ["360p", "720p", "1080p"], String, (v) => onPick({ videoRes: v }))}
            {row("Duration", String(scene.videoDur), [3, 5, 8, 10], (v) => `${v}s`, (v) => onPick({ videoDur: Number(v) }))}
          </div>
        </>
      )}
    </div>
  );
}

export function SceneStudio({ project, onPersist, onToast }: Props) {
  const [draft, setDraft] = useState(project);
  const [selected, setSelected] = useState(0);
  const [imaging, setImaging] = useState(false);
  const [voicing, setVoicing] = useState(false);
  const [videoing, setVideoing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [zipMsg, setZipMsg] = useState("");
  const [imgMsg, setImgMsg] = useState("");
  const [audMsg, setAudMsg] = useState("");
  const [vidMsg, setVidMsg] = useState("");
  const [vidProg, setVidProg] = useState<{ done: number; total: number } | null>(null);
  const [viewImg, setViewImg] = useState<{ url: string; caption: string } | null>(null);
  const [posterStep, setPosterStep] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [musicBusy, setMusicBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sync, setSync] = useState<{ status: "local" | "saving" | "saved" | "error" | "denied"; at: number | null }>({ status: "local", at: null });
  const cancelImg = useRef(false);
  const cancelAud = useRef(false);
  const cancelVid = useRef(false);
  const ownerRef = useRef<string | null>(null);
  const deniedRef = useRef(false);
  const markDenied = () => {
    deniedRef.current = true;
    setSync({ status: "denied", at: null });
  };
  const isDeniedError = (e: unknown) => e instanceof Error && /did not create that story|403/.test(e.message);
  const firstSync = useRef(true);
  const dirtyRef = useRef(false);
  // Generation stamps: a background upload may only apply if no newer
  // generate for the same scene has started since (no stale overwrite).
  const imgStamp = useRef<Record<string, number>>({});
  const audStamp = useRef<Record<string, number>>({});
  const vidStamp = useRef<Record<string, number>>({});
  /** In-flight generate+save operations — the unload guard watches this. */
  const busyRef = useRef(0);
  const stampSeq = useRef(0);
  const nextStamp = (box: React.MutableRefObject<Record<string, number>>, id: string) => {
    stampSeq.current += 1;
    box.current[id] = stampSeq.current;
    return stampSeq.current;
  };
  const narrationRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = useRef(draft);
  ref.current = draft;

  useEffect(() => {
    setDraft(project);
    setSelected(0);
    firstSync.current = true;
    dirtyRef.current = false;
    ownerRef.current = null;
    setSync({ status: "local", at: null });
    setPreviewOpen(false);
    pendingSave.current.clear();
    // Auto-poster once per story: right after the script exists, paint the
    // cover immediately (no scene images yet — text/character ref only).
    try {
      const flag = `autoposter-${project.id}`;
      const p0 = project;
      if (!localStorage.getItem(flag) && p0.posterStatus === "idle" && !p0.posterH && !p0.posterV && !p0.posterError) {
        localStorage.setItem(flag, "1");
        window.setTimeout(() => {
          if (ref.current.id === project.id) void generatePoster();
        }, 1500);
      }
    } catch {}
    // Rehydrate media stripped from the local copy (quota fallback): fill
    // blanks from the cloud, never overwrite fresh local work.
    if (CLOUD) {
      let live = true;
      refreshCloudMedia(project.id).then((m) => {
        if (!live || !m) return;
        const cur = ref.current;
        if (cur.id !== project.id) return;
        let changed = false;
        const scenes = cur.scenes.map((s, i) => {
          const r = m.scenes[i];
          if (!r) return s;
          const next = { ...s };
          if (!next.imageUrl && r.image) { next.imageUrl = r.image; next.imageStatus = "ready"; changed = true; }
          if (!next.imageLargeUrl && r.imageLarge) { next.imageLargeUrl = r.imageLarge; next.imageLargeReady = true; changed = true; }
          if (!next.audioUrl && r.audio) { next.audioUrl = r.audio; next.audioStatus = "ready"; changed = true; }
          if (!next.videoUrl && r.video) { next.videoUrl = r.video; next.videoStatus = "ready"; changed = true; }
          return next;
        });
        const posterH = cur.posterH || m.posterH;
        const posterV = cur.posterV || m.posterV;
        if (posterH !== cur.posterH || posterV !== cur.posterV) changed = true;
        if (changed) {
          const merged = { ...cur, scenes, posterH, posterV, posterStatus: posterH || posterV ? "ready" as const : cur.posterStatus };
          ref.current = merged;
          setDraft(merged);
          onPersist(merged);
        }
      }).catch(() => {});
      return () => {
        live = false;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // Cloud save: creates the record once (same id as local), then patches it.
  // Self-healing — if creation failed while offline, the next edit retries.
  // If the id belongs to another browser (403), stop: local-only from here.
  useEffect(() => {
    if (!CLOUD || deniedRef.current) return;
    if (firstSync.current) {
      firstSync.current = false;
      ownerRef.current = cloudOwner(project.id);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        let owner = ownerRef.current;
        if (!owner) {
          setSync({ status: "saving", at: null });
          const created = await createCloudStory(ref.current);
          if (created.id !== ref.current.id) {
            // Id taken by another browser's story — do not adopt, do not spam.
            forgetCloudOwner(created.id);
            markDenied();
            return;
          }
          owner = created.owner;
          ownerRef.current = owner;
        }
        setSync({ status: "saving", at: null });
        await patchCloudStory(ref.current, owner);
        dirtyRef.current = false;
        setSync({ status: "saved", at: Date.now() });
      } catch (e) {
        if (isDeniedError(e)) markDenied();
        else setSync({ status: "error", at: null });
      }
    }, 2500);
    return () => window.clearTimeout(t);
  }, [draft]);

  // Safety net: every 10s, while the tab is visible, flush anything dirty.
  // Plus a keepalive flush when the tab hides or closes.
  useEffect(() => {
    if (!CLOUD) return;
    const id = window.setInterval(async () => {
      try {
        const owner = ownerRef.current;
        if (deniedRef.current || !dirtyRef.current || document.visibilityState !== "visible" || !owner) return;
        setSync({ status: "saving", at: null });
        await patchCloudStory(ref.current, owner);
        dirtyRef.current = false;
        setSync({ status: "saved", at: Date.now() });
      } catch (e) {
        if (isDeniedError(e)) markDenied();
        else setSync({ status: "error", at: null });
      }
      // Retry unsaved renders (bytes kept in memory, never regenerated).
      await retrySaves();
    }, 10_000);
    const onHide = () => {
      const owner = ownerRef.current;
      if (owner && dirtyRef.current) flushCloudStory(ref.current, owner);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  const commit = (next: StoryProject) => {
    ref.current = next;
    dirtyRef.current = true;
    setDraft(next);
    onPersist(next);
  };

  // ------------------------------------------------------------ unload guard
  // Refreshing mid-generate or mid-upload orphans the file: the bytes may
  // reach R2 but nothing references them yet. Warn instead of losing work.
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (cloudPending() > 0 || busyRef.current > 0 || pendingSave.current.size > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  // Unsaved renders: generated bytes that never reached R2 (upload failed).
  // Kept in memory ONLY so "Retry save" can store them without regenerating
  // (no tokens re-burned). Nothing displays until R2+DB confirm.
  type PendingKind = "image" | "audio" | "video";
  const pendingSave = useRef(new Map<string, { kind: PendingKind; blob: Blob }>());
  const [, setSaveTick] = useState(0);
  const markPending = (sid: string, entry: { kind: PendingKind; blob: Blob } | null) => {
    if (entry) pendingSave.current.set(sid, entry);
    else pendingSave.current.delete(sid);
    setSaveTick((t) => t + 1);
  };

  /** Re-upload one pending file (auto by the safety net, or via Retry save). */
  async function savePending(sid: string): Promise<boolean> {
    const owner = ownerRef.current;
    const entry = pendingSave.current.get(sid);
    if (!CLOUD || !owner || deniedRef.current || !entry) return false;
    const idx = ref.current.scenes.findIndex((x) => x.id === sid);
    if (idx < 0) {
      markPending(sid, null);
      return false;
    }
    try {
      const pid = ref.current.id;
      if (entry.kind === "video") {
        patchScene(idx, { videoUrl: await uploadCloudMedia(pid, owner, idx, "video", entry.blob) });
      } else if (entry.kind === "audio") {
        patchScene(idx, { audioUrl: await uploadCloudMedia(pid, owner, idx, "audio", entry.blob) });
      } else {
        const largeR2 = await uploadCloudMedia(pid, owner, idx, "image-large", entry.blob);
        const smallR2 = await uploadCloudMedia(pid, owner, idx, "image", await downscale(entry.blob));
        patchScene(idx, { imageUrl: smallR2, imageLargeUrl: largeR2, imageLargeReady: true });
      }
      // Flip the error card back to ready (URLs were already committed above).
      const st = ref.current.scenes[idx];
      if (entry.kind === "video" && st.videoStatus === "error") patchScene(idx, { videoStatus: "ready", videoError: "" });
      if (entry.kind === "audio" && st.audioStatus === "error") patchScene(idx, { audioStatus: "ready", audioError: "" });
      if (entry.kind === "image" && st.imageStatus === "error") patchScene(idx, { imageStatus: "ready", imageError: "" });
      markPending(sid, null);
      onToast("success", `Scene ${idx + 1} ${entry.kind} saved`);
      return true;
    } catch {
      return false;
    }
  }

  async function retrySaves() {
    if (!pendingSave.current.size) return;
    for (const sid of [...pendingSave.current.keys()]) {
      await savePending(sid);
    }
  }
  const voiceValue: Voice | null = draft.voice
    ? { voice_id: draft.voice, name: draft.voice, description: "", preview_url: "", category: "", tags: [], gender: "", age: "", accent: "", collections: 0, curated: false }
    : null;

  useModalHash("preview", previewOpen, () => setPreviewOpen(false));

  const patchScene = (i: number, patch: Partial<StoryScene>) => {
    const next = { ...ref.current, scenes: ref.current.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) };
    commit(next);
  };

  /** Quality + TTS model choices flow forward: this scene and every next one. */
  const cascadeForward = (patch: Partial<StoryScene>) => {
    const next = { ...ref.current, scenes: ref.current.scenes.map((s, k) => (k >= selected ? { ...s, ...patch } : s)) };
    commit(next);
  };

  const scene = draft.scenes[selected];
  const imagesReady = draft.scenes.filter((s) => s.imageUrl).length;
  const audiosReady = draft.scenes.filter((s) => s.audioUrl).length;
  const videosReady = draft.scenes.filter((s) => s.videoUrl).length;
  const totalSecs = useMemo(() => draft.scenes.reduce((a, s) => a + sceneSeconds(s), 0), [draft.scenes]);

  // ---------------------------------------------------------- generators

  async function oneImage(i: number) {
    const s = ref.current.scenes[i];
    if (!s) return;
    // Never trust the index after an await (deleteScene shifts everything) —
    // always resolve the scene by its stable id. -1 = gone, patch is a no-op.
    const byId = () => ref.current.scenes.findIndex((x) => x.id === s.id);
    const my = nextStamp(imgStamp, s.id);
    busyRef.current++;
    const pid0 = ref.current.id;
    // Simple flow: generate, save straight to R2+DB, and only then display.
    // Nothing enters scene state until it is reload-proof.
    patchScene(i, { imageStatus: "working", imageError: "" });
    try {
      const useAi = s.imageSource === "ai" && s.aiImagePrompt.trim();
      const refIdxs = effectiveRefs(ref.current.scenes, i);
      const refs =
        i === 0
          ? ref.current.characterRef
            ? [ref.current.characterRef]
            : undefined
          : refIdxs.length
            ? refIdxs.map((k) => ref.current.scenes[k].imageUrl as string)
            : undefined;
      const r = await generateSceneImage(
        useAi ? s.aiImagePrompt : s.imagePrompt || s.narration,
        ref.current.styleLabel,
        ref.current.aspect,
        { ...(useAi ? { raw: true } : null), ...(refs ? { refs } : null), imageSize: s.imageQuality, ...(ref.current.styleAnchor ? { anchor: ref.current.styleAnchor } : null) },
      );
      if (!r.url) throw new Error("empty image response");
      if (ref.current.id !== pid0 || imgStamp.current[s.id] !== my) return;
      const wantedRef = !!refs;
      const usedRef = r.refAttached
        ? i === 0
          ? ref.current.characterRef
            ? "character"
            : null
          : `scene ${refIdxs.map((k) => k + 1).join("+")}`
        : null;
      // Full-size file: resolve now (links expire!).
      const blob = r.largeUrl
        ? r.largeUrl.startsWith("data:")
          ? dataUrlToBlob(r.largeUrl as string)
          : await (async () => {
              const res = await fetch(r.largeUrl as string);
              if (!res.ok) return null;
              const b = await res.blob();
              return b.type.startsWith("image/") ? b : null;
            })()
        : null;
      if (!blob) throw new Error("could not decode full-size image");
      const owner = ownerRef.current;
      if (CLOUD && owner) {
        try {
          const largeR2 = await uploadCloudMedia(ref.current.id, owner, byId(), "image-large", blob);
          const smallR2 = await uploadCloudMedia(ref.current.id, owner, byId(), "image", await downscale(blob));
          if (ref.current.id !== pid0 || imgStamp.current[s.id] !== my) return;
          patchScene(byId(), { imageStatus: "ready", imageUrl: smallR2, imageLargeUrl: largeR2, imageLargeReady: true, refUsed: usedRef, refFailed: wantedRef && !r.refAttached });
        } catch (e) {
          markPending(s.id, { kind: "image", blob });
          patchScene(byId(), { imageStatus: "error", imageError: `Saved nowhere — generated fine, upload failed (${e instanceof Error ? e.message : String(e)}). Retry saves without regenerating.` });
          onToast("error", `Scene ${byId() + 1} image not saved`, "File kept in memory — use Retry save, do not refresh");
        }
      } else {
        if (imgStamp.current[s.id] !== my) return;
        patchScene(byId(), { imageStatus: "ready", imageUrl: r.url, imageLargeUrl: r.largeUrl, imageLargeReady: true, refUsed: usedRef, refFailed: wantedRef && !r.refAttached });
      }
    } catch (e) {
      if (imgStamp.current[s.id] !== my) return;
      patchScene(byId(), { imageStatus: "error", imageError: e instanceof Error ? e.message : String(e) });
    } finally {
      busyRef.current--;
    }
  }

  async function oneAudio(i: number) {
    const s = ref.current.scenes[i];
    if (!s) return;
    const byId = () => ref.current.scenes.findIndex((x) => x.id === s.id);
    const my = nextStamp(audStamp, s.id);
    busyRef.current++;
    const pid0 = ref.current.id;
    // Simple flow: synthesize, save straight to R2+DB, and only then display.
    patchScene(i, { audioStatus: "working", audioError: "" });
    try {
      const r = await synthesizeNarration(s.narration, ref.current.voice || "Kore", { style: ref.current.voiceStyle, model: s.voiceModel });
      if (ref.current.id !== pid0 || audStamp.current[s.id] !== my) return;
      const wav = dataUrlToBlob(r.dataUrl);
      const owner = ownerRef.current;
      if (CLOUD && owner) {
        try {
          const url = await uploadCloudMedia(ref.current.id, owner, byId(), "audio", wav);
          if (ref.current.id !== pid0 || audStamp.current[s.id] !== my) return;
          patchScene(byId(), { audioStatus: "ready", audioUrl: url, audioSeconds: r.seconds, captions: r.captions });
        } catch (e) {
          markPending(s.id, { kind: "audio", blob: wav });
          patchScene(byId(), { audioStatus: "error", audioSeconds: r.seconds, captions: r.captions, audioError: `Saved nowhere — voice generated fine, upload failed (${e instanceof Error ? e.message : String(e)}). Retry saves without regenerating.` });
          onToast("error", `Scene ${byId() + 1} voiceover not saved`, "Audio kept in memory — use Retry save, do not refresh");
        }
      } else {
        if (audStamp.current[s.id] !== my) return;
        patchScene(byId(), { audioStatus: "ready", audioUrl: r.dataUrl, audioSeconds: r.seconds, captions: r.captions });
      }
    } catch (e) {
      if (audStamp.current[s.id] !== my) return;
      patchScene(byId(), { audioStatus: "error", audioError: e instanceof Error ? e.message : String(e) });
    } finally {
      busyRef.current--;
    }
  }

  async function oneVideo(i: number) {
    const s = ref.current.scenes[i];
    if (!s) return;
    const byId = () => ref.current.scenes.findIndex((x) => x.id === s.id);
    const pid0 = ref.current.id;
    // Reference = this scene's own saved image (R2), fitted to the exact
    // video frame so sizes match precisely. No session blobs anymore.
    const [fw, fh] = videoFrameSize(ref.current.aspect, s.videoRes);
    let refBlob: Blob | null = null;
    const srcUrl = s.imageLargeUrl || s.imageUrl;
    if (srcUrl) {
      try {
        refBlob = srcUrl.startsWith("data:") ? dataUrlToBlob(srcUrl) : await (await fetch(srcUrl)).blob();
        if (!refBlob.type.startsWith("image/")) refBlob = null;
      } catch {
        refBlob = null;
      }
    }
    if (refBlob) {
      try {
        refBlob = await fitToFrame(refBlob, fw, fh);
      } catch {}
    }
    if (!refBlob) {
      patchScene(i, { videoStatus: "error", videoError: "Generate the image first — video needs it as reference." });
      return;
    }
    const my = nextStamp(vidStamp, s.id);
    busyRef.current++;
    // Simple flow: render, save straight to R2+DB, and only then display.
    patchScene(i, { videoStatus: "working", videoError: "" });
    try {
      const useAi = s.imageSource === "ai" && s.aiImagePrompt.trim();
      const vprompt = useAi ? s.aiImagePrompt : s.imagePrompt || s.narration;
      // Duplicate-input guard (cheap, runs BEFORE any tokens burn): two scenes
      // sent with byte-identical reference + prompt would render twins.
      let inHash = "";
      try {
        inHash = `${await sha256Hex(refBlob)}|${vprompt}`;
      } catch {}
      const twin = inHash ? [...videoInputHashes.entries()].find(([id, h]) => id !== s.id && h === inHash) : undefined;
      if (twin) {
        const m = ref.current.scenes.findIndex((x) => x.id === twin[0]);
        patchScene(byId(), { videoStatus: "error", videoError: `Same picture+prompt as scene ${m >= 0 ? m + 1 : "?"} — change the image or prompt, then regenerate.` });
        return;
      }
      const r = await generateSceneVideo(refBlob, vprompt, ref.current.aspect, {
        resolution: s.videoRes,
        duration: s.videoDur,
      });
      if (ref.current.id !== pid0 || vidStamp.current[s.id] !== my) return;
      const blob = dataUrlToBlob(r.dataUrl);
      // Duplicate-output guard: never silently accept bytes identical to
      // another scene's video (crossed responses, router echo).
      let outHash = "";
      try {
        outHash = await sha256Hex(blob);
      } catch {}
      const echo = outHash ? [...videoOutputHashes.entries()].find(([id, h]) => id !== s.id && h === outHash) : undefined;
      if (echo) {
        const m = ref.current.scenes.findIndex((x) => x.id === echo[0]);
        patchScene(byId(), { videoStatus: "error", videoError: `Came back identical to scene ${m >= 0 ? m + 1 : "?"} video — rejected. Regenerate once.` });
        onToast("error", `Scene ${byId() + 1} video rejected`, `Identical to scene ${m >= 0 ? m + 1 : "?"} — try regenerating just this scene`);
        return;
      }
      if (inHash) videoInputHashes.set(s.id, inHash);
      if (outHash) videoOutputHashes.set(s.id, outHash);
      const owner = ownerRef.current;
      if (CLOUD && owner) {
        try {
          const url = await uploadCloudMedia(ref.current.id, owner, byId(), "video", blob);
          if (ref.current.id !== pid0 || vidStamp.current[s.id] !== my) return;
          patchScene(byId(), { videoStatus: "ready", videoUrl: url });
        } catch (e) {
          markPending(s.id, { kind: "video", blob });
          patchScene(byId(), { videoStatus: "error", videoError: `Saved nowhere — video rendered fine, upload failed (${e instanceof Error ? e.message : String(e)}). Retry saves without regenerating.` });
          onToast("error", `Scene ${byId() + 1} video not saved`, "Video kept in memory — use Retry save, do not refresh");
        }
      } else {
        if (vidStamp.current[s.id] !== my) return;
        patchScene(byId(), { videoStatus: "ready", videoUrl: URL.createObjectURL(blob) });
      }
    } catch (e) {
      if (vidStamp.current[s.id] !== my) return;
      patchScene(byId(),  { videoStatus: "error", videoError: e instanceof Error ? e.message : String(e) });
    } finally {
      busyRef.current--;
    }
  }

  async function bulk(kind: "image" | "audio" | "video", onlyMissing: boolean) {
    // One bulk at a time across ALL kinds — parallel generators crossed wires
    // (wrong bytes on wrong cards). Same-kind re-entry is also refused.
    const anyBusy = imaging || voicing || videoing;
    const cancelRef = kind === "image" ? cancelImg : kind === "audio" ? cancelAud : cancelVid;
    const setBusy = kind === "image" ? setImaging : kind === "audio" ? setVoicing : setVideoing;
    const setMsg = kind === "image" ? setImgMsg : kind === "audio" ? setAudMsg : setVidMsg;
    const verb = kind === "image" ? "Paint" : kind === "audio" ? "Record" : "Film";
    // Final notes auto-hide so the narrow cards stay tidy.
    const sayDone = (msg: string) => {
      setMsg(msg);
      window.setTimeout(() => setMsg((m) => (m === msg ? "" : m)), 5000);
    };
    const clash = kind === "video" ? anyBusy : videoing || (kind === "image" ? imaging : voicing);
    if (clash) {
      sayDone(kind === "video" ? "Finish the running job first — video runs alone." : "Video is running — voiceover/image waits for it.");
      return;
    }
    cancelRef.current = false;
    setBusy(true);
    setMsg("");
    const list = ref.current.scenes
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => {
        if (!onlyMissing) return kind === "video" ? !!s.imageUrl : true;
        if (kind === "image") return !s.imageUrl;
        if (kind === "audio") return !s.audioUrl;
        return !!s.imageUrl && !s.videoUrl;
      });
    if (!list.length) {
      if (kind === "video") setVidProg(null);
      else sayDone("Nothing to do.");
      setBusy(false);
      return;
    }
    for (let k = 0; k < list.length; k++) {
      if (cancelRef.current) {
        if (kind === "video") setVidProg(null);
        else sayDone(`Stopped · ${k}/${list.length} kept.`);
        break;
      }
      if (kind === "video") {
        // progress ring only — no per-scene text line.
        setVidProg({ done: k, total: list.length });
      }
      // Bulk image follows scene 1's quality. (Video chunk syncs below.)
      if (kind === "image") {
        const first = ref.current.scenes[0];
        const it = list[k];
        if (first && it.s.imageQuality !== first.imageQuality) {
          patchScene(it.i, { imageQuality: first.imageQuality });
        }
      }
      if (kind === "video") {
        // 3 at a time — proven safe now: correct scene keys (query bug fixed
        // and verified), FIFO upload queue, id-based patching, hash tripwires.
        const chunk = list.slice(k, k + 3);
        const first = ref.current.scenes[0];
        const at = (id: string) => ref.current.scenes.findIndex((x) => x.id === id);
        if (first) {
          chunk.forEach(({ s }) => {
            const idx = at(s.id);
            if (idx >= 0) {
              const cur = ref.current.scenes[idx];
              if (cur.videoRes !== first.videoRes || cur.videoDur !== first.videoDur) {
                patchScene(idx, { videoRes: first.videoRes, videoDur: first.videoDur });
              }
            }
          });
        }
        await Promise.all(
          chunk.map(({ s }) => {
            const idx = at(s.id);
            return idx >= 0 ? oneVideo(idx) : Promise.resolve();
          }),
        );
        setVidProg({ done: k + chunk.length, total: list.length });
        k += chunk.length - 1;
        continue;
      }
      setMsg(`${verb} ${list[k].i + 1}/${ref.current.scenes.length} · ${k + 1}/${list.length}`);
      if (kind === "image") await oneImage(list[k].i);
      else await oneAudio(list[k].i);
    }
    if (!cancelRef.current) {
      if (kind === "video") setVidProg(null);
      else sayDone(`Done · ${list.length} scene${list.length === 1 ? "" : "s"}.`);
      saveProject(ref.current);
    }
    setBusy(false);
  }

  const stopBulk = (kind: "image" | "audio" | "video") => {
    (kind === "image" ? cancelImg : kind === "audio" ? cancelAud : cancelVid).current = true;
    if (kind === "video") setVidProg(null);
  };

  function magnify(s: StoryScene) {
    const url = s.imageLargeUrl ?? s.imageUrl;
    if (url) setViewImg({ url, caption: `Scene ${s.index + 1}` });
  }

  async function pickMusic(m: MusicChoice | null) {
    if (!m) {
      commit({ ...ref.current, musicTitle: "", musicUrl: null });
      return;
    }
    // Instant: stream the proxy URL, then persist to R2 in the background.
    commit({ ...ref.current, musicTitle: m.title, musicUrl: m.url });
    const pid = ref.current.id;
    const want = m.title;
    setMusicBusy(true);
    try {
      const res = await fetch(m.url);
      if (!res.ok) throw new Error(`music download answered ${res.status}`);
      const blob = await res.blob();
      if (!blob.type.startsWith("audio/")) throw new Error("not an audio file");
      const owner = ownerRef.current;
      if (CLOUD && owner && ref.current.musicTitle === want) {
        const url = await uploadCloudMedia(pid, owner, 0, "music", blob);
        if (ref.current.id === pid && ref.current.musicTitle === want) {
          commit({ ...ref.current, musicUrl: url });
        }
      }
    } catch (e) {
      if (ref.current.musicTitle === want) {
        onToast("error", "Music save failed", e instanceof Error ? e.message : String(e));
      }
    } finally {
      setMusicBusy(false);
    }
  }

  async function doExport() {
    if (exporting) return;
    setExporting(true);
    setZipMsg("Preparing files…");
    try {
      const name = await exportZip(ref.current, setZipMsg);
      setZipMsg(`Saved ${name}`);
      onToast("success", "Story pack exported", name);
    } catch (e) {
      setZipMsg(e instanceof Error ? e.message : String(e));
      onToast("error", "Export failed", e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  const [regenBusy, setRegenBusy] = useState(false);

  /** Rewrite the script with the same settings: wipes scenes' image/audio/
   * video (same deterministic R2 keys get overwritten on regenerate) and
   * builds a fresh storyboard. Poster + music are kept. */
  async function regenerateStory() {
    if (regenBusy || imaging || voicing || videoing) return;
    const p = ref.current;
    const filled = p.scenes.some((s) => s.imageUrl || s.audioUrl || s.videoUrl);
    if (filled && !window.confirm("Buat ulang cerita? Gambar, video & voiceover yang ada akan dihapus dan diganti script baru.")) return;
    setRegenBusy(true);
    try {
      const draft = await generateStoryboard({
        topic: p.topic,
        scenes: p.sceneCount,
        langName: p.langName,
        character: p.charName,
        aspect: p.aspect,
        persona: p.persona,
        design: p.design,
        styleLabel: p.styleLabel,
        protagonist: p.protagonist,
        styleAnchor: p.styleAnchor,
        genre: p.genre,
      });
      const fresh = projectFromDraft(draft, {
        topic: p.topic,
        style: p.style,
        styleLabel: p.styleLabel,
        styleAnchor: p.styleAnchor,
        storyMode: p.storyMode,
        protagonist: p.protagonist,
        charName: p.charName,
        persona: p.persona,
        design: p.design,
        lang: p.lang,
        langName: p.langName,
        voice: p.voice,
        scenes: p.sceneCount,
        aspect: p.aspect,
        characterRef: p.characterRef,
        genre: p.genre,
      });
      pendingSave.current.clear();
      videoInputHashes.clear();
      videoOutputHashes.clear();
      commit({
        ...fresh,
        id: p.id,
        created: p.created,
        voiceStyle: p.voiceStyle,
        posterH: p.posterH,
        posterV: p.posterV,
        posterStatus: p.posterH || p.posterV ? ("ready" as const) : ("idle" as const),
        posterError: "",
        musicTitle: p.musicTitle,
        musicUrl: p.musicUrl,
      });
      setSelected(0);
      onToast("success", "Story rewritten", `${fresh.scenes.length} fresh scenes — generate again`);
    } catch (e) {
      onToast("error", "Rewrite failed", e instanceof Error ? e.message : String(e));
    } finally {
      setRegenBusy(false);
    }
  }

  const addScene = () => {
    const scenes = [...ref.current.scenes, { id: uid(), index: ref.current.scenes.length, narration: "New scene: describe what happens here.", imagePrompt: "A calm tale setting, warm light", aiImagePrompt: "", imageSource: "moment" as const, refScenes: null as number[] | null, refUsed: null as string | null, refFailed: false, imageQuality: "2K", voiceModel: "gemini-3.8-flash-tts", videoUrl: null as string | null, videoStatus: "idle" as const, videoError: "", videoRes: "360p", videoDur: 3, imageLargeReady: false, imageLargeUrl: null as string | null, imageUrl: null, audioUrl: null, audioSeconds: null, captions: null, imageStatus: "idle" as const, audioStatus: "idle" as const, imageError: "", audioError: "" }];
    commit({ ...ref.current, scenes: scenes.map((s, i) => ({ ...s, index: i })) });
    setSelected(scenes.length - 1);
  };

  const TAGS = ["[sigh]", "[laughing]", "[uhm]", "[whispering]", "[shouting]", "[sarcasm]", "[short pause]", "[medium pause]", "[long pause]"];

  /** Reference scene images actually usable (have media, not self). Null = Auto. */
  function effectiveRefs(scenes: StoryScene[], i: number): number[] {
    const manual = (scenes[i]?.refScenes ?? []).filter((k) => k !== i && scenes[k]?.imageUrl);
    if (manual.length) return manual.slice(0, 4);
    if (i > 0 && scenes[i - 1]?.imageUrl) return [i - 1];
    return [];
  }

  function toggleRef(k: number | "auto") {
    if (k === "auto") {
      patchScene(selected, { refScenes: null });
      return;
    }
    const cur = ref.current.scenes[selected]?.refScenes;
    if (!cur) {
      patchScene(selected, { refScenes: [k] });
      return;
    }
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k].sort((a, b) => a - b);
    // Min 1: unchecking the last box falls back to Auto instead of empty.
    patchScene(selected, { refScenes: next.length ? next : null });
  }

  const insertTag = (tag: string) => {
    const el = narrationRef.current;
    const s = ref.current.scenes[selected];
    if (!s) return;
    const start = el?.selectionStart ?? s.narration.length;
    const end = el?.selectionEnd ?? s.narration.length;
    const before = s.narration.slice(0, start);
    const after = s.narration.slice(end);
    const spacer = before && !before.endsWith(" ") ? " " : "";
    const next = `${before}${spacer}${tag} ${after}`.slice(0, 900);
    patchScene(selected, { narration: next });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = (before + spacer + tag + " ").length;
      el.setSelectionRange(pos, pos);
    });
  };

  const deleteScene = (i: number) => {    if (ref.current.scenes.length <= 1) return;
    const scenes = ref.current.scenes.filter((_, k) => k !== i).map((s, k) => ({ ...s, index: k }));
    commit({ ...ref.current, scenes });
    setSelected(Math.max(0, Math.min(selected, scenes.length - 1)));
  };

  // ------------------------------------------------------- poster helpers

  function loadImg(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const im = new Image();
      if (url.startsWith("http")) im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("unreadable image"));
      im.src = url;
    });
  }

  /** Stitch all finished scene images into one 2048px horizontal strip. */
  async function stitchScenes(urls: string[]): Promise<Blob | null> {
    try {
      const imgs = await Promise.all(urls.map(loadImg));
      const W = 2048;
      const H = 1024;
      const cw = W / imgs.length;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      imgs.forEach((im, k) => {
        const s = Math.max(cw / im.naturalWidth, H / im.naturalHeight);
        const dw = im.naturalWidth * s;
        const dh = im.naturalHeight * s;
        ctx.drawImage(im, k * cw + (cw - dw) / 2, (H - dh) / 2, dw, dh);
      });
      return await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    } catch {
      return null;
    }
  }

  /** Poster reference: stitched scenes when all are done, else the character. */
  async function posterRefs(): Promise<Blob[] | undefined> {
    const done = ref.current.scenes.filter((s) => s.imageUrl);
    if (done.length > 0 && done.length === ref.current.scenes.length) {
      const strip = await stitchScenes(done.map((s) => s.imageUrl as string));
      if (strip) return [strip];
    }
    if (ref.current.characterRef) {
      try {
        const r = await fetch(ref.current.characterRef);
        if (r.ok) {
          const b = await r.blob();
          if (b.type.startsWith("image/")) return [b];
        }
      } catch {}
    }
    return undefined;
  }

  async function generatePoster() {
    if (ref.current.posterStatus === "working") return;
    const base =
      ref.current.posterPrompt.trim() ||
      `${ref.current.title} — ${ref.current.subtitle}. Starring the tale's teller. Epic cover artwork for this story.`;
    commit({ ...ref.current, posterStatus: "working", posterError: "" });
    setPosterStep("Preparing reference…");
    try {
      const refs = await posterRefs();
      const anchor = ref.current.styleAnchor ? { anchor: ref.current.styleAnchor } : undefined;
      const refOpt = refs ? { refs, ...anchor } : anchor;
      const v = await generateSceneImage(`${base} Compose for a tall 9:16 vertical frame.`, ref.current.styleLabel, "9:16", refOpt);
      if (!v.url) throw new Error("empty poster response");
      commit({ ...ref.current, posterV: v.url });
      setPosterStep("Painting horizontal (2/2)…");
      const h = await generateSceneImage(`${base} Compose for a wide 16:9 horizontal frame.`, ref.current.styleLabel, "16:9", refOpt);
      if (!h.url) throw new Error("empty poster response");
      commit({ ...ref.current, posterH: h.url });
      setPosterStep("Saving full-size copies…");
      // Full-size files upload in the background; display swaps to R2 after.
      const owner = ownerRef.current;
      const pid = ref.current.id;
      const put = async (which: "h" | "v", url: string | null) => {
        if (!url) return null;
        try {
          const blob = url.startsWith("data:") ? dataUrlToBlob(url) : await (await fetch(url)).blob();
          if (!blob.type.startsWith("image/")) return null;
          if (CLOUD && owner) return await uploadCloudPoster(pid, owner, which, blob);
          return null;
        } catch {
          return null;
        }
      };
      const [hR2, vR2] = await Promise.all([put("h", h.url), put("v", v.url)]);
      const done: StoryProject = { ...ref.current, posterStatus: "ready" as const };
      if (hR2) done.posterH = hR2;
      if (vR2) done.posterV = vR2;
      commit(done);
      setPosterStep("");
      saveProject(ref.current);
    } catch (e) {
      commit({ ...ref.current, posterStatus: "error", posterError: e instanceof Error ? e.message : String(e) });
      setPosterStep("");
    }
  }

  // ------------------------------------------------------------------ UI

  return (
    <motion.section
      id="image-studio"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      className="scroll-mt-24 rounded-3xl border border-border bg-card/40 p-3 sm:p-4"
    >
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 gap-3">
          <div className="group relative shrink-0">
            {draft.posterV ? (
              <img src={draft.posterV} alt="Story poster" className="aspect-[9/16] w-16 rounded-xl object-cover ring-1 ring-border sm:w-20" />
            ) : (
              <span className="grid aspect-[9/16] w-16 place-items-center rounded-xl border border-dashed border-border-strong text-[10px] text-muted-foreground sm:w-20">
                poster
              </span>
            )}
            <button
              type="button"
              onClick={generatePoster}
              disabled={draft.posterStatus === "working"}
              title={draft.posterH || draft.posterV ? "Regenerate poster (vertical first, then horizontal)" : "Generate poster (vertical first, then horizontal)"}
              aria-label="Generate poster"
              className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/55 text-white opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-100 max-sm:opacity-100"
            >
              <RefreshCw className={`size-5 ${draft.posterStatus === "working" ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Scene studio · image story</p>
          <input
            value={draft.title}
            onChange={(e) => commit({ ...ref.current, title: e.target.value.slice(0, 120) })}
            aria-label="Story title"
            className="mt-1 w-full min-w-0 bg-transparent text-2xl font-medium tracking-tight outline-none placeholder:text-muted-foreground focus:underline focus:decoration-dotted focus:underline-offset-4"
            placeholder="Untitled story"
          />
          <input
            value={draft.subtitle}
            onChange={(e) => commit({ ...ref.current, subtitle: e.target.value.slice(0, 160) })}
            aria-label="Story subtitle"
            className="mt-0.5 w-full min-w-0 bg-transparent text-sm text-muted-foreground capitalize outline-none placeholder:normal-case placeholder:text-muted-foreground/60 focus:underline focus:decoration-dotted focus:underline-offset-4"
            placeholder="add a subtitle…"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            {[draft.styleLabel, draft.aspect, draft.langName, `${draft.scenes.length} scenes`, `~${Math.round(totalSecs)}s`, `${imagesReady}/${draft.scenes.length} images`, `${audiosReady}/${draft.scenes.length} voiceovers`].map((c) => (
              <span key={c} className="rounded-full border border-border bg-background/50 px-2.5 py-0.5 text-muted-foreground">
                {c}
              </span>
            ))}
            {CLOUD ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-0.5 text-muted-foreground" title={sync.status === "denied" ? "This story was created in another browser — cloud stays read-only here, edits save on this device" : "Story text auto-saves to the cloud; images and audio upload to R2 in the background"}>
                {sync.status === "saving" ? <Loader2 className="size-3 animate-spin" /> : sync.status === "saved" ? <Check className="size-3 text-success" /> : sync.status === "error" || sync.status === "denied" ? <CloudOff className="size-3 text-destructive" /> : <Cloud className="size-3" />}
                {sync.status === "saving" ? "Saving…" : sync.status === "saved" ? `Cloud saved${sync.at ? ` · ${new Date(sync.at).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}` : ""}` : sync.status === "error" ? "Cloud retrying…" : sync.status === "denied" ? "Not the owner here" : "Cloud ready"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background/50 px-2.5 py-0.5 text-muted-foreground" title="Set VITE_SHARE_API to enable cloud save">
                <CloudOff className="size-3" /> This browser only
              </span>
            )}
            {draft.posterStatus === "working" && posterStep ? (
              <span className="rounded-full border border-border bg-background/50 px-2.5 py-0.5 text-muted-foreground">
                Poster · {posterStep}
              </span>
            ) : null}
            {draft.posterError ? (
              <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 text-destructive">
                Poster failed — hover the poster and retry
              </span>
            ) : null}
          </div>
        </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setVoiceOpen(true)}
            title="Choose narrator voice"
            className="flex h-10 items-center gap-2 rounded-full border border-border bg-background/50 px-3.5 text-sm transition-colors hover:border-border-strong"
          >
            <Mic className="size-4 text-muted-foreground" />
            {draft.voice || "Kore"}
          </button>
          <RobinVoiceLibrary open={voiceOpen} onOpenChange={(o) => (o ? setVoiceOpen(true) : dismissModal("voice", () => setVoiceOpen(false)))} topic={draft.topic} selected={voiceValue} onSelect={(v) => v && commit({ ...ref.current, voice: v.voice_id })} />
          <button type="button" onClick={() => setPreviewOpen(true)} title="Play the story in a dialog" className="flex h-10 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm transition-colors hover:border-border-strong">
            <Play className="size-4" /> Preview
          </button>
          <button
            type="button"
            onClick={() => void regenerateStory()}
            disabled={regenBusy || imaging || voicing || videoing}
            title="Rewrite the script with the same settings (wipes images, videos & voiceovers)"
            className="flex h-10 items-center gap-1.5 rounded-full border border-border px-3.5 text-sm transition-colors hover:border-border-strong disabled:opacity-50"
          >
            {regenBusy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Rewrite
          </button>
          <button
            type="button"
            onClick={doExport}
            disabled={exporting}
            title="Download images, voiceovers and story files"
            className="flex h-10 items-center gap-2 rounded-full bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-70"
          >
            {exporting ? "Packing…" : "Export ZIP"}
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Package className="size-4" />}
          </button>

          <button
            type="button"
            onClick={() => setMusicOpen(true)}
            title="Background music"
            className="flex h-10 max-w-52 items-center gap-2 rounded-full border border-border bg-background/50 px-3.5 text-sm transition-colors hover:border-border-strong"
          >
            {musicBusy ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <MusicIcon className="size-4 shrink-0 text-muted-foreground" />}
            <span className="truncate">{draft.musicTitle || "Music"}</span>
            {draft.musicTitle && !musicBusy ? (
              <span
                role="button"
                tabIndex={0}
                aria-label="Remove music"
                onClick={(e) => {
                  e.stopPropagation();
                  pickMusic(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    pickMusic(null);
                  }
                }}
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" />
              </span>
            ) : null}
          </button>
          <MusicLibrary
            open={musicOpen}
            onOpenChange={(o) => (o ? setMusicOpen(true) : dismissModal("music", () => setMusicOpen(false)))}
            selected={draft.musicUrl ? { title: draft.musicTitle, url: draft.musicUrl } : null}
            voiceoverSeconds={draft.scenes.reduce((a, s) => a + (s.audioSeconds ?? 0), 0)}
            voiceoverCoverage={`${draft.scenes.filter((s) => (s.audioSeconds ?? 0) > 0).length}/${draft.scenes.length}`}
            onSelect={(m) => {
              setMusicOpen(false);
              pickMusic(m);
            }}
          />
        </div>
      </div>
      {zipMsg && <p className="mt-2 font-mono text-[11px] text-muted-foreground">{zipMsg}</p>}

      {/* voice direction */}
      <details className="mt-3 rounded-2xl border border-border bg-background/50 px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">
          Voice direction <span className="font-normal text-muted-foreground">· style prompt + markup tags for {draft.voice || "Kore"}</span>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <label htmlFor="voice-style" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Style prompt — sets the overall tone for every scene
            </label>
            <input
              id="voice-style"
              value={draft.voiceStyle}
              onChange={(e) => commit({ ...ref.current, voiceStyle: e.target.value.slice(0, 300) })}
              placeholder="e.g. Narrate in the calm, authoritative tone of a nature documentary narrator"
              className="w-full rounded-xl border border-border bg-background p-2.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-border-strong"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">Be specific: “React with an amused laugh” beats “sound happy”. Keep it consistent with the words being spoken.</p>
          </div>
          <div className="grid gap-3 text-xs leading-relaxed text-muted-foreground sm:grid-cols-3">
            <p><span className="font-medium text-foreground">1 · Style prompt</span> drives the overall emotion. <span className="font-medium text-foreground">2 · Text content</span> must match it — a scared tone needs scary words, not “the meeting is at 4 PM”. <span className="font-medium text-foreground">3 · Markup tags</span> inject one local action or style shift.</p>
            <p><span className="font-medium text-foreground">Sounds:</span> [sigh], [laughing], [uhm] — replaced by the sound itself. <span className="font-medium text-foreground">Style shifts:</span> [whispering], [shouting], [sarcasm], [robotic], [extremely fast] — shape what follows; pair with a matching style prompt.</p>
            <p><span className="font-medium text-foreground">Pauses:</span> [short pause] ≈250ms, [medium pause] ≈500ms, [long pause] ≈1s+ for drama. Punctuation also pauses naturally. Test any new tag once before bulk-generating — an untested tag can end up spoken aloud.</p>
          </div>
        </div>
      </details>

      {/* bulk bar — images, voiceover and poster run independently */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-background/50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-muted">
              <Images className="size-4 text-accent" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">Scene images</p>
              <p className="truncate text-xs text-muted-foreground">
                {imagesReady}/{draft.scenes.length}
              </p>
            </div>
            {imaging && (
              <button type="button" onClick={() => stopBulk("image")} className="flex h-9 items-center gap-1.5 rounded-full border border-destructive/40 px-3 text-xs text-destructive">
                <Square className="size-3.5 fill-current" /> Stop
              </button>
            )}
            <button
              type="button"
              disabled={imaging || videoing}
              onClick={() => bulk("image", true)}
              className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {imaging ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {imaging ? "Painting…" : "Generate missing"}
            </button>
            <button type="button" disabled={imaging || videoing} onClick={() => bulk("image", false)} title="Regenerate every scene image" className="flex h-9 items-center rounded-full border border-border px-3 text-xs transition-colors hover:border-border-strong disabled:opacity-50">
              All
            </button>
          </div>
          {imgMsg && <p className="font-mono text-[11px] text-muted-foreground">{imgMsg}</p>}
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-background/50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-muted">
              <AudioLines className="size-4 text-accent" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">Voiceover</p>
              <p className="truncate text-xs text-muted-foreground">
                {audiosReady}/{draft.scenes.length} ready · {draft.voice || "Kore"}
              </p>
            </div>
            {voicing && (
              <button type="button" onClick={() => stopBulk("audio")} className="flex h-9 items-center gap-1.5 rounded-full border border-destructive/40 px-3 text-xs text-destructive">
                <Square className="size-3.5 fill-current" /> Stop
              </button>
            )}
            <button
              type="button"
              disabled={voicing || videoing}
              onClick={() => bulk("audio", true)}
              className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {voicing ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}
              {voicing ? "Recording…" : "Generate missing"}
            </button>
            <button type="button" disabled={voicing || videoing} onClick={() => bulk("audio", false)} title="Regenerate every voiceover" className="flex h-9 items-center rounded-full border border-border px-3 text-xs transition-colors hover:border-border-strong disabled:opacity-50">
              All
            </button>
          </div>
          {audMsg && <p className="font-mono text-[11px] text-muted-foreground">{audMsg}</p>}
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-background/50 p-3 sm:col-span-2 lg:col-span-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-muted">
              <Clapperboard className="size-4 text-accent" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">Scene videos</p>
              <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                {videosReady}/{draft.scenes.length}
                {videoing && vidProg && vidProg.total > 0 && <ProgressRing value={vidProg.done / vidProg.total} />}
              </p>
            </div>
            {videoing && (
              <button type="button" onClick={() => stopBulk("video")} className="flex h-9 items-center gap-1.5 rounded-full border border-destructive/40 px-3 text-xs text-destructive">
                <Square className="size-3.5 fill-current" /> Stop
              </button>
            )}
            <button
              type="button"
              disabled={imaging || voicing || videoing}
              onClick={() => bulk("video", true)}
              title="Animate every scene that already has an image"
              className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {videoing ? <Loader2 className="size-3.5 animate-spin" /> : <Clapperboard className="size-3.5" />}
              {videoing ? "Filming…" : "Generate missing"}
            </button>
            <button type="button" disabled={videoing} onClick={() => bulk("video", false)} title="Regenerate every video that has an image" className="flex h-9 items-center rounded-full border border-border px-3 text-xs transition-colors hover:border-border-strong disabled:opacity-50">
              All
            </button>
          </div>
          {vidMsg && <p className="font-mono text-[11px] text-muted-foreground">{vidMsg}</p>}
        </div>
      </div>

      {/* workbench */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[410px_minmax(0,1fr)]">
        {/* timeline */}
        <div className="flex min-w-0 flex-col gap-2">
          <p className="px-1 text-xs font-medium text-muted-foreground">Timeline · {draft.scenes.length} scenes</p>
          <ol className="scrollbar-hide flex gap-2 overflow-x-auto pb-1 lg:max-h-[560px] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pr-1">
            {draft.scenes.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelected(i)}
                  className={cn(
                    "group flex w-52 shrink-0 gap-2.5 rounded-2xl border p-2 text-left transition-colors lg:w-full",
                    i === selected ? "border-primary/60 bg-primary/5" : "border-border bg-background/50 hover:border-border-strong",
                  )}
                >
                  <span className="relative flex max-h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                    {s.imageUrl ? (
                      <img src={s.imageUrl} alt="" loading="lazy" className="max-h-24 w-full object-contain" />
                    ) : (
                      <span className="flex size-full min-h-14 items-center justify-center font-mono text-lg text-muted-foreground/50">{String(i + 1).padStart(2, "0")}</span>
                    )}
                    {s.imageStatus === "working" && (
                      <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                        <Loader2 className="size-4 animate-spin" />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-1">
                      <span className="font-mono text-[11px] text-muted-foreground">SC {String(i + 1).padStart(2, "0")} · {Math.round(sceneSeconds(s))}s</span>
                      <span className="flex items-center gap-1">
                        <Dot ok={!!s.imageUrl} spin={s.imageStatus === "working"} label="image" />
                        <Dot ok={!!s.audioUrl} spin={s.audioStatus === "working"} label="audio" />
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-muted-foreground">{s.narration}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="flex gap-2">
            <button type="button" onClick={addScene} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-dashed border-border-strong text-xs text-muted-foreground transition-colors hover:text-foreground">
              <Plus className="size-3.5" /> Add scene
            </button>
            {draft.scenes.length > 1 && (
              <button type="button" onClick={() => deleteScene(selected)} aria-label="Delete selected scene" className="flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive">
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/* editor */}
        {scene && (
          <div key={scene.id} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-background/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Scene {selected + 1} <span className="font-normal text-muted-foreground">· {scene.narration.trim().split(/\s+/).filter(Boolean).length} words · ~{estimateSeconds(scene.narration)}s</span>
              </p>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">{draft.styleLabel} · locked</span>
            </div>
            <div>
              <label htmlFor="scene-narration" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Narration — what the voice says
              </label>
              <textarea
                id="scene-narration"
                ref={narrationRef}
                value={scene.narration}
                onChange={(e) => patchScene(selected, { narration: e.target.value.slice(0, 900) })}
                rows={4}
                className="w-full resize-y rounded-xl border border-border bg-background p-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60 focus:border-border-strong"
                placeholder="Write what the narrator says in this scene…"
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {TAGS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => insertTag(t)}
                    aria-label={`Insert ${t} at cursor`}
                    className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="scene-image" className="text-xs font-medium text-muted-foreground">
                  Image prompt — what the scene looks like
                </label>
                <div className="flex rounded-full border border-border p-0.5 text-[11px]" role="radiogroup" aria-label="Image prompt source">
                  {(
                    [
                      { id: "moment", label: "Moment + style" },
                      { id: "ai", label: "AI prompt" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={scene.imageSource === o.id}
                      onClick={() => patchScene(selected, { imageSource: o.id })}
                      className={cn(
                        "rounded-full px-2.5 py-1 transition-colors",
                        scene.imageSource === o.id ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              {scene.imageSource === "ai" ? (
                <textarea
                  id="scene-image"
                  value={scene.aiImagePrompt}
                  onChange={(e) => patchScene(selected, { aiImagePrompt: e.target.value.slice(0, 800) })}
                  rows={4}
                  className="w-full resize-y rounded-xl border border-border bg-background p-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60 focus:border-border-strong"
                  placeholder={scene.aiImagePrompt ? undefined : "The AI wrote no depiction for this scene — switch to Moment + style, or write one here…"}
                />
              ) : (
                <textarea
                  id="scene-image"
                  value={scene.imagePrompt}
                  onChange={(e) => patchScene(selected, { imagePrompt: e.target.value.slice(0, 600) })}
                  rows={3}
                  className="w-full resize-y rounded-xl border border-border bg-background p-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60 focus:border-border-strong"
                  placeholder="Describe the keyframe…"
                />
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                {scene.imageSource === "ai"
                  ? "Sent as the AI wrote it (only safety limits added)."
                  : `Wrapped with ${draft.styleLabel} · ${draft.aspect} · rich detail before sending.`}
              </p>
              {selected === 0 && draft.characterRef ? (
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-border p-1.5">
                  <img src={draft.characterRef} alt="Character reference" className="size-10 shrink-0 rounded-md object-cover" />
                  {scene.imageUrl ? (
                    scene.refUsed ? (
                      <p className="text-[11px] text-success">Generated with character reference.</p>
                    ) : scene.refFailed ? (
                      <p className="text-[11px] text-warning">Reference couldn't be attached — generated without it.</p>
                    ) : null
                  ) : (
                    <p className="text-[11px] text-muted-foreground">Character reference — scene 1 will follow this design.</p>
                  )}
                </div>
              ) : null}
              {selected > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    Reference
                  </span>
                  <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Reference scenes">
                    <button
                      type="button"
                      onClick={() => toggleRef("auto")}
                      aria-pressed={!scene.refScenes}
                      title="Auto: previous generated scene"
                      className={cn(
                        "flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] transition-colors",
                        !scene.refScenes ? "border-primary/60 bg-primary font-medium text-primary-foreground" : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
                      )}
                    >
                      {!scene.refScenes && <Check className="size-3" />} Auto
                    </button>
                    {draft.scenes.map((s, k) => {
                      if (k === selected) return null;
                      const ready = !!s.imageUrl;
                      const checked = !!scene.refScenes?.includes(k);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={!ready}
                          onClick={() => toggleRef(k)}
                          aria-pressed={checked}
                          title={ready ? `Use scene ${k + 1} as reference` : `Generate scene ${k + 1} first`}
                          className={cn(
                            "flex h-7 items-center gap-1 rounded-full border px-2.5 font-mono text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                            checked ? "border-primary/60 bg-primary font-medium text-primary-foreground" : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
                          )}
                        >
                          {checked && <Check className="size-3" />} {k + 1}
                        </button>
                      );
                    })}
                  </div>
                  {(() => {
                    const eff = effectiveRefs(draft.scenes, selected);
                    return eff.length ? (
                      <span className="text-[11px] text-muted-foreground">uses scene {eff.map((k) => k + 1).join("+")} at generate</span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/60">no reference yet — generate an earlier scene first</span>
                    );
                  })()}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label htmlFor="scene-quality" className="text-[11px] text-muted-foreground">
                  Quality
                </label>
                  <select
                    id="scene-quality"
                    value={scene.imageQuality}
                    onChange={(e) => cascadeForward({ imageQuality: e.target.value })}
                    className="h-8 cursor-pointer rounded-full border border-border bg-background px-2 text-xs outline-none transition-colors hover:border-border-strong"
                  >
                  {["512px", "1K", "2K", "4K"].map((q) => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
                <label htmlFor="scene-tts" className="ml-1 text-[11px] text-muted-foreground">
                  TTS
                </label>
                  <select
                    id="scene-tts"
                    value={scene.voiceModel}
                    onChange={(e) => cascadeForward({ voiceModel: e.target.value })}
                    className="h-8 max-w-52 cursor-pointer rounded-full border border-border bg-background px-2 text-xs outline-none transition-colors hover:border-border-strong"
                  >
                  <option value="gemini-3.8-flash-tts">3.8-flash-tts</option>
                  <option value="gemini-3.8-flash-lite-tts">3.8-flash-lite-tts</option>
                </select>
              </div>
              {selected > 0 && scene.imageUrl && scene.refUsed
                ? <p className="mt-1 text-[11px] text-success">Generated with {scene.refUsed} reference.</p>
                : null}
              {selected > 0 && scene.imageUrl && !scene.refUsed && scene.refFailed
                ? <p className="mt-1 text-[11px] text-warning">Reference image couldn't be attached — generated without it. Retry to try again.</p>
                : null}
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 lg:grid-cols-3">
              <div className="flex min-w-[85%] flex-col rounded-xl border border-border p-3 sm:min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <ImageIcon className="size-3.5 text-muted-foreground" /> Image
                  {scene.imageStatus === "ready" && scene.imageUrl && <Check className="size-3.5 text-success" />}
                  {scene.imageLargeUrl && (
                    <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-normal text-muted-foreground" title="Full-size file saved for the viewer and the zip">
                      full-size
                    </span>
                  )}
                </p>
                {scene.imageUrl && (
                  <div className="group relative mt-2 flex justify-center">
                    <img src={scene.imageUrl} alt="" className="h-auto max-h-[46vh] w-auto max-w-full rounded-lg object-contain" />
                    <button
                      type="button"
                      onClick={() => magnify(scene)}
                      aria-label="View full-size image"
                      className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-all group-hover:opacity-100 hover:bg-black/75 focus-visible:opacity-100 max-sm:opacity-100"
                    >
                      <ZoomIn className="size-4" />
                    </button>
                  </div>
                )}
                {scene.imageError && <p className="mt-2 text-xs text-destructive">{scene.imageError}</p>}
                {pendingSave.current.has(scene.id) && (
                  <button type="button" onClick={() => savePending(scene.id)} className="mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-full border border-border text-xs font-medium transition-colors hover:border-border-strong">
                    Retry save (no regenerate)
                  </button>
                )}
                <div className="mt-auto pt-2">
                  <button
                    type="button"
                    disabled={scene.imageStatus === "working" || imaging || videoing}
                    onClick={() => oneImage(selected)}
                    className="flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-primary text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {scene.imageStatus === "working" ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
                    {scene.imageUrl ? "Regenerate image" : "Generate image"}
                  </button>
                </div>
              </div>
              {scene.videoStatus !== "idle" || scene.videoUrl || scene.videoError || scene.imageUrl ? (
                <div className="group/vidmenu flex min-w-[85%] flex-col rounded-xl border border-border p-3 sm:min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <Clapperboard className="size-3.5 text-muted-foreground" /> Video
                    {scene.videoStatus === "ready" && scene.videoUrl && <Check className="size-3.5 text-success" />}
                  </p>
                  {scene.videoStatus === "working" ? (
                    <div className="relative mt-2 w-full overflow-hidden rounded-lg bg-muted" style={{ aspectRatio: draft.aspect.replace(":", " / "), maxHeight: "46vh" }} aria-label="Painting video">
                      {scene.imageUrl && (
                        <img src={scene.imageUrl} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-70 blur-xl brightness-[0.65]" />
                      )}
                      <motion.div
                        className="absolute top-[-20%] left-[-25%] size-3/5 rounded-full bg-white/10 blur-2xl"
                        animate={{ x: ["0%", "160%"], y: ["0%", "60%"] }}
                        transition={{ duration: 7, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
                      />
                      <motion.div
                        className="absolute right-[-20%] bottom-[-25%] size-1/2 rounded-full bg-white/10 blur-2xl"
                        animate={{ x: ["0%", "-160%"], y: ["0%", "-60%"] }}
                        transition={{ duration: 9, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
                      />
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <Loader2 className="size-5 animate-spin text-white/85" />
                        <span className="text-[11px] text-white/85">Painting {scene.videoDur}s video…</span>
                      </div>
                      <VideoMenu scene={scene} onPick={(p) => patchScene(selected, p)} />
                    </div>
                  ) : scene.videoUrl ? (
                    <div className="relative">
                      <SceneVideo key={scene.videoUrl} src={scene.videoUrl} />
                      <VideoMenu scene={scene} onPick={(p) => patchScene(selected, p)} />
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground" title={scene.videoUrl}>
                        vid {videoOutputHashes.get(scene.id)?.slice(0, 8) ?? scene.videoUrl.split("?")[0].split("/").pop()?.slice(-16)}
                      </p>
                    </div>
                  ) : scene.imageUrl ? (
                    <div className="relative mt-2 w-full overflow-hidden rounded-lg" style={{ aspectRatio: draft.aspect.replace(":", " / "), maxHeight: "46vh" }}>
                      <img src={scene.imageUrl} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover blur-xl brightness-[0.65]" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <button
                          type="button"
                          disabled={imaging || voicing || videoing}
                          onClick={() => oneVideo(selected)}
                          className="flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-xs font-medium text-primary-foreground shadow-xl transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          <Clapperboard className="size-4" /> Generate video
                        </button>
                      </div>
                      <VideoMenu scene={scene} onPick={(p) => patchScene(selected, p)} />
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">Generate the image first — video animates it.</p>
                  )}
                  {scene.videoError && <p className="mt-2 text-xs text-destructive">{scene.videoError}</p>}
                  {pendingSave.current.has(scene.id) && (
                    <button type="button" onClick={() => savePending(scene.id)} className="mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-full border border-border text-xs font-medium transition-colors hover:border-border-strong">
                      Retry save (no regenerate)
                    </button>
                  )}
                  {scene.videoUrl && scene.videoStatus === "ready" ? (
                    <div className="mt-auto pt-2">
                      <button
                        type="button"
                        disabled={imaging || voicing || videoing}
                        onClick={() => oneVideo(selected)}
                        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-primary text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        <Clapperboard className="size-3.5" />
                        Regenerate video
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="flex min-w-[85%] flex-col rounded-xl border border-border p-3 sm:min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <Mic className="size-3.5 text-muted-foreground" /> Voiceover · {draft.voice || "Kore"}
                  {scene.audioStatus === "ready" && scene.audioUrl && <Check className="size-3.5 text-success" />}
                </p>
                {scene.audioUrl ? (
                  <SceneAudio key={scene.audioUrl} src={scene.audioUrl} />
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No recording yet — generate it, then press play.</p>
                )}
                {scene.audioError && <p className="mt-2 text-xs text-destructive">{scene.audioError}</p>}
                {pendingSave.current.has(scene.id) && (
                  <button type="button" onClick={() => savePending(scene.id)} className="mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-full border border-border text-xs font-medium transition-colors hover:border-border-strong">
                    Retry save (no regenerate)
                  </button>
                )}
                <div className="mt-auto pt-2">
                  <button
                    type="button"
                    disabled={scene.audioStatus === "working" || voicing || videoing}
                    onClick={() => oneAudio(selected)}
                    className="flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-primary text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {scene.audioStatus === "working" ? <Loader2 className="size-3.5 animate-spin" /> : <Mic className="size-3.5" />}
                    {scene.audioUrl ? "Regenerate voiceover" : "Generate voiceover"}
                  </button>
                </div>
              </div>
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Download className="size-3" /> Tip: export the zip to finish editing in CapCut, Premiere or VN — images, WAVs, story.json and captions.srt are all inside.
            </p>
          </div>
        )}

        {/* preview lives in a dialog now — wider workbench */}
      </div>
      <AnimatePresence>
        {previewOpen && (
          <motion.div
            key="story-preview-dialog"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-background/80 p-4 backdrop-blur-md"
            onClick={() => dismissModal("preview", () => setPreviewOpen(false))}
            role="dialog"
            aria-modal="true"
            aria-label="Story preview"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
              className="w-full max-w-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium">{draft.title || "Untitled story"}</p>
                <button
                  type="button"
                  onClick={() => dismissModal("preview", () => setPreviewOpen(false))}
                  aria-label="Close preview"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
              <StoryPreview scenes={draft.scenes} title={draft.title || "Untitled story"} musicUrl={draft.musicUrl} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <Lightbox
        items={viewImg ? [{ url: viewImg.url, kind: "image" as const, caption: viewImg.caption }] : []}
        index={viewImg ? 0 : null}
        onIndex={() => {}}
        onClose={() => setViewImg(null)}
      />
    </motion.section>
  );
}

function Dot({ ok, spin, label }: { ok: boolean; spin: boolean; label: string }) {
  return (
    <span title={`${label}: ${spin ? "working" : ok ? "ready" : "missing"}`} className={cn("size-1.5 rounded-full", spin ? "animate-pulse bg-warning" : ok ? "bg-success" : "bg-muted-foreground/30")} />
  );
}
