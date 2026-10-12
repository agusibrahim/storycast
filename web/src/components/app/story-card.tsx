import { EllipsisVertical, Languages, Loader2, Play, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmtDuration } from "@/components/app/film-card";
import { cn } from "@/lib/utils";
import { languageName, nativeLanguage } from "@/lib/api";
import type { CloudSummary } from "@/lib/story/cloud";

type Props = {
  story: CloudSummary;
  layout?: "grid" | "list";
  opening?: boolean;
  deleting?: boolean;
  onOpen: (id: string) => void;
  onPreview: (id: string) => void;
  onDelete: (id: string) => void;
};

export function StoryCard({ story, layout = "grid", opening, deleting, onOpen, onPreview, onDelete }: Props) {
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const list = layout === "list";

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const open = () => {
    setMenu(false);
    onOpen(story.id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${story.title}`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn("group cursor-pointer text-left", list && "flex items-center gap-4 rounded-2xl p-2 transition-colors hover:bg-muted/50")}
    >
      <span className={cn("relative block aspect-video shrink-0 overflow-hidden rounded-2xl bg-muted ring-1 ring-border transition-shadow group-hover:shadow-xl", list ? "w-44 rounded-xl sm:w-56" : "w-full")}>
        {story.thumb ? (
          <img src={story.thumb} alt="" loading="lazy" className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <span className="absolute inset-0 grid place-items-center font-mono text-2xl text-muted-foreground/40">{story.scene_count}</span>
        )}
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          <Languages className="size-3" /> {nativeLanguage(story.lang)}
        </span>
        <span className="absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">{fmtDuration(story.duration)}</span>
        <span className={cn("absolute inset-0 flex items-center justify-center transition-opacity", hover && !opening ? "opacity-100" : "opacity-0")}>
          <span className="flex size-11 items-center justify-center rounded-full bg-background/80 backdrop-blur-md">
            {opening ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4 translate-x-px fill-current" />}
          </span>
        </span>
        <div ref={menuRef} className="absolute top-1.5 right-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            aria-label="Story options"
            aria-expanded={menu}
            className={cn(
              "flex size-8 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur-sm transition-all hover:bg-black/80",
              menu ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100",
            )}
          >
            <EllipsisVertical className="size-4" />
          </button>
          {menu && (
            <>
              <button type="button" aria-label="Close menu" tabIndex={-1} onClick={() => setMenu(false)} className="fixed inset-0 z-10 cursor-default" />
              <div className="absolute top-9 right-0 z-20 w-44 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    onPreview(story.id);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
                >
                  <Play className="size-4 text-muted-foreground" /> Putar preview
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    onDelete(story.id);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
                >
                  {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Hapus
                </button>
              </div>
            </>
          )}
        </div>
      </span>
      <span className={cn("block min-w-0", list ? "flex-1 py-1 pr-2" : "px-1 pt-3")}>
        <span className="line-clamp-2 block text-sm leading-snug">
          <span className="font-semibold">{story.title || "Untitled story"}</span> <span className="text-muted-foreground capitalize">{story.subtitle}</span>
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {[languageName(story.lang), story.voice, `${story.scene_count} scenes`, story.style_label].filter(Boolean).join(" · ")}
        </span>
      </span>
    </div>
  );
}
