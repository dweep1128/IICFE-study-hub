// Talks only to our own /api. The session lives in an httpOnly cookie the browser sends automatically.
const Auth = (() => {
  let mePromise = null;

  // Cached API answers (shell.js) belong to one student: drop them when the account changes, and after any write (shell.js api()).
  const dropCache = () => { try { Object.keys(sessionStorage).filter((k) => k.startsWith("iicfe-api:")).forEach((k) => sessionStorage.removeItem(k)); } catch { /* private mode */ } };
  const ME_KEY = "iicfe-me"; // the signed-in student, kept for this tab so the next page paints its shell without waiting
  const keepMe = (u) => { try { if (u) sessionStorage.setItem(ME_KEY, JSON.stringify(u)); else sessionStorage.removeItem(ME_KEY); } catch { /* private mode */ } };
  const keptMe = () => { try { return JSON.parse(sessionStorage.getItem(ME_KEY)); } catch { return null; } };

  const post = (url, body) => fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

  return {
    // Current student or null. Cached so header, hero and footer share one request. The copy kept from the previous page answers at
    // once; the live check still runs, refreshes that copy, and an expired session is caught by the page's own API calls (401 -> sign-in).
    me() {
      if (mePromise) return mePromise;
      const live = fetch("/api/me", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      live.then(keepMe);
      const kept = keptMe();
      mePromise = kept ? Promise.resolve(kept) : live;
      return mePromise;
    },
    dropCache,
    // Resolves to { ok: true, name } or { ok: false, error }.
    async login(email, password) {
      try {
        const res = await post("/api/login", { email, password });
        const data = await res.json().catch(() => ({}));
        mePromise = null;
        dropCache();
        keepMe(null);
        return res.ok ? { ok: true, name: data.name } : { ok: false, error: data.error || "Sign in failed. Please try again." };
      } catch {
        return { ok: false, error: "Can't reach the server. Please try again." };
      }
    },
    async logout() {
      try { await post("/api/logout"); } catch { /* cookie expires on its own */ }
      mePromise = null;
      dropCache();
      keepMe(null);
    },
    // The state-aware auth button/link used by header, hero and footer.
    link(user) {
      return user ? { label: "My Workspace", href: "workspace.html" } : { label: "Sign In", href: "signin.html" };
    },
    initials(name) {
      return String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
    },
  };
})();
