// Shared app shell for workspace.html and course.html: sidebar, top bar, bell, greeting band, ring, formatting.
// Both pages call mountShell() so they stay identical in look and behaviour.
const DAY_MS = 86_400_000;
const CRUMB_MAX_CHARS = 24;
const NOTIF_LIMITS = { due: 3, webinar: 2, news: 2 };
const RING_STROKE_RATIO = 0.1;

// ---------- helpers ----------
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method, credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { location.replace("signin.html"); throw new Error("Please sign in again."); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || "Something went wrong. Please try again."), { status: res.status });
  return data;
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// "2026-10-28" -> "28 Oct 2026". Date-only strings are read as UTC so the day never shifts with the viewer's timezone.
function fmtDate(v, withYear = true) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const opts = { day: "numeric", month: "short", ...(withYear && { year: "numeric" }), ...(ISO_DAY_RE.test(v) && { timeZone: "UTC" }) };
  return d.toLocaleDateString("en-GB", opts);
}
const fmtShort = (v) => fmtDate(v, false);
const todayLabel = () => {
  const d = new Date();
  return `${d.toLocaleDateString("en-GB", { weekday: "short" })}, ${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" })}`;
};
// Whole calendar days from today to a date-only string (negative = overdue).
function daysUntil(iso) {
  const n = new Date();
  return Math.round((Date.parse(iso) - Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())) / DAY_MS);
}
function dueIn(iso) {
  const n = daysUntil(iso);
  return Number.isNaN(n) ? `on ${fmtDate(iso)}` : n < 0 ? "overdue" : n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
}
const timeGreeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const paras = (text) => String(text ?? "").split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join("");

let toastTimer;
function toast(msg) {
  const t = $("[data-toast]");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

const skeleton = () => `<div aria-hidden="true"><div class="skel skel-h"></div><div class="skel skel-line"></div><div class="skel-grid"><div class="skel skel-card"></div><div class="skel skel-card"></div><div class="skel skel-card"></div></div></div><p class="sr-only" role="status">Loading</p>`;

function errorBox(message, onRetry) {
  const box = document.createElement("div");
  box.className = "hub-card err-box";
  box.innerHTML = `<h2>We couldn't load this</h2><p>${esc(message)}</p><button class="btn-pill solid" type="button">Try again</button>`;
  $("button", box).addEventListener("click", onRetry);
  return box;
}

// One short, restrained burst (teal and gold) from the top third of the viewport; nothing under reduced motion.
// Shared by the Activities games and the tests.
const CONFETTI_MS = 1400;
function confetti(count) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = document.createElement("canvas");
  cv.className = "ac-confetti";
  cv.setAttribute("aria-hidden", "true");
  cv.width = innerWidth; cv.height = innerHeight;
  document.body.append(cv);
  const ctx = cv.getContext("2d");
  const css = getComputedStyle(document.documentElement);
  const colours = ["--teal", "--gold", "--teal-deep"].map((v) => css.getPropertyValue(v).trim());
  const parts = Array.from({ length: count }, (_, i) => {
    const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 6;
    return { x: innerWidth / 2, y: innerHeight / 3, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 4, r: 3 + Math.random() * 4, c: colours[i % colours.length] };
  });
  const t0 = performance.now();
  (function tick(t) {
    const k = (t - t0) / CONFETTI_MS;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (k >= 1) return cv.remove();
    ctx.globalAlpha = 1 - k;
    for (const p of parts) { p.vy += 0.22; p.x += p.vx; p.y += p.vy; ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.r * 2, p.r); }
    requestAnimationFrame(tick);
  })(t0);
}

// ---------- icons ----------
const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICONS = {
  overview: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  guide: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>',
  resources: '<path d="m12 3 9 4.5-9 4.5-9-4.5Z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
  mock: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V3h6v1M9 13l2 2 4-4"/>',
  documents: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  exam: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  certificate: '<circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.5-1.5 7 5-2.5 5 2.5-1.5-7"/>',
  send: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chatbot: '<path d="M20 12a8 8 0 0 1-11.7 7.1L4 20l.9-4.3A8 8 0 1 1 20 12Z"/><path d="M9 11h6M9 14h3"/>',
  active: '<path d="m3 9 9-5 9 5-9 5Z"/><path d="M7 11.5V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5"/>',
  completed: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  journey: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  payments: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
  webinars: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3"/>',
  news: '<path d="M5 4h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2Z"/><path d="M18 9h2a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2M8.5 8h6M8.5 12h6M8.5 16h3"/>',
  inbox: '<path d="M4 13 6 5h12l2 8"/><path d="M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5h-5l-1.5 2h-3L9 13Z"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2 7.5 2 7.5H4S6 15 6 9Z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
};
const icon = (name) => svg(ICONS[name] ?? ICONS.inbox);

// ---------- ring + greeting ----------
function ring(percent, size = 88) {
  const p = Math.min(100, Math.max(0, Number(percent) || 0));
  const stroke = Math.round(size * RING_STROKE_RATIO);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${p}% complete">
    <circle cx="${mid}" cy="${mid}" r="${r}" class="rt" fill="none" stroke-width="${stroke}"/>
    <circle cx="${mid}" cy="${mid}" r="${r}" class="rf" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(p / 100) * c} ${c}" transform="rotate(-90 ${mid} ${mid})"/>
    <text x="${mid}" y="${mid + size * 0.07}" text-anchor="middle" style="font-size:${Math.round(size * 0.21)}px">${p}%</text></svg>`;
}

// The one-line-header band: greeting + real-data status line, progress ring and an optional action pill.
function greetingBand({ name, status, percent, action }) {
  const first = String(name).trim().split(/\s+/)[0];
  return `<section class="greet" aria-label="Welcome">
    <div><h1>${timeGreeting()}, ${esc(first)}<span class="dot">.</span></h1><p class="greet-status">${esc(status || "You're all caught up.")}</p></div>
    <div class="greet-side"><div class="ring-box">${ring(percent, 88)}<span class="mono">Complete</span></div>
      ${action ? `<a class="btn-pill solid" href="${esc(action.href)}">${esc(action.label)} <span class="arrow" aria-hidden="true">→</span></a>` : ""}</div>
  </section>`;
}

// ---------- notifications (shared by both pages' bell) ----------
function notificationsFrom(ws) {
  return [
    ...ws.dues.slice(0, NOTIF_LIMITS.due).map((d) => ({ kind: "Due", title: d.title, meta: `${d.type} · ${fmtDate(d.dueDate)}`, href: `course.html?id=${encodeURIComponent(d.courseId)}#overview` })),
    ...ws.webinars.slice(0, NOTIF_LIMITS.webinar).map((w) => ({ kind: "Webinar", title: w.title, meta: `${fmtDate(w.date)} · ${w.time}`, href: "workspace.html#webinars" })),
    ...ws.news.slice(0, NOTIF_LIMITS.news).map((n) => ({ kind: "News", title: n.title, meta: fmtDate(n.date), href: "workspace.html#news" })),
  ];
}

// ---------- profile footer ----------
const SETTINGS_HREF = "workspace.html#settings";
// A photo URL on the user record wins; otherwise the initials sit on a teal disc.
const avatarHtml = (user, cls = "") => {
  const url = /^https?:\/\//i.test(user.photoUrl ?? "") ? user.photoUrl : "";
  return `<span class="avatar ${cls}" aria-hidden="true">${url ? `<img src="${esc(url)}" alt="">` : esc(Auth.initials(user.name))}</span>`;
};
async function signOut() { await Auth.logout(); location.assign("index.html"); }

function setupProfile(root) {
  const btn = $(".profile-btn", root);
  const menu = $(".profile-menu", root);
  const items = $$("[role=menuitem]", menu);
  const toggle = $("[data-theme-toggle]", root);
  const open = () => { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); items[0].focus(); };
  const close = (returnFocus = true) => {
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (returnFocus) btn.focus();
  };
  btn.addEventListener("click", () => (menu.hidden ? open() : close()));
  btn.addEventListener("keydown", (e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); if (menu.hidden) open(); } });
  menu.addEventListener("keydown", (e) => {
    const i = items.indexOf(document.activeElement);
    const move = { ArrowDown: (i + 1) % items.length, ArrowUp: (i - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[e.key];
    if (move !== undefined) { e.preventDefault(); items[move].focus(); }
    else if (e.key === "Tab") close(false);
  });
  menu.addEventListener("click", (e) => { if (e.target.closest("[data-signout]")) signOut(); else if (e.target.closest("a")) close(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) { e.stopPropagation(); close(); } }, true);
  document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !e.target.closest(".profile")) close(false); });

  // Moon in light mode, sun in dark mode; the label names the action.
  const drawToggle = () => {
    const dark = Theme.resolved() === "dark";
    toggle.innerHTML = icon(dark ? "sun" : "moon");
    toggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    toggle.setAttribute("aria-pressed", dark);
  };
  toggle.addEventListener("click", () => Theme.toggle());
  Theme.onChange(drawToggle);
  drawToggle();
}

// ---------- shell ----------
const truncate = (t) => (t.length > CRUMB_MAX_CHARS ? `${t.slice(0, CRUMB_MAX_CHARS - 1).trimEnd()}…` : t);

// nav: [{ id, label, icon }]   backLink: { href, label } | null   user: { name }
function mountShell({ nav, backLink = null, user }) {
  const root = $("[data-app]");
  root.innerHTML = `
    <aside class="side" id="appSide" aria-label="Navigation">
      <div class="side-brand"><a class="brand" href="index.html" aria-label="IICFE Singapore home" data-brand></a>
        <button class="rail-toggle" type="button" aria-expanded="true" aria-label="Collapse navigation" hidden></button></div>
      ${backLink ? `<a class="pill-back" href="${esc(backLink.href)}"><span aria-hidden="true">←</span><span class="lbl"> ${esc(backLink.label)}</span></a>` : ""}
      <nav aria-label="Sections"><ul class="side-nav">${nav.map((n) => `<li><a href="#${esc(n.id)}" data-id="${esc(n.id)}"><span class="tile">${icon(n.icon)}</span><span class="lbl">${esc(n.label)}</span></a></li>`).join("")}</ul></nav>
      <div class="profile">
        <div class="profile-menu" id="profileMenu" role="menu" aria-label="Profile" hidden>
          <div class="pm-head"><strong>${esc(user.name)}</strong><small>${esc(user.email ?? "")}</small></div>
          <a role="menuitem" href="${SETTINGS_HREF}" tabindex="-1">${icon("settings")}Settings</a>
          <button role="menuitem" type="button" data-signout tabindex="-1">${icon("lock")}Sign out</button>
        </div>
        <button class="profile-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="profileMenu" aria-label="${esc(user.name)}, profile menu">${avatarHtml(user)}
          <span class="who"><strong>${esc(user.name)}</strong><small>${esc(user.email ?? "")}</small></span></button>
        <button class="icon-btn" type="button" data-theme-toggle aria-pressed="false"></button>
        <a class="icon-btn" href="${SETTINGS_HREF}" aria-label="Settings">${icon("settings")}</a>
      </div>
    </aside>
    <div class="scrim"></div>
    <div class="app-main">
      <header class="topbar">
        <button class="burger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="appSide">${icon("menu").replace("<svg", '<svg width="22" height="22"')}</button>
        <p class="crumb mono" aria-label="Breadcrumb"></p>
        <p class="today mono">${esc(todayLabel())}</p>
        <div class="bell-wrap">
          <button class="bell" type="button" aria-label="Notifications" aria-expanded="false" aria-controls="bellPop">${icon("bell").replace("<svg", '<svg width="20" height="20"')}<span class="bell-dot" hidden></span></button>
          <div class="bell-pop" id="bellPop" hidden></div>
        </div>
      </header>
      <main id="main" class="app-panel" data-panel tabindex="-1"></main>
    </div>
    <div class="toast" data-toast role="status" aria-live="polite"></div>`;
  renderBrand();

  const side = $(".side", root);
  const scrim = $(".scrim", root);
  const burger = $(".burger", root);
  const setDrawer = (open) => {
    side.classList.toggle("open", open);
    scrim.classList.toggle("show", open);
    burger.setAttribute("aria-expanded", open);
    if (open) $("a[data-id]", side).focus();
  };
  burger.addEventListener("click", () => setDrawer(!side.classList.contains("open")));
  scrim.addEventListener("click", () => { setDrawer(false); burger.focus(); });
  setupProfile(root);

  // Icon rail: on Resources / Mock Tests / Final Exam the sidebar folds to 72px (names move to tooltips) so the page gets the width.
  // The student can expand it again; the choice is remembered. Other views always show the full sidebar.
  const RAIL_KEY = "iicfe-sidebar";
  const CHEV = { open: svg('<path d="m9 6 6 6-6 6"/>'), close: svg('<path d="m15 6-6 6 6 6"/>') };
  const railBtn = $(".rail-toggle", root);
  let railEligible = false;
  const railPref = () => { try { return localStorage.getItem(RAIL_KEY); } catch { return null; } };
  function applyRail() {
    const collapsed = railEligible && railPref() !== "expanded";
    root.classList.toggle("rail", collapsed);
    railBtn.hidden = !railEligible;
    railBtn.setAttribute("aria-expanded", String(!collapsed));
    railBtn.setAttribute("aria-label", collapsed ? "Expand navigation" : "Collapse navigation");
    railBtn.innerHTML = collapsed ? CHEV.open : CHEV.close;
    const named = [...$$("a[data-id]", side), ...$$(".profile .icon-btn", side), $(".pill-back", side)].filter(Boolean);
    for (const el of named) collapsed ? el.setAttribute("title", el.getAttribute("aria-label") ?? el.textContent.trim()) : el.removeAttribute("title");
    railBtn.title = railBtn.getAttribute("aria-label");
  }
  railBtn.addEventListener("click", () => {
    const wasCollapsed = root.classList.contains("rail");
    try { localStorage.setItem(RAIL_KEY, wasCollapsed ? "expanded" : "collapsed"); } catch { /* choice lasts for this page only */ }
    applyRail();
  });

  // bell
  const bell = $(".bell", root);
  const pop = $(".bell-pop", root);
  const dot = $(".bell-dot", root);
  let items = null;
  const closeBell = () => { pop.hidden = true; bell.setAttribute("aria-expanded", "false"); };
  const drawBell = () => {
    pop.innerHTML = items === null
      ? '<div class="none">Loading…</div>'
      : items.length
        ? `<h2>Notifications</h2><ul>${items.map((i) => `<li><a href="${esc(i.href)}"><span class="t">${esc(i.title)}</span><span class="m"><span class="chip">${esc(i.kind)}</span>${esc(i.meta)}</span></a></li>`).join("")}</ul>`
        : `<div class="none"><div class="empty-ic">${icon("bell")}</div>You're all caught up.</div>`;
  };
  bell.addEventListener("click", () => {
    if (!pop.hidden) return closeBell();
    drawBell();
    pop.hidden = false;
    bell.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("pointerdown", (e) => { if (!pop.hidden && !e.target.closest(".bell-wrap")) closeBell(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!pop.hidden) { closeBell(); bell.focus(); }
    if (side.classList.contains("open")) { setDrawer(false); burger.focus(); }
  });

  return {
    panel: $("[data-panel]", root),
    closeDrawer: () => setDrawer(false),
    setRail(eligible) { railEligible = eligible; applyRail(); },
    hideNav() { $("nav", side).hidden = true; }, // e.g. "course not found": nothing to navigate inside
    setActive(id) {
      $$("a[data-id]", side).forEach((a) => (a.dataset.id === id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
      const cur = $(`a[data-id="${CSS.escape(id)}"]`, side);
      cur?.scrollIntoView({ block: "nearest" });
    },
    // parts: strings; long ones are truncated with the full text in a tooltip. The last part is the current page.
    setCrumb(parts) {
      $(".crumb", root).innerHTML = parts.map((p, i) => {
        const text = truncate(p);
        const inner = `<span${text !== p ? ` title="${esc(p)}"` : ""}>${esc(text)}</span>`;
        return i === parts.length - 1 ? `<b>${inner}</b>` : inner;
      }).join('<span class="sep" aria-hidden="true">→</span>');
    },
    setNotifications(list) {
      items = list;
      dot.hidden = list.length === 0; // gold dot only when there is something to see
      if (!pop.hidden) drawBell();
    },
  };
}
