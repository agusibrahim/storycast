import { AnimatePresence, motion } from "motion/react";
import { Clapperboard, ImagePlus, Lightbulb, Loader2, Sparkles, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { setAgentContext } from "@/lib/agent";
import { StatefulButton, type ButtonState } from "@/components/motion/button/stateful";
import { Input } from "@/components/motion/input";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/motion/combobox";
import { NumberTicker } from "@/components/motion/number-ticker";
import { RangeSlider } from "@/components/motion/range-slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { CharacterPicker, type CharacterChoice } from "@/components/app/character-picker";
import { TopicIdeas } from "@/components/app/topic-ideas";
import { StylePicker, type CustomStyle } from "@/components/app/style-picker";
import { RobinVoiceField } from "@/components/app/robin-voice-field";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { api, type Config, type NewJob, type Voice } from "@/lib/api";
import { ASPECTS, type AspectRatio } from "@/lib/story/robin";
import type { Resolution } from "@/lib/studio/pipeline";

const POPULAR = ["id", "en", "tr", "es", "fr", "de", "pt", "ar", "hi", "zh", "ja", "ko", "ru"];
const IDEAS = ["Why is the sky blue?", "How do bees make honey?", "The first photograph", "How do volcanoes work?"];
const SCENE_MIN = 7;
const SCENE_MAX = 20;
const GENDERS = ["Laki-laki", "Perempuan"];
const AGES = ["Anak-anak", "Remaja", "Dewasa", "Lansia"];
const SPECIES = ["Manusia", "Hewan", "Fantasi", "Acak"];

function MiniSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <Combobox value={value} onValueChange={(v) => v && onChange(v)}>
        <ComboboxTrigger className="h-10 min-w-0 rounded-xl px-2.5 text-xs">
          <ComboboxValue />
        </ComboboxTrigger>
        <ComboboxContent className="rounded-2xl">
          <ComboboxList ariaLabel={label} className="p-1.5">
            <ComboboxEmpty>Tidak ada pilihan.</ComboboxEmpty>
            {options.map((o) => (
              <ComboboxItem key={o} value={o} textValue={o}>
                <span className="text-xs">{o}</span>
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
const GENRES = [
  "Edukasi", "Petualangan", "Fantasi", "Fabel", "Legenda", "Dongeng", "Sains", "Sejarah",
  "Komedi", "Misteri", "Persahabatan", "Keluarga", "Alam", "Hewan", "Antariksa", "Laut",
  "Pahlawan", "Olahraga", "Musik", "Budaya",
];

function Label({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-muted-foreground">{children}</span>
      {aside}
    </div>
  );
}

type Character = { preview: string; url: string; uploading: boolean; error?: string };

function NarratorSlot({ value, name, onName, onFile, onClear }: { value: Character | null; name: string; onName: (v: string) => void; onFile: (f: File) => void; onClear: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f && f.type.startsWith("image/")) onFile(f);
      }}
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-dashed p-2 pr-2.5 transition-colors",
        drag ? "border-primary bg-primary/5" : "border-border-strong bg-background/30",
      )}
    >
      <button type="button" onClick={() => fileRef.current?.click()} className="relative size-10 shrink-0 overflow-hidden rounded-xl bg-muted" aria-label="Upload a character">
        <AnimatePresence mode="popLayout" initial={false}>
          {value ? (
            <motion.img key={value.preview} src={value.preview} alt="" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="size-full object-cover" />
          ) : (
            <motion.span key="empty" className="flex size-full items-center justify-center text-muted-foreground">
              <ImagePlus className="size-4" />
            </motion.span>
          )}
        </AnimatePresence>
        {value?.uploading && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2 className="size-4 animate-spin" />
          </span>
        )}
      </button>
      {value && !value.uploading && !value.error ? (
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Name your character (optional)"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      ) : (
        <button type="button" onClick={() => fileRef.current?.click()} className="min-w-0 flex-1 text-left">
          <p className={cn("truncate text-sm", value?.error ? "text-destructive" : "font-medium")}>{value?.error ?? (value?.uploading ? "Uploading…" : "Your own character")}</p>
          <p className="truncate text-xs text-muted-foreground">Optional · drop an image, or one is invented</p>
        </button>
      )}
      {value ? (
        <button type="button" onClick={onClear} aria-label="Remove character" className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" />
        </button>
      ) : (
        <UserRound className="mr-1.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

type Props = {
  config: Config;
  busy: boolean;
  onStart: (body: NewJob) => Promise<void>;
  onError: (message: string) => void;
};

export function CreateForm({ config, busy, onStart, onError }: Props) {
  const [topic, setTopic] = useState("");
  const [topicError, setTopicError] = useState<string | false>(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [style, setStyle] = useState(() => {
    const wanted = new URLSearchParams(window.location.search).get("style");
    return config.styles.some((s) => s.id === wanted) ? (wanted as string) : (config.styles[0]?.id ?? "stick-figure");
  });
  const [custom, setCustom] = useState<CustomStyle | null>(null);
  const [scenes, setScenes] = useState(10);
  const [aspect, setAspect] = useState<AspectRatio>("16:9");
  const [genre, setGenre] = useState("Edukasi");
  const [language, setLanguage] = useState("id");
  const [character, setCharacter] = useState<Character | null>(null);
  const [charName, setCharName] = useState("");
  const [voice, setVoice] = useState<Voice | null>(null);
  const [choice, setChoice] = useState<CharacterChoice>(() => {
    const wanted = new URLSearchParams(window.location.search).get("character");
    const hit = config.characters.find((c) => c.id === wanted) ?? config.characters[0];
    return hit ? { kind: "cast", id: hit.id } : { kind: "new" };
  });
  const member = choice.kind === "cast" ? config.characters.find((c) => c.id === choice.id) : undefined;
  const [mode, setMode] = useState<"protagonist" | "narrator">("protagonist");
  const [gender, setGender] = useState(GENDERS[0]);
  const [age, setAge] = useState(AGES[0]);
  const [species, setSpecies] = useState(SPECIES[0]);
  const [submit, setSubmit] = useState<ButtonState>("idle");
  const eta = Math.max(1, Math.round(scenes / 3));

  useEffect(() => {
    setAgentContext({
      kind: "create",
      topic: topic.trim(),
      style,
      styleUrl: custom?.url ?? "",
      minutes: 1,
      language,
      characterId: mode === "narrator" ? (member?.id ?? "") : "",
      characterUrl: mode === "narrator" && choice.kind === "upload" ? (character?.url ?? "") : "",
      characterName: mode === "narrator" && choice.kind === "upload" ? charName.trim() : "",
      voice: voice ? { voice_id: voice.voice_id, name: voice.name } : null,
      resolution: "768P" as Resolution,
    });
  }, [topic, style, custom, language, member, choice, character, charName, voice, mode]);
  useEffect(() => () => setAgentContext(null), []);

  async function uploadStyle(file: File) {
    const preview = URL.createObjectURL(file);
    setCustom({ preview, url: "", uploading: true });
    setStyle("custom");
    try {
      const url = await api.upload(file);
      setCustom({ preview, url, uploading: false });
    } catch (e) {
      setCustom(null);
      setStyle(config.styles[0]?.id ?? "stick-figure");
      onError((e as Error).message);
    }
  }

  async function uploadCharacter(file: File) {
    const preview = URL.createObjectURL(file);
    setCharacter({ preview, url: "", uploading: true });
    try {
      const url = await api.upload(file);
      setCharacter({ preview, url, uploading: false });
    } catch (e) {
      setCharacter({ preview, url: "", uploading: false, error: (e as Error).message });
    }
  }

  async function go() {
    if (!topic.trim()) {
      setTopicError("Give the film a topic first");
      return;
    }
    if (mode === "narrator" && !member && ((style === "custom" && !custom?.url) || character?.uploading)) {
      onError("An image is still uploading");
      return;
    }
    if (mode === "narrator" && choice.kind === "upload" && !character?.url) {
      onError("Upload your character first");
      return;
    }
    setSubmit("loading");
    try {
      await onStart({
        topic: topic.trim(),
        style: mode === "narrator" && member ? member.style : style,
        minutes: 1,
        scenes,
        aspect,
        genre: GENRES.includes(genre) ? genre : "Edukasi",
        language,
        style_url: !(mode === "narrator" && member) && style === "custom" ? (custom?.url ?? "") : "",
        character_url: mode === "narrator" && choice.kind === "upload" ? (character?.url ?? "") : "",
        character_name: mode === "narrator" && choice.kind === "upload" ? charName.trim() : "",
        character_id: mode === "narrator" ? (member?.id ?? "") : "",
        mode,
        protagonist: { gender, age, species },
        voice,
        resolution: "768P",
      });
      setSubmit("success");
      setTimeout(() => setSubmit("idle"), 1600);
    } catch (e) {
      setSubmit("error");
      onError((e as Error).message);
      setTimeout(() => setSubmit("idle"), 2000);
    }
  }

  const chosen = config.styles.find((s) => s.id === style);
  const styleLabel = style === "custom" ? "Your own style" : chosen?.label;
  const who = mode === "protagonist" ? `${age} ${species} ${gender} hero` : member ? member.name : choice.kind === "upload" ? charName.trim() || "Your character" : "A new character";

  return (
    <motion.section
      id="create"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE_OUT }}
      className="grid gap-6 rounded-3xl border border-border bg-card/40 p-4 sm:p-6 lg:relative lg:left-1/2 lg:w-[min(calc(100%+16rem),calc(100vw-2rem))] lg:-translate-x-1/2 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-10"
    >
      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <Label>Topic</Label>
          <Input
            value={topic}
            onChange={(v) => {
              setTopic(v);
              if (topicError) setTopicError(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="How do bees make honey?"
            leftIcon={<Lightbulb className="size-4" />}
            rightIcon={
              <button
                type="button"
                onClick={() => setIdeasOpen(true)}
                title="Find topic ideas"
                aria-label="Find topic ideas"
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-accent"
              >
                <Sparkles className="size-4" />
              </button>
            }
            error={topicError}
            classNames={{ field: "h-12" }}
          />
          <TopicIdeas
            open={ideasOpen}
            onOpenChange={setIdeasOpen}
            onSelect={(t) => {
              setTopic(t);
              setTopicError(false);
            }}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => {
                  setTopic(idea);
                  setTopicError(false);
                }}
                className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
              >
                {idea}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label aside={<span className="text-[11px] text-muted-foreground">Display format</span>}>Aspect ratio</Label>
          <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Aspect ratio">
            {ASPECTS.map((a) => {
              const active = aspect === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setAspect(a.id)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 transition-colors",
                    active ? "border-primary/60 bg-primary/5" : "border-border bg-background/30 hover:border-border-strong",
                  )}
                >
                  <span className="flex h-7 items-center justify-center">
                    <span
                      aria-hidden
                      className={cn("rounded-[3px] border-2", active ? "border-primary/70 bg-primary/15" : "border-muted-foreground/40")}
                      style={{ width: Math.round(a.iconW * 0.7), height: Math.round(a.iconH * 0.7) }}
                    />
                  </span>
                  <span className={cn("text-xs font-semibold tabular-nums", active && "text-primary")}>{a.id}</span>
                  <span className="hidden truncate text-[10px] text-muted-foreground sm:block">{a.sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <Label aside={<span className="font-mono text-xs"><NumberTicker value={scenes} /> scenes</span>}>Scenes</Label>
            <RangeSlider min={SCENE_MIN} max={SCENE_MAX} step={1} value={scenes} onValueChange={setScenes} aria-label="Number of scenes" formatValueText={(v) => `${v} scenes`} />
            <div className="mt-1 flex justify-between px-[7px] font-mono text-[10px] text-muted-foreground">
              {Array.from({ length: SCENE_MAX - SCENE_MIN + 1 }, (_, i) => (
                <button key={i} type="button" onClick={() => setScenes(SCENE_MIN + i)} className={cn("w-3 text-center transition-colors hover:text-foreground", scenes === SCENE_MIN + i && "text-foreground")}>
                  {SCENE_MIN + i}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label aside={<span className="text-[11px] text-muted-foreground">{config.languages.length} languages</span>}>Language</Label>
            <Combobox value={language} onValueChange={(v) => v && setLanguage(v)}>
              <ComboboxTrigger className="h-10 rounded-xl px-2.5">
                <ComboboxInput aria-label="Search languages" placeholder="Search languages…" />
              </ComboboxTrigger>
              <ComboboxContent className="w-72 rounded-2xl">
                <ComboboxList ariaLabel="Languages" className="max-h-72 p-1.5">
                  <ComboboxEmpty>No language found.</ComboboxEmpty>
                  {(["Popular", "All languages"] as const).map((group, gi) => (
                    <ComboboxGroup key={group}>
                      {gi > 0 ? <ComboboxSeparator /> : null}
                      <ComboboxLabel>{group}</ComboboxLabel>
                      {config.languages
                        .filter((l) => (group === "Popular" ? POPULAR.includes(l.code) : !POPULAR.includes(l.code)))
                        .sort((x, y) => (group === "Popular" ? POPULAR.indexOf(x.code) - POPULAR.indexOf(y.code) : x.name.localeCompare(y.name)))
                        .map((l) => (
                          <ComboboxItem key={l.code} value={l.code} textValue={l.name} keywords={[l.native, l.code]}>
                            <span className="flex min-w-0 items-baseline justify-between gap-3">
                              <span className="truncate">{l.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">{l.native}</span>
                            </span>
                          </ComboboxItem>
                        ))}
                    </ComboboxGroup>
                  ))}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
        </div>

        <div>
          <Label aside={<span className="text-[11px] text-muted-foreground">For the story file</span>}>Genre</Label>
          <Combobox value={GENRES.includes(genre) ? genre : "Edukasi"} onValueChange={(v) => v && setGenre(v)}>
            <ComboboxTrigger className="h-10 rounded-xl px-2.5">
              <ComboboxInput aria-label="Search genres" placeholder="Search genres…" />
            </ComboboxTrigger>
            <ComboboxContent className="w-72 rounded-2xl">
              <ComboboxList ariaLabel="Genres" className="max-h-72 p-1.5">
                <ComboboxEmpty>No genre found.</ComboboxEmpty>
                {GENRES.map((g) => (
                  <ComboboxItem key={g} value={g} textValue={g} keywords={[g.toLowerCase()]}>
                    <span className="truncate">{g}</span>
                  </ComboboxItem>
                ))}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>

        <div>
          <Label>Voice</Label>
          <RobinVoiceField
            value={voice}
            onChange={setVoice}
            lang={language}
            topic={topic}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-5">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div key="start" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <StatefulButton size="lg" state={submit} onClick={() => go()} loadingText="Starting" successText="Rolling" icon={<Clapperboard className="size-4" />} className="w-full">
                Make the film
              </StatefulButton>
            </motion.div>
          </AnimatePresence>
          <p className="text-center text-[11px] text-muted-foreground">
            {busy ? "A story is being written; hold on." : `${who} · ${mode === "narrator" && member ? member.style_label : styleLabel} · ${scenes} scenes · ready in about ${eta} min`}
          </p>
          <p className="text-center text-[11px] text-muted-foreground">
            {scenes} scenes · 1 image + 1 narration each
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <Label aside={<span className="truncate text-[11px] text-muted-foreground">{mode === "protagonist" ? "AI invents the hero, you set the basics" : member ? `${member.name}: ${member.personality}` : `${config.characters.length} narrators, each with their own look and voice`}</span>}>
            Character
          </Label>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "protagonist" | "narrator")} variant="segment">
            <TabsList>
              <TabsTrigger value="protagonist">Protagonis</TabsTrigger>
              <TabsTrigger value="narrator">Narator</TabsTrigger>
            </TabsList>
          </Tabs>
          {mode === "protagonist" ? (
            <div className="mt-3 flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-2">
                <MiniSelect label="Gender" value={gender} options={GENDERS} onChange={setGender} />
                <MiniSelect label="Usia" value={age} options={AGES} onChange={setAge} />
                <MiniSelect label="Spesies" value={species} options={SPECIES} onChange={setSpecies} />
              </div>
              <div>
                <Label aside={<span className="truncate text-[11px] text-muted-foreground">Contoh gaya saja — hero mengikuti gender pilihanmu</span>}>
                  Tema visual
                </Label>
                <StylePicker styles={config.styles} categories={config.categories} value={style} onChange={setStyle} custom={custom} onCustomFile={uploadStyle} size="large" />
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <CharacterPicker cast={config.characters} groups={config.character_groups} lang={language} value={choice} onChange={setChoice} uploadPreview={character?.preview} />
            </div>
          )}
        </div>

        <AnimatePresence initial={false}>
          {mode === "narrator" && choice.kind === "upload" && (
            <motion.div key="upload" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }} className="overflow-hidden">
              <Label>Your character</Label>
              <NarratorSlot
                value={character}
                name={charName}
                onName={setCharName}
                onFile={uploadCharacter}
                onClear={() => {
                  setCharacter(null);
                  setCharName("");
                }}
              />
            </motion.div>
          )}
          {mode === "narrator" && choice.kind !== "cast" && (
            <motion.div key="look" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }} className="overflow-hidden">
              <Label aside={<span className="truncate text-[11px] text-muted-foreground">{style === "custom" ? "Your uploaded illustration sets the look" : `${chosen?.label}: ${chosen?.blurb}`}</span>}>
                {choice.kind === "upload" ? "Redraw it in" : "Look"}
              </Label>
              <StylePicker styles={config.styles} categories={config.categories} value={style} onChange={setStyle} custom={custom} onCustomFile={uploadStyle} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
