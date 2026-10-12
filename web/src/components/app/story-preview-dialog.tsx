import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { StoryPreview } from "@/components/app/story-preview";
import { EASE_OUT } from "@/lib/ease";
import type { StoryProject } from "@/lib/story/project";

type Props = { project: StoryProject | null; onClose: () => void };

export function StoryPreviewDialog({ project, onClose }: Props) {
  return (
    <AnimatePresence>
      {project && (
        <motion.div
          key="story-preview-dialog"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-background/80 p-4 backdrop-blur-md"
          onClick={onClose}
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
              <p className="min-w-0 truncate text-sm font-medium">{project.title || "Untitled story"}</p>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close preview"
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <StoryPreview scenes={project.scenes} title={project.title || "Untitled story"} musicUrl={project.musicUrl} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
