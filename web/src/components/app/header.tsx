import { Settings as SettingsIcon, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/motion/button/base";
import { Input } from "@/components/motion/input";
import { SharedLayoutBg } from "@/components/motion/shared-layout-bg";
import { ThemeToggle } from "@/components/motion/theme-toggle";
import { Link, usePath } from "@/lib/router";
import { DEFAULT_ROUTER_BASE, geminiAuthInput, routerBase, setGeminiAuthInput, setRouterBase } from "@/lib/story/robin";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/create", label: "Create" },
  { to: "/films", label: "Explore" },
  { to: "/characters", label: "Characters" },
];

export function Header() {
  const path = usePath();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState(routerBase());
  const [authVal, setAuthVal] = useState(geminiAuthInput());
  const [saved, setSaved] = useState(false);
  const [urlError, setUrlError] = useState("");

  function openSettings() {
    setBaseUrl(routerBase());
    setAuthVal(geminiAuthInput());
    setUrlError("");
    setSaved(false);
    setSettingsOpen(true);
  }

  function saveSettings() {
    const v = baseUrl.trim().replace(/\/$/, "");
    if (!/^https:\/\/.+/.test(v)) {
      setUrlError("Must start with https://");
      return;
    }
    setRouterBase(v);
    setGeminiAuthInput(authVal);
    setUrlError("");
    setSaved(true);
    window.setTimeout(() => setSettingsOpen(false), 600);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-3 sm:px-6">
        <Link to="/" aria-label="Storycast" className="flex shrink-0 items-center gap-2.5">
          <img src="/logo.svg" alt="" className="size-9" />
          <span className="hidden text-[17px] font-semibold tracking-tight sm:inline">Storycast</span>
        </Link>
        <nav className="flex items-center gap-1">
          <SharedLayoutBg className="w-auto flex-row items-center gap-1" pillClassName="rounded-full bg-muted" inset={0}>
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                aria-current={(n.to === "/" ? path === "/" : path.startsWith(n.to)) ? "page" : undefined}
                className={cn(
                  "relative rounded-full px-2 py-1.5 text-sm transition-colors sm:px-3.5",
                  (n.to === "/" ? path === "/" : path.startsWith(n.to)) ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {n.label}
              </Link>
            ))}
          </SharedLayoutBg>
          <ThemeToggle
            variant="circle-blur"
            className="ml-1 size-10 shrink-0 rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground sm:ml-2"
            iconClassName="size-4"
          />
          <button
            type="button"
            onClick={openSettings}
            title="Settings"
            aria-label="Settings"
            className="ml-1 flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground sm:ml-2"
          >
            <SettingsIcon className="size-4" />
          </button>
        </nav>
      </div>
      <SettingsModal
        open={settingsOpen}
        baseUrl={baseUrl}
        onBaseUrl={setBaseUrl}
        authVal={authVal}
        onAuthVal={setAuthVal}
        urlError={urlError}
        saved={saved}
        onSave={saveSettings}
        onReset={() => {
          setRouterBase(DEFAULT_ROUTER_BASE);
          setGeminiAuthInput("");
          setBaseUrl(DEFAULT_ROUTER_BASE);
          setAuthVal("");
          setUrlError("");
          setSaved(true);
          window.setTimeout(() => setSettingsOpen(false), 600);
        }}
        onClose={() => setSettingsOpen(false)}
      />
    </header>
  );
}

function SettingsModal({
  open,
  baseUrl,
  onBaseUrl,
  authVal,
  onAuthVal,
  urlError,
  saved,
  onSave,
  onReset,
  onClose,
}: {
  open: boolean;
  baseUrl: string;
  onBaseUrl: (v: string) => void;
  authVal: string;
  onAuthVal: (v: string) => void;
  urlError: string;
  saved: boolean;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="settings-dialog"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-background/80 p-4 backdrop-blur-md"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="w-full max-w-md rounded-3xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-lg font-medium tracking-tight">Settings</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Applies instantly, stored in this browser.</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close settings" className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex flex-col gap-4 px-5 py-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Google Gemini API Host</p>
                <Input
                  value={baseUrl}
                  onChange={onBaseUrl}
                  onKeyDown={(e) => e.key === "Enter" && onSave()}
                  placeholder={DEFAULT_ROUTER_BASE}
                  className="w-full font-mono text-xs"
                />
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Hits Google Gemini directly (generativelanguage.googleapis.com) with no proxy.
                </p>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Custom Gemini Credential (optional)</p>
                <Input
                  value={authVal}
                  onChange={onAuthVal}
                  onKeyDown={(e) => e.key === "Enter" && onSave()}
                  placeholder="Leave empty to use built-in AAS account pool (or AIza... / ya29... / aas_et/...)"
                  className="w-full font-mono text-xs"
                />
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  By default, Storycast rotates built-in Google AAS tokens directly in the browser.
                </p>
                {urlError && <p className="mt-1.5 text-xs text-destructive">{urlError}</p>}
                {saved && <p className="mt-1.5 text-xs text-success">Saved.</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={onReset}>
                  Reset default
                </Button>
                <Button className="flex-[2]" onClick={onSave}>
                  Save
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
