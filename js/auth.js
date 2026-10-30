// Talks only to our own /api. The session lives in an httpOnly cookie the browser sends automatically.
const Auth = (() => {
  let mePromise = null;

  const post = (url, body) => fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

  return {
    // Current student or null. Cached so header, hero and footer share one request.
    me() {
      mePromise ??= fetch("/api/me", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      return mePromise;
    },
    // Resolves to { ok: true, name } or { ok: false, error }.
    async login(email, password) {
      try {
        const res = await post("/api/login", { email, password });
        const data = await res.json().catch(() => ({}));
        mePromise = null;
        return res.ok ? { ok: true, name: data.name } : { ok: false, error: data.error || "Sign in failed. Please try again." };
      } catch {
        return { ok: false, error: "Can't reach the server. Please try again." };
      }
    },
    async logout() {
      try { await post("/api/logout"); } catch { /* cookie expires on its own */ }
      mePromise = null;
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
