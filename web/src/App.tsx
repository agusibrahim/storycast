import { useCallback, useEffect, useRef, useState } from "react";
import { CreateForm } from "@/components/app/create-form";
import { FilmsPage } from "@/components/app/films-page";
import { HomeStories } from "@/components/app/home-stories";
import { CharactersPage } from "@/components/app/characters-page";
import { WatchPage } from "@/components/app/watch-page";
import { Header } from "@/components/app/header";
import { Hero } from "@/components/app/hero";
import { JobPanel } from "@/components/app/job-panel";
import { AnimatedToastStack, useAnimatedToastStack } from "@/components/motion/animated-toast-stack";
import { KeyDialog } from "@/components/app/key-dialog";
import { AgentPromptButton } from "@/components/app/agent-button";
import { SceneStudio } from "@/components/app/scene-studio";
import { community } from "@/lib/share";
import { api, toJob, type Config, type Film, type Job, type JobEvent, type NewJob } from "@/lib/api";
import { saveRecord, type FilmRecord } from "@/lib/studio/store";
import { generateStoryboard, type AspectRatio } from "@/lib/story/robin";
import { loadCloudStory } from "@/lib/story/cloud";
import { loadProject, projectFromDraft, saveProject as saveStory, type StoryProject } from "@/lib/story/project";
import { navigate, usePath } from "@/lib/router";
import { TextReveal } from "@/components/motion/text-reveal";

const JOB_KEY = "storycast-job";

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(JOB_KEY, id);
    else localStorage.removeItem(JOB_KEY);
  } catch {}
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [films, setFilms] = useState<Film[]>([]);
  const [filmsLoading, setFilmsLoading] = useState(true);
  const [shared, setShared] = useState<Film[]>([]);
  const path = usePath();  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [story, setStory] = useState<StoryProject | null>(null);
  const [storyBusy, setStoryBusy] = useState(false);
  const [storyError, setStoryError] = useState<string | null>(null);
  const storyRef = useRef<StoryProject | null>(null);
  storyRef.current = story;
  const [keyOpen, setKeyOpen] = useState(false);
  useEffect(() => {
    const need = () => setKeyOpen(true);
    window.addEventListener("storycast:need-key", need);
    return () => window.removeEventListener("storycast:need-key", need);
  }, []);
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({ limit: 3 });

  const loadFilms = useCallback(
    () =>
      Promise.all([
        api.films().then(setFilms).catch(() => {}),
        community()
          .then((list) => setShared(list.map((f) => ({ ...f, community: true }))))
          .catch(() => {}),
      ]).finally(() => setFilmsLoading(false)),
    [],
  );
  const everything = [...films, ...shared];

  const show = useCallback((rec: FilmRecord) => {
    setJob(toJob(rec));
    setEvents([...(rec.events || [])]);
  }, []);

  const follow = useCallback(
    async (rec: FilmRecord, done: Promise<FilmRecord>) => {
      remember(rec.id);
      show(rec);
      const final = await done;
      show(final);
      if (final.status === "done") {
        showToast({ status: "success", title: "Your film is ready", description: final.result?.title, duration: 8000 });
        loadFilms();
      } else {
        if (/401|403|key/i.test(final.error || "")) setKeyOpen(true);
        showToast({ status: "error", title: "Production stopped", description: final.error?.slice(0, 140), duration: 8000 });
      }
    },
    [loadFilms, show, showToast],
  );

  const onEvent = useCallback((e: JobEvent, rec: FilmRecord) => {
    setEvents((prev) => [...prev, e]);
    setJob(toJob(rec));
  }, []);

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch(() => showToast({ status: "error", title: "Could not load the studio data" }));
    loadFilms();
    let last: string | null = null;
    try {
      last = localStorage.getItem(JOB_KEY);
    } catch {}
    if (!last) return;
    api
      .job(last)
      .then(async (rec) => {
        if (rec.status === "running" || rec.status === "queued") {
          rec.status = "error";
          rec.error = "Stopped because the tab was closed or reloaded. Everything finished so far is kept.";
          await saveRecord(rec);
        }
        show(rec);
      })
      .catch(() => remember(null));
  }, [loadFilms, show, showToast]);

  const busy = job?.status === "running" || job?.status === "queued";

  useEffect(() => {
    if (!busy) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [busy]);

  async function start(body: NewJob) {
    // Image-story flow: the form stays as-is, but submitting now builds an
    // editable scene storyboard (1 image + 1 narration per scene) instead of
    // a rendered video. No fal key needed.
    if (!config) throw new Error("Studio data is still loading");
    if (storyBusy) return;
    setStoryBusy(true);
    setStoryError(null);
    showToast({ status: "loading", title: "Writing your storyboard", description: "The AI drafts every scene — you direct the rest", duration: 6000 });
    try {
      const styleEntry = (config.styles as ({ anchor?: string } & typeof config.styles[number])[]).find((s) => s.id === body.style);
      const styleLabel = styleEntry?.label ?? body.style;
      const styleAnchor = styleEntry?.anchor ?? "";
      const langName = config.languages.find((l) => l.code === body.language)?.name ?? body.language;
      const protagonist = body.mode === "protagonist" ? body.protagonist : null;
      const member = !protagonist && body.character_id ? (config.characters.find((c) => c.id === body.character_id) ?? null) : null;
      const character = member ? member.name : protagonist ? "" : body.character_name.trim();
      const persona = member?.personality ?? "";
      const design = member ? [member.traits, member.personality].filter(Boolean).join(". ") : "";
      const characterRef = member ? member.hero || member.thumb || "" : !protagonist ? body.character_url || "" : "";
      const aspect = (["16:9", "9:16", "1:1", "4:3", "21:9"] as AspectRatio[]).includes(body.aspect as AspectRatio) ? (body.aspect as AspectRatio) : "16:9";
      const draft = await generateStoryboard({ topic: body.topic, scenes: body.scenes, langName, character, aspect, persona, design, styleLabel, protagonist, styleAnchor, genre: body.genre });
      const full = projectFromDraft(draft, {
        topic: body.topic,
        style: body.style,
        styleLabel,
        styleAnchor,
        storyMode: protagonist ? "protagonist" : "narrator",
        protagonist,
        charName: character,
        persona,
        design,
        lang: body.language,
        langName,
        voice: body.voice?.voice_id || "Kore",
        scenes: body.scenes,
        aspect,
        characterRef,
        genre: body.genre,
      });
      saveStory(full);
      setStory(full);
      navigate(`/edit?story=${full.id}`);
      showToast({ status: "success", title: "Storyboard ready", description: `${full.scenes.length} scenes — edit, generate, preview`, duration: 6000 });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStoryError(message);
      showToast({ status: "error", title: "Storyboard failed", description: message.slice(0, 140), duration: 8000 });
      throw e instanceof Error ? e : new Error(message);
    } finally {
      setStoryBusy(false);
    }
  }

  async function resume() {
    if (!job) return;
    try {
      const { rec, done } = await api.resume(job.id, onEvent);
      follow(rec, done);
    } catch (e) {
      showToast({ status: "error", title: e instanceof Error ? e.message : String(e) });
    }
  }

  const production = job ? (
    <div id="production" className="scroll-mt-24">
      <JobPanel job={job} events={events} onResume={resume} />
    </div>
  ) : null;

  const studio = story ? (
    <SceneStudio
      project={story}
      onPersist={(p) => {
        saveStory(p);
        setStory(p);
      }}
      onToast={(status, title, description) => showToast({ status, title, description, duration: 6000 })}
    />
  ) : null;

  const openStoryById = useCallback(
    async (id: string) => {
      // Brand-new projects live in localStorage first — the cloud record is
      // created lazily on the first auto-save. Prefer local so a fresh
      // /edit?story= never errors with "Could not open story".
      const local = loadProject(id);
      if (local) {
        setStory(local);
        navigate(`/edit?story=${id}`);
        return;
      }
      try {
        const p = await loadCloudStory(id);
        saveStory(p);
        setStory(p);
        navigate(`/edit?story=${id}`);
      } catch (e) {
        showToast({ status: "error", title: "Could not open story", description: e instanceof Error ? e.message : String(e), duration: 6000 });
      }
    },
    [showToast],
  );

  // Edit page owns the studio. Deep links and back/forward resolve here;
  // /create?story= is normalized to /edit?story= (nothing ever wipes it early).
  useEffect(() => {
    const openFromUrl = () => {
      const pathname = window.location.pathname;
      const id = new URLSearchParams(window.location.search).get("story");
      if (pathname.startsWith("/edit")) {
        if (id && id !== storyRef.current?.id) openStoryById(id);
        else if (!id) navigate("/create");
      } else if (pathname.startsWith("/create") && id) {
        navigate(`/edit?story=${id}`);
      }
    };
    openFromUrl();
    window.addEventListener("popstate", openFromUrl);
    return () => window.removeEventListener("popstate", openFromUrl);
  }, [path, openStoryById]);

  return (
    <div className="min-h-dvh">
      <Header />
      <main className={path.startsWith("/edit") ? "mx-auto flex w-full flex-col gap-6 px-8 pb-16 sm:px-[148px]" : "mx-auto flex max-w-7xl flex-col gap-10 px-4 pb-24 sm:px-6"}>
        {path.startsWith("/films/") ? (
          <WatchPage id={decodeURIComponent(path.slice("/films/".length))} films={everything} cast={config?.characters ?? []} loading={filmsLoading} />
        ) : path.startsWith("/films") ? (
          <FilmsPage films={everything} loading={filmsLoading} cast={config?.characters ?? []} onOpenStory={openStoryById} />
        ) : path.startsWith("/characters") ? (
          <CharactersPage styles={config?.styles.map((s) => ({ id: s.id, label: s.label })) ?? []} />
        ) : path.startsWith("/edit") ? (
          <div className="flex flex-col gap-6 pt-8">
            {studio ?? (
              <div className="flex flex-col items-center gap-3 py-24 text-center">
                <p className="text-lg font-medium">No story open</p>
                <p className="-mt-1 text-sm text-muted-foreground">Pick one from the list or make a new one.</p>
                <button
                  type="button"
                  onClick={() => navigate("/create")}
                  className="mt-1 h-10 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Go to create
                </button>
              </div>
            )}
          </div>
        ) : path.startsWith("/create") ? (
          <div className="flex flex-col gap-6 pt-8">
            <header className="flex flex-wrap items-end justify-between gap-4 lg:relative lg:left-1/2 lg:w-[min(calc(100%+16rem),calc(100vw-2rem))] lg:-translate-x-1/2">
              <div>
                <h1 className="text-3xl font-medium tracking-tight">
                  <TextReveal text="Make a film" />
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">Pick a topic, a look and a voice. The rest is directed for you.</p>
              </div>
              <AgentPromptButton />
            </header>
            {job && busy && production}
            {config ? (
              <CreateForm config={config} busy={busy || storyBusy} onStart={start} onError={(message) => showToast({ status: "error", title: message })} />
            ) : (
              <div className="h-96 animate-pulse rounded-3xl border border-border bg-card/40" />
            )}
            {storyError && !storyBusy && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{storyError}</div>
            )}
            {job && !busy && production}
          </div>
        ) : (
          <>
            <Hero cast={config?.characters ?? []} films={films} />
            <HomeStories
              onOpen={openStoryById}
              onToast={(kind, title, description) => showToast({ status: kind, title, description, duration: 6000 })}
            />
          </>
        )}
      </main>
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">Storycast · every frame, voice and cut is made on fal</footer>
      <KeyDialog
        open={keyOpen}
        onClose={() => setKeyOpen(false)}
        onConnected={() => {
          setKeyOpen(false);
          showToast({ status: "success", title: "fal key connected", description: "You can make films now", duration: 4000 });
        }}
      />
      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} position="bottom-right" fixed portal />
    </div>
  );
}
