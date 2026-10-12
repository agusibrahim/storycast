import { ArrowRight, Film } from "lucide-react";
import { useEffect, useState } from "react";
import { StoryCard } from "@/components/app/story-card";
import { StoryPreviewDialog } from "@/components/app/story-preview-dialog";
import { Link } from "@/lib/router";
import { CLOUD, cloudOwner, deleteCloudStory, listCloudStories, loadCloudStory, type CloudSummary } from "@/lib/story/cloud";
import { forgetProject, type StoryProject } from "@/lib/story/project";

export function HomeStories({ onOpen, onToast }: { onOpen: (id: string) => void; onToast?: (kind: "success" | "error", title: string, description?: string) => void }) {
  const [stories, setStories] = useState<CloudSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [preview, setPreview] = useState<StoryProject | null>(null);

  const toast = (kind: "success" | "error", title: string, description?: string) => onToast?.(kind, title, description);

  useEffect(() => {
    if (!CLOUD) return;
    let live = true;
    setLoading(true);
    listCloudStories()
      .then((list) => live && setStories(list))
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const latest = stories.slice(0, 6);
  const busy = (id: string) => {
    setOpening(id);
    onOpen(id);
    window.setTimeout(() => setOpening((o) => (o === id ? null : o)), 8000);
  };

  async function previewStory(id: string) {
    try {
      setPreview(await loadCloudStory(id));
    } catch (e) {
      toast("error", "Could not load preview", e instanceof Error ? e.message : String(e));
    }
  }

  async function deleteStory(id: string) {
    const target = stories.find((s) => s.id === id);
    if (!window.confirm(`Delete "${target?.title || "this story"}"? Its images, posters and audio go with it.`)) return;
    setDeleting(id);
    try {
      const owner = cloudOwner(id);
      if (!owner) throw new Error("no delete permission for the cloud copy (this browser did not create it)");
      await deleteCloudStory(id, owner);
      forgetProject(id);
      setStories((prev) => prev.filter((s) => s.id !== id));
      toast("success", "Story deleted — all images and audio removed");
    } catch (e) {
      toast("error", "Delete failed", e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section id="stories" className="scroll-mt-24">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Library</p>
          <h2 className="mt-1 text-3xl font-medium tracking-tight">Latest stories</h2>
        </div>
        <Link to="/films" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          All {stories.length} stories <ArrowRight className="size-4" />
        </Link>
      </div>

      {loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-video animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : latest.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border-strong p-8 text-center">
          <Film className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No stories yet. Your first one will show up here.</p>
          <Link to="/create" className="text-sm font-medium hover:underline">
            Make a story
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {latest.map((s) => (
            <StoryCard key={s.id} story={s} opening={opening === s.id} deleting={deleting === s.id} onOpen={busy} onPreview={previewStory} onDelete={deleteStory} />
          ))}
        </div>
      )}
      <StoryPreviewDialog project={preview} onClose={() => setPreview(null)} />
    </section>
  );
}
