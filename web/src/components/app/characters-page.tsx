import { motion } from "motion/react";
import { ImagePlus, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/motion/button/base";
import { Drawer } from "@/components/motion/drawer";
import { Input } from "@/components/motion/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/motion/select";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import {
  CLOUD,
  createCharacter,
  deleteCharacter,
  listCharacters,
  patchCharacter,
  uploadCharacterImage,
  type CharacterInput,
  type CloudCharacter,
} from "@/lib/story/cloud";

type Props = { styles: { id: string; label: string }[] };

const EMPTY: CharacterInput = {
  name: "",
  personality: "",
  group: "",
  style: "",
  styleLabel: "",
  traits: "",
  pronoun: "its",
  voice: { voice_id: "", name: "", gender: "", age: "", accent: "", description: "" },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const fieldClass = "w-full rounded-xl border border-border bg-background p-2.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-border-strong";

export function CharactersPage({ styles }: Props) {
  const [chars, setChars] = useState<CloudCharacter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<CloudCharacter | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CharacterInput>(EMPTY);
  const [files, setFiles] = useState<{ thumb?: File; hero?: File; sheet?: File }>({});
  const [previews, setPreviews] = useState<{ thumb?: string; hero?: string; sheet?: string }>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const refresh = async () => {
    if (!CLOUD) return;
    setLoading(true);
    setError("");
    try {
      setChars(await listCharacters());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => [...new Set(chars.map((c) => c.group).filter(Boolean))], [chars]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY, style: styles[0]?.id ?? "", styleLabel: styles[0]?.label ?? "" });
    setFiles({});
    setPreviews({});
    setSaveError("");
    setCreating(true);
  }

  function openEdit(c: CloudCharacter) {
    setEditing(c);
    setForm({
      name: c.name,
      personality: c.personality,
      group: c.group,
      style: c.style,
      styleLabel: c.style_label,
      traits: c.traits,
      pronoun: c.pronoun,
      voice: { ...c.voice },
    });
    setFiles({});
    setPreviews({ thumb: c.thumb, hero: c.hero, sheet: c.sheet });
    setSaveError("");
    setCreating(true);
  }

  function close() {
    if (saving) return;
    setCreating(false);
  }

  function pick(kind: "thumb" | "hero" | "sheet", file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    setFiles((p) => ({ ...p, [kind]: file }));
    setPreviews((p) => ({ ...p, [kind]: URL.createObjectURL(file) }));
  }

  const set = (k: keyof CharacterInput, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const setVoice = (k: keyof CharacterInput["voice"], v: string) => setForm((p) => ({ ...p, voice: { ...p.voice, [k]: v } }));

  async function save() {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const payload: CharacterInput = {
        ...form,
        name: form.name.trim(),
        styleLabel: form.styleLabel || styles.find((s) => s.id === form.style)?.label || form.style,
      };
      const saved = editing ? await patchCharacter(editing.id, payload) : await createCharacter(payload);
      const id = saved.id;
      const next: Record<string, string> = {};
      for (const kind of ["thumb", "hero", "sheet"] as const) {
        const f = files[kind];
        if (f) next[kind] = await uploadCharacterImage(id, kind, f);
      }
      setChars((prev) => {
        const merged = { ...saved, ...next };
        return editing ? prev.map((c) => (c.id === id ? { ...c, ...merged } : c)) : [...prev, merged as CloudCharacter];
      });
      setCreating(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this character? Its images go with it.")) return;
    setDeleting(id);
    try {
      await deleteCharacter(id);
      setChars((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  }

  if (!CLOUD) {
    return (
      <div className="flex flex-col items-center gap-2 py-24 text-center">
        <p className="text-lg font-medium">Character management needs the cloud API</p>
        <p className="text-sm text-muted-foreground">Set VITE_SHARE_API to enable it.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pt-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Catalog</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Characters {chars.length ? <span className="text-muted-foreground">· {chars.length}</span> : ""}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Stored in D1 + R2. Changes apply everywhere immediately.</p>
        </div>
        <Button size="md" onClick={openCreate}>
          <Plus className="size-4" /> New character
        </Button>
      </header>

      {error && <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : chars.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">No characters yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {chars.map((c, i) => (
            <motion.article
              key={c.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT, delay: Math.min(i * 0.03, 0.4) }}
              className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/40"
            >
              <button type="button" onClick={() => openEdit(c)} className="relative block aspect-[3/4] w-full overflow-hidden bg-muted text-left" aria-label={`Edit ${c.name}`}>
                {c.hero ? (
                  <img src={c.hero} alt="" loading="lazy" className="size-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]" />
                ) : (
                  <span className="grid size-full place-items-center font-mono text-3xl text-muted-foreground/40">{c.name[0]}</span>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/25 group-hover:opacity-100">
                  <span className="flex size-11 items-center justify-center rounded-full bg-background/80 backdrop-blur-md">
                    <Pencil className="size-4" />
                  </span>
                </span>
                {c.group && (
                  <span className="absolute top-2 left-2 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">{c.group}</span>
                )}
              </button>
              <div className="flex min-w-0 flex-1 flex-col p-3">
                <p className="truncate text-sm font-semibold">{c.name}</p>
                {c.personality && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{c.personality}</p>}
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {[c.style_label, c.pronoun && `“${c.pronoun}”`, c.voice.name ? c.voice.name.split(" - ")[0] : ""].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(c)}
                    className="flex h-8 flex-1 items-center justify-center gap-1 rounded-full border border-border text-xs transition-colors hover:border-border-strong"
                  >
                    <Pencil className="size-3.5" /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    disabled={deleting === c.id}
                    aria-label={`Delete ${c.name}`}
                    className="flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
                  >
                    {deleting === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  </button>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      )}

      <Drawer open={creating} onOpenChange={(o) => !o && close()} side="right" ariaLabel={editing ? "Edit character" : "New character"} className="w-full max-w-[min(560px,100vw)] sm:w-[520px]">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-lg font-medium tracking-tight">{editing ? `Edit ${editing.name}` : "New character"}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{editing ? editing.id : "Saved straight to the cloud catalog"}</p>
            </div>
            <button type="button" onClick={close} aria-label="Close" className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-3 gap-2">
              {(["thumb", "hero", "sheet"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => fileRefs.current[kind]?.click()}
                  className="group relative aspect-[3/4] overflow-hidden rounded-xl bg-muted ring-1 ring-border"
                  aria-label={`Upload ${kind}`}
                >
                  {previews[kind] ? (
                    <img src={previews[kind]} alt="" className="size-full object-cover object-top" />
                  ) : (
                    <span className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
                      <ImagePlus className="size-4" />
                      <span className="text-[10px] capitalize">{kind}</span>
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[10px] text-white capitalize opacity-0 transition-opacity group-hover:opacity-100">
                    {kind}
                  </span>
                  <input
                    ref={(el) => {
                      fileRefs.current[kind] = el;
                    }}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => {
                      pick(kind, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </button>
              ))}
            </div>

            <Field label="Name">
              <Input value={form.name} onChange={(v) => set("name", v)} placeholder="Kiko" className="flex-1" />
            </Field>
            <Field label="Personality — sent to the story AI">
              <textarea value={form.personality} onChange={(e) => set("personality", e.target.value.slice(0, 500))} rows={2} placeholder="A sky-watcher who chases storms, stars and seasons" className={cn(fieldClass, "resize-y")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Group">
                <input value={form.group} onChange={(e) => set("group", e.target.value.slice(0, 60))} list="char-groups" placeholder="Kids & teens" className={fieldClass} />
                <datalist id="char-groups">
                  {groups.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </Field>
              <Field label="Pronoun">
                <Select value={form.pronoun} onValueChange={(v) => set("pronoun", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pronoun" />
                  </SelectTrigger>
                  <SelectContent>
                    {["his", "her", "its"].map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Style">
                <Select
                  value={form.style}
                  onValueChange={(v) => {
                    set("style", v);
                    setForm((p) => ({ ...p, styleLabel: styles.find((s) => s.id === v)?.label ?? v }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Style" />
                  </SelectTrigger>
                  <SelectContent>
                    {styles.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Voice ID (Robin TTS name)">
                <input value={form.voice.voice_id} onChange={(e) => setVoice("voice_id", e.target.value.slice(0, 80))} placeholder="Kore" className={fieldClass} />
              </Field>
            </div>
            <Field label="Voice display name">
              <input value={form.voice.name} onChange={(e) => setVoice("name", e.target.value.slice(0, 160))} placeholder="Kore · warm narrator" className={fieldClass} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  ["gender", "Gender"],
                  ["age", "Age"],
                  ["accent", "Accent"],
                ] as const
              ).map(([k, label]) => (
                <Field key={k} label={label}>
                  <input value={form.voice[k]} onChange={(e) => setVoice(k, e.target.value.slice(0, 40))} className={fieldClass} />
                </Field>
              ))}
            </div>
            <Field label="Voice description">
              <textarea value={form.voice.description} onChange={(e) => setVoice("description", e.target.value.slice(0, 600))} rows={2} className={cn(fieldClass, "resize-y")} />
            </Field>
            <Field label="Visual traits — repeated in every image prompt">
              <textarea value={form.traits} onChange={(e) => set("traits", e.target.value.slice(0, 600))} rows={2} placeholder="short dark bob, yellow hooded coat, olive crossbody bag, red boots" className={cn(fieldClass, "resize-y")} />
            </Field>

            {saveError && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{saveError}</p>}
          </div>

          <div className="flex gap-2 border-t border-border px-5 py-4">
            <Button variant="secondary" className="flex-1" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button className="flex-[2]" onClick={save} disabled={!form.name.trim() || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {saving ? "Saving…" : editing ? "Save changes" : "Create character"}
            </Button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
