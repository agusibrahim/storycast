import { Check, Loader2, Play, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/motion/button/base";
import { Drawer } from "@/components/motion/drawer";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { cn } from "@/lib/utils";
import { dismissModal, useModalHash } from "@/lib/router";
import { CLOUD, cloudOwner, deleteCloudStory, listCloudStories, type CloudSummary } from "@/lib/story/cloud";
import { forgetProject } from "@/lib/story/project";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentId?: string | null;
  onSelect: (id: string) => void;
  onToast: (kind: "success" | "error" | "loading", title: string, description?: string) => void;
};

const ago = (t: number) => {
  const d = Math.max(0, Date.now() / 1000 - t);
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return new Date(t * 1000).toLocaleDateString("en", { day: "numeric", month: "short" });
};

export function StoryListModal({ open, onOpenChange, currentId, onSelect, onToast }: Props) {
  const [stories, setStories] = useState<CloudSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useModalHash("stories", open, () => onOpenChange(false));

  useEffect(() => {
    if (!open || !CLOUD) return;
    let live = true;
    setLoading(true);
    listCloudStories()
      .then((list) => live && setStories(list))
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [open ]);

  async function remove(id: string) {
    if (!window.confirm("Delete this story from the cloud? Its images and audio go with it.")) return;
    setDeleting(id);
    try {
      const owner = cloudOwner(id);
      if (!owner) throw new Error("no delete permission for the cloud copy (this browser did not create it)");
      await deleteCloudStory(id, owner);
      forgetProject(id);
      setStories((prev) => prev.filter((s) => s.id !== id));
      onToast("success", "Story deleted");
    } catch (e) {
      onToast("error", "Delete failed", e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(true) : dismissModal("stories", () => onOpenChange(false)))} side="right" ariaLabel="My stories" className="w-full max-w-[min(560px,100vw)] sm:w-[480px]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-medium tracking-tight">My stories</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{stories.length} saved in the cloud</p>
          </div>
            <button type="button" onClick={() => dismissModal("stories", () => onOpenChange(false))} aria-label="Close" className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="flex justify-center py-10">
              <TextShimmer className="text-sm">Loading stories…</TextShimmer>
            </div>
          ) : stories.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">No cloud stories yet.</p>
          ) : (
            <ul className="flex flex-col">
              {stories.map((s) => {
                const isCurrent = s.id === currentId;
                return (
                  <li key={s.id} className={cn("flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors", isCurrent ? "bg-primary/8" : "hover:bg-muted/60")}>
                    <span className="relative block aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {s.thumb ? (
                        <img src={s.thumb} alt="" loading="lazy" className="size-full object-cover" />
                      ) : (
                        <span className="grid size-full place-items-center font-mono text-lg text-muted-foreground/50">{s.scene_count}</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.title || "Untitled story"}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {s.scene_count} scenes · {s.aspect} · {ago(s.updated)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(s.id)}
                      disabled={deleting === s.id}
                      aria-label={`Delete ${s.title}`}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50"
                    >
                      {deleting === s.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    </button>
                    <Button
                      variant={isCurrent ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => {
                        onSelect(s.id);
                        onOpenChange(false);
                      }}
                      className="shrink-0"
                    >
                      {isCurrent ? <Check className="size-3.5" /> : <Play className="size-3.5" />}
                      Open
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Drawer>
  );
}
