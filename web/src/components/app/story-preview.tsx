import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Images, Pause, Play, RotateCcw, StepBack, StepForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { sceneSeconds, type StoryScene } from "@/lib/story/project";

type Props = { scenes: StoryScene[]; title: string; musicUrl?: string | null };

const KB = ["kb-drift-a", "kb-drift-b", "kb-zoom-a", "kb-zoom-b"];
const MUSIC_VOLUME = 0.15;

export function StoryPreview({ scenes, title, musicUrl }: Props) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [dir, setDir] = useState(1);
  const audio = useRef<HTMLAudioElement | null>(null);
  const music = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastPlayed = useRef(-1);

  const ready = scenes.filter((s) => s.imageUrl || s.audioUrl || s.narration);
  const current: StoryScene | undefined = scenes[index];
  const total = useMemo(() => scenes.reduce((a, s) => a + sceneSeconds(s), 0), [scenes]);

  const go = (d: number) => {
    if (!scenes.length) return;
    setDir(d);
    setEnded(false);
    // Clamped — never wraps. Passing the end is handled by advance().
    setIndex((i) => Math.min(scenes.length - 1, Math.max(0, i + d)));
  };

  /** Called when the current scene's playback window is over. */
  const advance = () => {
    if (index >= scenes.length - 1) {
      // No next scene: stop on the last frame, never loop by itself.
      lastPlayed.current = -1;
      setPlaying(false);
      setEnded(true);
    } else {
      setDir(1);
      setEnded(false);
      setIndex(index + 1);
    }
  };

  useEffect(() => {
    setIndex(0);
    setPlaying(false);
    setEnded(false);
    lastPlayed.current = -1;
  }, [scenes.length]);

  useEffect(() => {
    window.clearTimeout(timer.current);
    const a = audio.current;
    if (!playing || !current) {
      a?.pause();
      return;
    }
    // Resume in place when pausing/playing the same scene — don't restart it.
    if (lastPlayed.current === index && a && a.src) {
      a.play().catch(() => {
        timer.current = window.setTimeout(() => advance(), sceneSeconds(current) * 1000);
      });
      return () => window.clearTimeout(timer.current);
    }
    lastPlayed.current = index;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    if (current.audioUrl) {
      if (!a) return;
      a.src = current.audioUrl;
      a.play().catch(() => {
        timer.current = window.setTimeout(() => advance(), sceneSeconds(current) * 1000);
      });
    } else {
      timer.current = window.setTimeout(() => advance(), Math.min(9000, sceneSeconds(current!) * 1000));
    }
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, index]);

  // Background music at low volume for the whole preview run.
  useEffect(() => {
    const m = music.current;
    if (!m) return;
    m.volume = MUSIC_VOLUME;
    m.loop = true;
    if (playing && musicUrl) {
      if (m.src !== musicUrl) {
        m.src = musicUrl;
        m.currentTime = 0;
      }
      m.play().catch(() => {});
    } else {
      m.pause();
      if (ended) m.currentTime = 0;
    }
  }, [playing, ended, musicUrl]);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      audio.current?.pause();
      music.current?.pause();
    },
    [],
  );

  if (!scenes.length) {
    return (
      <div className="flex min-h-60 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-strong bg-background/30 text-center">
        <Images className="size-6 text-muted-foreground" />
        <p className="max-w-60 text-xs text-muted-foreground">Generate the storyboard first — every scene lands here for preview.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-black">
      <audio
        ref={audio}
        onEnded={() => advance()}
        onError={() => {
          if (current && playing) timer.current = window.setTimeout(() => advance(), sceneSeconds(current) * 1000);
        }}
      />
      <audio ref={music} preload="none" />
      {/* stage — the card fits the image, never the other way around */}
      <div className="preview-perspective relative flex min-h-60 w-full items-center justify-center overflow-hidden bg-black">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={current?.id ?? index}
            custom={dir}
            initial={reduce ? { opacity: 0 } : { opacity: 0, rotateY: dir * 70, transformOrigin: dir > 0 ? "left center" : "right center" }}
            animate={{ opacity: 1, rotateY: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, rotateY: dir * -55, transformOrigin: dir > 0 ? "right center" : "left center" }}
            transition={{ duration: 0.65, ease: EASE_OUT }}
            className="preview-page relative flex w-full items-center justify-center"
          >
            {current?.imageUrl ? (
              <img
                key={current.id}
                src={current.imageUrl}
                alt={`Scene ${index + 1}`}
                className={cn("max-h-[68vh] w-auto max-w-full object-contain", !reduce && KB[index % KB.length])}
                style={!reduce ? { animationDuration: `${Math.max(6, sceneSeconds(current))}s` } : undefined}
              />
            ) : (
              <div className="flex min-h-60 w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#232323] to-black">
                <span className="font-mono text-5xl text-white/15">{String(index + 1).padStart(2, "0")}</span>
                <span className="text-xs text-white/50">No image yet — generate it below</span>
              </div>
            )}
            <span className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/60 to-transparent" />
            <p className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-3 text-[11px] font-medium text-white/85">
              <span className="truncate">{title}</span>
              <span className="ml-2 shrink-0 rounded-full bg-white/15 px-2 py-0.5 font-mono backdrop-blur-sm">
                {index + 1} / {scenes.length}
              </span>
            </p>
          </motion.div>
        </AnimatePresence>
        {(!playing || ended) && (
          <button
            type="button"
            onClick={() => {
              if (ended) {
                lastPlayed.current = -1;
                setDir(1);
                setEnded(false);
                setIndex(0);
                setPlaying(true);
              } else setPlaying(true);
            }}
            aria-label={ended ? "Replay story" : "Play story"}
            className="absolute top-1/2 left-1/2 z-10 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-xl transition-colors hover:bg-white/25"
          >
            {ended ? <RotateCcw className="size-6" /> : <Play className="size-6 translate-x-0.5 fill-current" />}
          </button>
        )}
      </div>
      {/* controls — play/pause + prev/next only */}
      <div className="flex items-center justify-center gap-1 border-t border-white/10 bg-[#141414] px-3 py-2 text-white">
        <button type="button" onClick={() => go(-1)} aria-label="Previous scene" className="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-white/15">
          <StepBack className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (ended) {
              lastPlayed.current = -1;
              setDir(1);
              setEnded(false);
              setIndex(0);
              setPlaying(true);
            } else setPlaying((p) => !p);
          }}
          aria-label={ended ? "Replay" : playing ? "Pause" : "Play"}
          className="flex size-11 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105 active:scale-95"
        >
          {playing && !ended ? <Pause className="size-5 fill-current" /> : ended ? <RotateCcw className="size-5" /> : <Play className="size-5 translate-x-px fill-current" />}
        </button>
        <button type="button" onClick={() => go(1)} aria-label="Next scene" className="flex size-9 items-center justify-center rounded-full transition-colors hover:bg-white/15">
          <StepForward className="size-4" />
        </button>
      </div>
      <p className="border-t border-white/10 bg-[#141414] px-4 py-1.5 text-center font-mono text-[10px] text-white/45">
        ~{Math.round(total)}s story · {ready.length}/{scenes.length} scenes with media
      </p>
    </div>
  );
}
