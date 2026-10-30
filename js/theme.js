// Theme preference: "light" (default) | "dark" | "system", stored in localStorage as "iicfe-theme".
// The inline script in every page's <head> sets data-theme before first paint; this file keeps it in sync afterwards
// (live OS changes, other tabs, the sidebar toggle and the Settings page).
const Theme = (() => {
  const KEY = "iicfe-theme";
  const MODES = ["light", "dark", "system"];
  const DEFAULT_MODE = "light"; // must match the inline script in every page's <head>
  const FADE_MS = 150;
  const media = matchMedia("(prefers-color-scheme: dark)");
  const listeners = new Set();

  const preference = () => {
    try { const v = localStorage.getItem(KEY); return MODES.includes(v) ? v : DEFAULT_MODE; } catch { return DEFAULT_MODE; }
  };
  const systemTheme = () => (media.matches ? "dark" : "light");
  const resolved = (pref = preference()) => (pref === "system" ? systemTheme() : pref);

  function apply(fade = false) {
    const root = document.documentElement;
    const next = resolved();
    if (root.dataset.theme === next) return;
    if (fade) { // the CSS skips the transition under prefers-reduced-motion
      root.classList.add("theme-fade");
      setTimeout(() => root.classList.remove("theme-fade"), FADE_MS + 30);
    }
    root.dataset.theme = next;
    listeners.forEach((fn) => fn());
  }

  function set(pref) {
    if (!MODES.includes(pref)) return;
    try { localStorage.setItem(KEY, pref); } catch { /* private mode: applies for this page only */ }
    apply(true);
    listeners.forEach((fn) => fn());
  }

  media.addEventListener("change", () => apply(true)); // only matters while preference is "system"
  addEventListener("storage", (e) => { if (e.key === KEY) apply(true); }); // another tab changed it

  return {
    preference, resolved, systemTheme, set,
    toggle: () => set(resolved() === "dark" ? "light" : "dark"),
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
