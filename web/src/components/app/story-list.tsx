import { motion } from "motion/react";
import { Clock, Film, Images, Loader2, Mic, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EASE_OUT } from "@/lib/ease";
import { CLOUD, cloudOwner, deleteCloudStory, listCloudStories, loadCloudStory, type CloudSummary } from "@/lib/story/cloud";
import { forgetProject, saveProject, type StoryProject } from "@/lib/story/project";

type Props = {
  onOpen: (p: StoryProject) => void;
  onToast: (kind: "success" | "error" | "loading", title: string, description?: string) => void;
};

const ago = (t: number) => {
  const d = Math.max(0, Date.now() / 1000 - t);
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return new Date(t * 1000).toLocaleDateString("en", { day: "numeric", month: "short" });
};

export function CloudStoryList({ onOpen, onToast }: Props) {
  const [stories, setStories] = useState<CloudSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!CLOUD) return;
    setLoading(true);
    setError("");
    try {
      setStories(await listCloudStories());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!CLOUD) return null;

  async function open(id: string) {
    setOpening(id);
    try {
      const p = await loadCloudStory(id);
      saveProject(p);
      onOpen(p);
    } catch (e) {
      onToast("error", "Could not open story", e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(null);
    }
  }

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
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE_OUT }}
      className="rounded-3xl border border-border bg-card/40 p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium tracking-tight">Cloud stories</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {loading ? "Loading…" : `${stories.length} saved · text in D1, images and audio in R2`}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-xs transition-colors hover:border-border-strong disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Clock className="size-3.5" />}
          Refresh
        </button>
      </div>

      {error && <p className="mt-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {!loading && !error && stories.length === 0 && (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border-strong py-10 text-center">
          <Film className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No cloud stories yet</p>
          <p className="max-w-72 text-xs text-muted-foreground">Fill the form above and make a story — it saves here automatically, with images and voiceovers in R2.</p>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stories.map((s) => (
          <article key={s.id} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-background/50">
            <button type="button" onClick={() => open(s.id)} className="relative block aspect-video w-full overflow-hidden bg-muted text-left" aria-label={`Open ${s.title}`}>
              {s.thumb ? (
                <img src={s.thumb} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
              ) : (
                <span className="flex size-full items-center justify-center font-mono text-2xl text-muted-foreground/40">{s.scene_count}</span>
              )}
              <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-px font-mono text-[10px] text-white">{s.scene_count} scenes</span>
              {opening === s.id && (
                <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Loader2 className="size-5 animate-spin" />
                </span>
              )}
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
              <p className="truncate text-sm font-medium">{s.title || "Untitled story"}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Images className="size-3" />{s.images}</span>
                <span className="inline-flex items-center gap-1"><Mic className="size-3" />{s.audios}</span>
                <span>{s.aspect}</span>
                <span>· {ago(s.updated)}</span>
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => open(s.id)}
                  disabled={opening === s.id}
                  className="flex h-8 flex-1 items-center justify-center gap-1 rounded-full bg-primary text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Plus className="size-3.5" /> Open in studio
                </button>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  disabled={deleting === s.id}
                  aria-label={`Delete ${s.title}`}
                  className="flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
                >
                  {deleting === s.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </motion.section>
  );
}
