import { motion } from "motion/react";import { Check, Disc3, Loader2, Pause, Play, Search, X } from "lucide-react";import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/motion/button/base";
import { Drawer } from "@/components/motion/drawer";
import { Input } from "@/components/motion/input";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { EASE_OUT } from "@/lib/ease";
import { usePlayer } from "@/lib/use-player";
import { dismissModal, useModalHash } from "@/lib/router";
import { cn } from "@/lib/utils";
import { fmtDur, proxiedAudio, recommendMusic, searchMusic, trackUrl, type MusicTrack } from "@/lib/story/music";

export type MusicChoice = { title: string; url: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: MusicChoice | null;
  onSelect: (m: MusicChoice | null) => void;
  /** Sum of generated voiceover seconds (filled scenes only) — guides the pick. */
  voiceoverSeconds: number;
  /** "3/8" — how many scenes already have a voiceover. */
  voiceoverCoverage: string;
};

const PAGE = 20;

function SelectedCard({ title, playing, onToggle, onRemove }: { title: string; playing: boolean; onToggle: () => void; onRemove: () => void }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
      className="mb-2 flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/5 px-3 py-3"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={playing ? "Pause selected track" : "Play selected track"}
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-foreground ring-1 ring-border transition-transform active:scale-95"
      >
        {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 translate-x-px fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title || "Selected track"}</span>
        <p className="mt-0.5 text-xs text-primary">Currently selected</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove music"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </motion.li>
  );
}

export function MusicLibrary({ open, onOpenChange, selected, onSelect, voiceoverSeconds, voiceoverCoverage }: Props) {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const player = usePlayer();
  const abort = useRef<AbortController | null>(null);

  useModalHash("music", open, () => onOpenChange(false));

  const load = async (q: string, cur: number, append: boolean) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    if (append) setMoreLoading(true);
    else {
      setLoading(true);
      setError("");
    }
    try {
      const res = q ? await searchMusic(q, cur, PAGE, ctrl.signal) : await recommendMusic(cur, PAGE, ctrl.signal);
      setTracks((prev) => (append ? [...prev, ...res.tracks.filter((t) => !prev.some((x) => x.id === t.id))] : res.tracks));
      setCursor(res.cursor);
      setHasMore(res.hasMore);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      if (abort.current === ctrl) {
        setLoading(false);
        setMoreLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!open) {
      player.stop();
      return;
    }
    load(query, 0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim() !== query) {
        setQuery(search.trim());
        if (open) load(search.trim(), 0, false);
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(true) : dismissModal("music", () => onOpenChange(false)))} side="right" ariaLabel="Music library" className="w-full max-w-[min(560px,100vw)] sm:w-[480px]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-border px-5 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium tracking-tight">Background music</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {voiceoverSeconds > 0 ? (
                  <>Story voiceover ≈ <span className="font-medium text-foreground">{fmtDur(voiceoverSeconds)}</span> ({voiceoverCoverage} scenes) — pick a track that covers it</>
                ) : (
                  <>Generate voiceovers first to see the story length here</>
                )}
              </p>
            </div>
            <button type="button" onClick={() => dismissModal("music", () => onOpenChange(false))} aria-label="Close" className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-4">
            <Input
              value={search}
              onChange={setSearch}
              placeholder="Search mood, kids song…"
              leftIcon={<Search className="size-4" />}
              rightIcon={
                search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                    className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : undefined
              }
              className="flex-1"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              player.stop();
              dismissModal("music", () => onOpenChange(false));
            }}
            className={cn(
              "mb-2 flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors",
              selected ? "border-border hover:bg-muted/60" : "border-primary/40 bg-primary/5",
            )}
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted">
              <Disc3 className="size-4 text-accent" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">No music</span>
              <span className="block text-xs text-muted-foreground">Story without background track</span>
            </span>
            {!selected && <Check className="size-4 text-primary" />}
          </button>

          {error && <p className="px-3 py-6 text-center text-sm text-destructive">{error}</p>}

          <ul className="flex flex-col">
            {selected && !tracks.some((t) => trackUrl(t) === selected.url) && (
              <SelectedCard
                title={selected.title}
                playing={player.playing === "selected-track"}
                onToggle={() => player.toggle("selected-track", selected.url)}
                onRemove={() => onSelect(null)}
              />
            )}
            {tracks.map((t) => {
              const isSel = !!selected && (trackUrl(t) === selected.url || (!selected.url && selected.title === t.title));
              const playing = player.playing === t.id;
              return (
                <motion.li
                  key={t.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: EASE_OUT }}
                  className={cn("group flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors", isSel ? "bg-primary/8" : "hover:bg-muted/60")}
                >
                  <button
                    type="button"
                    onClick={() => player.toggle(t.id, trackUrl(t))}
                    aria-label={playing ? `Pause ${t.title}` : `Play ${t.title}`}
                    className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card text-foreground ring-1 ring-border transition-transform active:scale-95"
                  >
                    {t.cover ? (
                      <img src={t.cover} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
                    ) : (
                      <Disc3 className="size-4 text-muted-foreground" />
                    )}
                    <span className={cn("absolute inset-0 flex items-center justify-center bg-black/45 transition-opacity", playing ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                      {playing ? <Pause className="size-4 fill-current text-white" /> : <Play className="size-4 translate-x-px fill-current text-white" />}
                    </span>
                  </button>

                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t.title}</span>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[t.author, fmtDur(t.duration)].filter(Boolean).join(" · ")}
                      {voiceoverSeconds > 0 && t.duration > 0 && (
                        <span className={cn("ml-1.5 font-medium", t.duration >= voiceoverSeconds ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
                          {t.duration >= voiceoverSeconds ? "· covers story" : "· too short"}
                        </span>
                      )}
                    </p>
                  </div>

                  <Button
                    variant={isSel ? "primary" : "secondary"}
                    size="sm"
                    onClick={() => {
                      onSelect({ title: `${t.title}${t.author ? ` — ${t.author}` : ""}`, url: proxiedAudio(t.playUrl) });
                      player.stop();
                      dismissModal("music", () => onOpenChange(false));
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

          {!loading && tracks.length === 0 && !error && (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">No tracks found.</p>
          )}
          {loading && (
            <div className="flex justify-center py-6">
              <TextShimmer className="text-sm">Finding music…</TextShimmer>
            </div>
          )}
          {!loading && hasMore && tracks.length > 0 && (
            <div className="flex justify-center py-4">
              <Button variant="secondary" size="sm" disabled={moreLoading} onClick={() => load(query, cursor, true)}>
                {moreLoading ? <Loader2 className="size-3.5 animate-spin" /> : null} Load more
              </Button>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
