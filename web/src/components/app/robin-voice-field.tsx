import { AnimatePresence, motion } from "motion/react";
import { Library, Loader2, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RobinVoiceLibrary } from "@/components/app/robin-voice-library";
import { EASE_OUT } from "@/lib/ease";
import { usePlayer } from "@/lib/use-player";
import { dismissModal } from "@/lib/router";
import { auditionRobinVoice, ROBIN_PREVIEW_LINE, robinVoices } from "@/lib/story/robin";
import type { Voice } from "@/lib/api";

type Props = {
  value: Voice | null;
  onChange: (v: Voice | null) => void;
  lang: string;
  topic: string;
};

export function RobinVoiceField({ value, onChange, lang, topic }: Props) {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState(0);
  const [auditioning, setAuditioning] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    let live = true;
    robinVoices()
      .then((vs) => {
        if (!live) return;
        setTotal(vs.length);
        if (!vs.length || valueRef.current) return;
        onChange(vs.find((v) => v.voice_id === "Kore") ?? vs[0]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const player = usePlayer();
  const playing = !!value && player.playing === value.voice_id;

  async function preview() {
    if (!value || auditioning) return;
    if (playing) {
      player.stop();
      return;
    }
    // Real sample when available; otherwise synthesize once and cache.
    if (value.preview_url) {
      await player.toggle(value.voice_id, value.preview_url);
      return;
    }
    setAuditioning(true);
    try {
      const text = topic.trim()
        ? `Halo, aku narator ceritamu. Kisah hari ini: ${topic.trim().slice(0, 160)}.`
        : ROBIN_PREVIEW_LINE;
      const url = await auditionRobinVoice(value.voice_id, `${lang}|${text}`);
      await player.toggle(value.voice_id, url);
    } catch {
      // preview is best-effort; errors surface when generating for real
    } finally {
      setAuditioning(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/50 p-2 pr-2.5">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={value?.voice_id ?? "loading"}
          initial={{ opacity: 0, filter: "blur(6px)", y: 4 }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          exit={{ opacity: 0, filter: "blur(6px)", y: -4 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <button
            type="button"
            onClick={preview}
            disabled={!value}
            aria-label={playing ? "Pause preview" : "Play preview"}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card ring-1 ring-border disabled:opacity-50"
          >
            {auditioning ? <Loader2 className="size-4 animate-spin" /> : playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 translate-x-px fill-current" />}
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{value ? value.name : "Loading voices…"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {value ? [value.gender, value.description].filter(Boolean).join(" · ") || "Robin voice" : "Fetching the voice list"}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
      {total > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium transition-colors hover:border-border-strong"
        >
          <Library className="size-3.5" />
          {`${total.toLocaleString("en")} voices`}
        </button>
      )}
      {total > 0 && <RobinVoiceLibrary open={open} onOpenChange={(o) => (o ? setOpen(true) : dismissModal("voice", () => setOpen(false)))} topic={topic} selected={value} onSelect={onChange} />}
    </div>
  );
}
