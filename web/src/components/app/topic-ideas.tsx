import { motion } from "motion/react";
import { Check, Dices, Loader2, Search, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/motion/button/base";
import { Drawer } from "@/components/motion/drawer";
import { Input } from "@/components/motion/input";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { EASE_OUT } from "@/lib/ease";
import { dismissModal, useModalHash } from "@/lib/router";
import { cn } from "@/lib/utils";
import { suggestTopics } from "@/lib/story/robin";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (topic: string) => void;
};

export function TopicIdeas({ open, onOpenChange, onSelect }: Props) {
  const [ideas, setIdeas] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const seen = useRef<string[]>([]);
  const abort = useRef<AbortController | null>(null);

  useModalHash("topics", open, () => onOpenChange(false));

  const fetchIdeas = async (append: boolean) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setLoading(true);
    if (!append) setError("");
    try {
      const list = await suggestTopics(20, append ? seen.current : [], ctrl.signal);
      if (abort.current !== ctrl) return;
      seen.current = [...seen.current, ...list].slice(-120);
      setIdeas((prev) => {
        const merged = append ? [...prev, ...list] : list;
        return [...new Set(merged)].slice(0, 120);
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      if (abort.current === ctrl) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (ideas.length === 0) fetchIdeas(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const needle = search.toLowerCase().trim();
  const shown = needle ? ideas.filter((t) => t.toLowerCase().includes(needle)) : ideas;

  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(true) : dismissModal("topics", () => onOpenChange(false)))} side="right" ariaLabel="Topic ideas" className="w-full max-w-[min(560px,100vw)] sm:w-[480px]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-border px-5 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-medium tracking-tight">
                <Sparkles className="size-4 text-accent" /> Topic ideas
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Fresh from trending topics · always different</p>
            </div>
            <button type="button" onClick={() => dismissModal("topics", () => onOpenChange(false))} aria-label="Close" className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-4 flex gap-2">
            <Input value={search} onChange={setSearch} placeholder="Filter ideas…" leftIcon={<Search className="size-4" />} className="flex-1" />
            <Button
              variant="secondary"
              size="md"
              disabled={loading}
              onClick={() => fetchIdeas(true)}
              title="More fresh ideas"
              className="h-10 shrink-0"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Dices className="size-4" />}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {error && <p className="px-3 py-6 text-center text-sm text-destructive">{error}</p>}

          <ul className="flex flex-col">
            {shown.map((t, i) => (
              <motion.li
                key={`${t}-${i}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: EASE_OUT }}
                className={cn("group flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-muted/60")}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 text-sm leading-snug">{t}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onSelect(t);
                    dismissModal("topics", () => onOpenChange(false));
                  }}
                  className="shrink-0"
                >
                  <Check className="size-3.5" /> Use
                </Button>
              </motion.li>
            ))}
          </ul>

          {!loading && shown.length === 0 && !error && (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">No ideas yet — tap the dice.</p>
          )}
          {loading && (
            <div className="flex justify-center py-6">
              <TextShimmer className="text-sm">Dreaming up topics…</TextShimmer>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
