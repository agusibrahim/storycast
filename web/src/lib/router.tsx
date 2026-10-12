import { useEffect, useRef, useState, type AnchorHTMLAttributes } from "react";

export function usePath() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
}

export function navigate(to: string) {  const [path, hash] = to.split("#");
  if (path && path !== window.location.pathname) {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo({ top: 0 });
  }
  if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    />
  );
}

// ------------------------------------------------------- modal hash routing
// Opening a dialog pushes #key so the system back button closes the topmost
// dialog instead of leaving the page. Stacking works: each dialog owns one key.

export function pushModalHash(key: string) {
  if (window.location.hash !== `#${key}`) {
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}#${key}`);
  }
}

/** X buttons / backdrops: step back when our hash is on top, else close now. */
export function dismissModal(key: string, onClose: () => void) {
  if (window.location.hash === `#${key}`) window.history.back();
  else onClose();
}

/** Pushes #key while open; a back press (hash gone) closes the dialog. */
export function useModalHash(key: string, open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!open) return;
    pushModalHash(key);
    const onPop = () => {
      if (window.location.hash !== `#${key}`) ref.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open, key]);
}
