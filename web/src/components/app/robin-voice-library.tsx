import { motion } from "motion/react";
import { Check, Loader2, Pause, Play, Search, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/motion/button/base";
import { Drawer } from "@/components/motion/drawer";
import { Input } from "@/components/motion/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { EASE_OUT } from "@/lib/ease";
import { usePlayer } from "@/lib/use-player";
import { dismissModal, useModalHash } from "@/lib/router";
import { cn } from "@/lib/utils";
import { auditionRobinVoice, ROBIN_PREVIEW_LINE, robinVoices } from "@/lib/story/robin";
import type { Voice } from "@/lib/api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: string;
  selected: Voice | null;
  onSelect: (v: Voice | null) => void;
};

let cache: Promise<Voice[]> | null = null;
function all(signal?: AbortSignal): Promise<Voice[]> {
  cache ??= robinVoices(signal).catch((e) => {
    cache = null;
    throw e;
  });
  return cache;
}

export function RobinVoiceLibrary({ open, onOpenChange, topic, selected, onSelect }: Props) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [gender, setGender] = useState("");
  const [auditioning, setAuditioning] = useState<string | null>(null);
  const player = usePlayer();

  useModalHash("voice", open, () => onOpenChange(false));

  useEffect(() => {
    if (!open) {
      player.stop();
      return;
    }
    let live = true;
    setLoading(true);
    setError("");
    all()
      .then((vs) => live && setVoices(vs))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const genders = useMemo(() => [...new Set(voices.map((v) => v.gender).filter(Boolean))], [voices]);

  const shown = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return voices.filter((v) => {
      if (gender && v.gender !== gender) return false;
      if (needle && !`${v.name} ${v.description} ${v.gender}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [voices, search, gender]);

  function audition(v: Voice, withTopic: boolean) {
    if (!withTopic) {
      // Real Chirp3-HD sample recording — instant, no synthesis needed.
      player.toggle(v.voice_id, v.preview_url || auditionRobinVoice(v.voice_id, ROBIN_PREVIEW_LINE));
      return;
    }
    setAuditioning(`${v.voice_id}:topic`);
    const text = withTopic && topic.trim() ? `Halo, aku narator ceritamu. Kisah hari ini: ${topic.trim().slice(0, 160)}.` : ROBIN_PREVIEW_LINE;
    auditionRobinVoice(v.voice_id, text)
      .then((url) => player.toggle(withTopic ? `${v.voice_id}:topic` : v.voice_id, url))
      .catch(() => {})
      .finally(() => setAuditioning(null));
  }

  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(true) : dismissModal("voice", () => onOpenChange(false)))} side="right" ariaLabel="Voice library" className="w-full max-w-[min(780px,100vw)] sm:w-[740px]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-border px-5 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium tracking-tight">Voice library</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {voices.length} voices · every voice speaks your story through Robin TTS
              </p>
            </div>
            <button type="button" onClick={() => dismissModal("voice", () => onOpenChange(false))} aria-label="Close" className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-4 flex gap-2">
            <Input value={search} onChange={setSearch} placeholder="Search names, moods…" leftIcon={<Search className="size-4" />} className="flex-1" />
          </div>
          {genders.length > 0 && (
            <div className="mt-3 flex">
              <Tabs value={gender || "any"} onValueChange={(v) => setGender(v === "any" ? "" : v)} variant="segment">
                <TabsList>
                  <TabsTrigger value="any">Any</TabsTrigger>
                  {genders.map((g) => (
                    <TabsTrigger key={g} value={g}>
                      {g}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {error && <p className="px-3 py-6 text-center text-sm text-destructive">{error}</p>}

          <ul className="flex flex-col">
            {shown.map((v) => {
              const isSel = selected?.voice_id === v.voice_id;
              const playingPreview = player.playing === v.voice_id;
              const playingLine = player.playing === `${v.voice_id}:topic`;
              return (
                <motion.li
                  key={v.voice_id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: EASE_OUT }}
                  className={cn("group flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors", isSel ? "bg-primary/8" : "hover:bg-muted/60")}
                >
                  <button
                    type="button"
                    onClick={() => audition(v, false)}
                    aria-label={playingPreview ? `Pause ${v.name}` : `Play ${v.name}`}
                    className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-foreground ring-1 ring-border transition-transform active:scale-95"
                  >
                    {playingPreview ? <Pause className="size-4 fill-current" /> : <Play className="size-4 translate-x-px fill-current" />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{v.name}</span>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{[v.gender, v.description].filter(Boolean).join(" · ")}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => audition(v, true)}
                    aria-label={`Hear ${v.name} read your topic`}
                    title="Hear it read your topic"
                    className={cn("flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted", playingLine ? "text-primary" : "text-muted-foreground")}
                  >
                    {auditioning === `${v.voice_id}:topic` ? <Loader2 className="size-4 animate-spin" /> : <Volume2 className="size-4" />}
                  </button>
                  <Button
                    variant={isSel ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => {
                      onSelect(v);
                      player.stop();
                      onOpenChange(false);
                    }}
                    className="shrink-0"
                  >
                    {isSel ? <Check className="size-3.5" /> : null}
                    {isSel ? "Chosen" : "Use"}
                  </Button>
                </motion.li>
              );
            })}
          </ul>

          {!loading && shown.length === 0 && !error && <p className="px-3 py-10 text-center text-sm text-muted-foreground">No voices match.</p>}
          {loading && (
            <div className="flex justify-center py-6">
              <TextShimmer className="text-sm">Finding voices…</TextShimmer>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
