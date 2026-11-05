// My Workspace: renders GET /api/workspace into the shared shell (see js/shell.js).
const { sections } = DATA.workspace;
const DEFAULT_ID = sections[0].id;
let ws = null; // GET /api/workspace response, set once loaded
let shell;
let shownId = null; // section currently rendered, so tab changes inside My Courses don't re-render the page

// "#completed" is a tab inside My Courses, not a section of its own.
const TAB_HASHES = ["active", "completed"];
const DONE_PCT = 100;
// Done = marked completed, or every module finished. Courses with no modules yet are never "done" by percentage.
const isDone = (c) => c.status === "completed" || (c.modulesTotal > 0 && c.progressPct >= DONE_PCT);
let courses = { active: [], completed: [] };
let manifest = null; // Founder's Lab content manifest; null if it failed to load (the card then shows 0 progress)
let labSessions = null; // Founder's Lab Sessions list (the course page's own source), null until it loads

// Founder's Lab progress is read in the browser (see js/progress.js) with the course page's numbers, so it overrides the server's modules.
function applyFounders() {
  if (!manifest || !labSessions) return;
  const sum = Founders.summary(manifest);
  const cp = Founders.courseProgress(manifest, labSessions.sessions);
  for (const c of [...ws.activeCourses, ...ws.completedCourses]) {
    if (c.courseId !== Founders.COURSE_ID) continue;
    Object.assign(c, { fl: sum, unit: "session", progressPct: cp.percent, modulesCompleted: cp.sessionsDone, modulesTotal: cp.sessionsTotal, currentModule: "" });
  }
}
const splitCourses = () => {
  applyFounders();
  const all = [...ws.activeCourses, ...ws.completedCourses];
  courses = { active: all.filter((c) => !isDone(c)), completed: all.filter(isDone) };
};
// Overall percentage = mean of each course's percentage (one course today, so this is done steps / total steps).
const pctOf = (c) => (isDone(c) ? DONE_PCT : c.progressPct);
const overallPct = () => {
  const all = [...courses.active, ...courses.completed];
  return all.length ? Math.round(all.reduce((n, c) => n + pctOf(c), 0) / all.length) : 0;
};
// Modules done / total across every course. A course with 0 modules adds 0 to both, so it is left out of the total.
const moduleTotals = () => [...courses.active, ...courses.completed].reduce(
  (t, c) => ({ done: t.done + c.modulesCompleted, total: t.total + c.modulesTotal }), { done: 0, total: 0 });
const tabFromHash = () => (location.hash === "#completed" ? "completed" : "active");

const external = (u) => /^https?:\/\//i.test(u);
const extAttrs = (u) => (external(u) ? ' target="_blank" rel="noopener noreferrer"' : "");
const monthDay = (iso) => ({ m: new Date(iso).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }), d: new Date(iso).getUTCDate() });
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';

const empty = (s) => emptyState(s.empty.title, s.empty.text, icon(s.icon));

// "1 active course · next webinar 3 Nov" -- only from real data.
function workspaceStatus() {
  const parts = [];
  if (courses.active.length) parts.push(plural(courses.active.length, "active course"));
  if (ws.webinars[0]) parts.push(`next webinar ${fmtShort(ws.webinars[0].date)}`);
  return parts.join(" · ");
}

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

// "1 of 12 sessions" once a session is finished, "Session 1 in progress" when only started, otherwise "Not started".
function founderLabel(c) {
  if (c.modulesCompleted > 0) return `${c.modulesCompleted} of ${plural(c.modulesTotal, "session")}`;
  const s = c.fl.sessions.find((x) => x.started);
  return s ? `Session ${s.no} in progress` : "Not started";
}
// Always the Overview tab; the course page itself deep-links to the next step from there.
const courseHref = (c) => `course.html?id=${encodeURIComponent(c.courseId)}#overview`;

const workspaceCourseCard = (c, done = false) => `
  <article class="hub-card course-card">
    <div class="cc-body">
      <div><h3>${esc(c.title)}</h3>${c.description ? `<p>${esc(c.description)}</p>` : ""}</div>
      <div class="cc-side">${done ? `<span class="pill-teal chip cc-done">${CHECK}Completed</span>` : ring(c.progressPct, 76)}
        <span class="now">${c.fl ? esc(founderLabel(c)) : !done && c.currentModule ? `Now<b>${esc(c.currentModule)}</b>` : `${c.modulesCompleted} of ${c.modulesTotal} modules`}</span></div>
    </div>
    ${!done && c.fl?.next?.hint ? `<p class="cc-hint">${esc(c.fl.next.hint)}</p>` : ""}
    ${!done && c.nextDue ? `<p class="cc-due">${CAL}<span>Next due: <b>${esc(c.nextDue.title)}</b> · ${esc(fmtDate(c.nextDue.dueDate))}</span></p>` : ""}
    <div class="cc-foot"><a class="btn-pill solid" href="${esc(courseHref(c))}" aria-label="${done ? "View course" : "Continue learning"}: ${esc(c.title)}">${done ? "View course" : "Continue learning"} <span class="arrow" aria-hidden="true">→</span></a></div>
  </article>`;

const courseTab = (id, label, n, selected) =>
  `<button class="tab" role="tab" type="button" id="tab-${id}" data-tab="${id}" aria-selected="${selected}" aria-controls="panel-${id}" tabindex="${selected ? 0 : -1}">${label} <span class="tab-count">${n}</span></button>`;

const VIEW = {
  active(s) {
    const next = ws.webinars[0];
    const greet = greetingBand({ name: ws.student.name, status: workspaceStatus(), percent: overallPct() });
    const mods = moduleTotals();
    const tiles = `
      <div class="stat-tiles">
        <div class="hub-card stat-tile"><span class="tile">${icon("active")}</span><div><span class="v">${courses.active.length}</span><span class="mono">Active courses</span></div></div>
        <div class="hub-card stat-tile"><span class="tile">${icon("resources")}</span><div><span class="v">${mods.done} of ${mods.total}</span><span class="mono">Modules completed</span></div></div>
        ${next ? `<div class="hub-card stat-tile"><span class="tile">${icon("webinars")}</span><div><span class="v sm">${esc(fmtDate(next.date))}</span><span class="mono">Next webinar</span></div></div>` : ""}
      </div>`;
    const sel = tabFromHash();
    const grid = (list, done) => `<div class="course-grid">${list.map((c) => workspaceCourseCard(c, done)).join("")}</div>`;
    const completedEmpty = emptyState("No completed courses yet", "Finish a course and it will show up here.", icon("completed"));
    return greet + tiles + `
      <div class="tabs" role="tablist" aria-label="My courses">
        ${courseTab("active", "Active", courses.active.length, sel === "active")}
        ${courseTab("completed", "Completed", courses.completed.length, sel === "completed")}
        <span class="tab-bar" aria-hidden="true"></span>
      </div>
      <div role="tabpanel" id="panel-active" aria-labelledby="tab-active"${sel === "active" ? "" : " hidden"}>${courses.active.length ? grid(courses.active, false) : empty(s)}</div>
      <div role="tabpanel" id="panel-completed" aria-labelledby="tab-completed"${sel === "completed" ? "" : " hidden"}>${courses.completed.length ? grid(courses.completed, true) : completedEmpty}</div>`;
  },

  // One card per enrolled course, with the same numbers as My Courses (and, for Founder's Lab, as its Sessions page).
  journey(s) {
    const all = [...courses.active, ...courses.completed];
    if (!all.length) return empty(s);
    const p = overallPct();
    const card = (c) => { const pct = pctOf(c); return `
        <article class="hub-card item-card"><h3>${esc(c.title)}</h3>
          <div class="jr-prog"><div class="bar" role="progressbar" aria-label="${esc(c.title)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>
          <p>${c.modulesCompleted} of ${plural(c.modulesTotal, c.unit ?? "module")}</p>
          <div class="foot"><a class="btn-pill solid sm" href="${esc(courseHref(c))}" aria-label="Continue: ${esc(c.title)}">Continue <span class="arrow" aria-hidden="true">→</span></a></div>
        </article>`; };
    return `<div class="hub-card journey-card"><div class="ring-box">${ring(p, 88)}<span class="mono">Complete</span></div>
        <div><strong>${p}%</strong><p>${courses.completed.length} of ${all.length} courses complete</p></div></div>
      <h2 class="section-title" style="margin-top:28px">Courses</h2>
      <div class="plain-grid">${all.map(card).join("")}</div>`;
  },

  payments(s) {
    const cell = (c, row) => {
      if (c.key === "date") return esc(fmtDate(row.date));
      if (c.key === "status") return `<span class="status-pill${/^paid$/i.test(row.status) ? " paid" : ""}">${esc(row.status)}</span>`;
      if (c.link) return row[c.key] ? `<a class="btn-pill sm" href="${esc(row[c.key])}" target="_blank" rel="noopener noreferrer">${esc(c.link)}</a>` : '<span class="mono">—</span>';
      return esc(row[c.key] ?? "");
    };
    if (!ws.payments.length) return empty(s);
    return `<div class="hub-card table-wrap" tabindex="0" role="region" aria-label="${esc(s.label)}"><table>
      <thead><tr>${s.columns.map((c) => `<th scope="col">${esc(c.label)}</th>`).join("")}</tr></thead>
      <tbody>${ws.payments.length
        ? ws.payments.map((r) => `<tr>${s.columns.map((c) => `<td>${cell(c, r)}</td>`).join("")}</tr>`).join("")
        : `<tr><td class="empty-cell" colspan="${s.columns.length}">${esc(s.empty.title)}</td></tr>`}</tbody></table></div>`;
  },

  certificates: (s) => ws.certificates.length
    ? `<div class="plain-grid">${ws.certificates.map((c) => `
        <article class="hub-card item-card"><div class="row"><span class="cert-ic">${icon("certificate")}</span>
          <div><h3>${esc(c.courseTitle)}</h3><p>Issued ${esc(fmtDate(c.issuedOn))}</p></div></div>
          ${c.certUrl ? `<div class="foot"><a class="btn-pill sm" href="${esc(c.certUrl)}"${extAttrs(c.certUrl)}>View certificate <span class="arrow" aria-hidden="true">→</span></a></div>` : ""}</article>`).join("")}</div>`
    : empty(s),

  webinars: (s) => ws.webinars.length
    ? `<div class="plain-grid">${ws.webinars.map((w) => { const b = monthDay(w.date); return `
        <article class="hub-card item-card"><div class="row"><span class="date-badge" aria-hidden="true"><span><span class="m">${esc(b.m)}</span><br><span class="d">${b.d}</span></span></span>
          <div><h3>${esc(w.title)}</h3><p>${esc(fmtDate(w.date))} · ${esc(w.time)}</p></div></div>
          ${w.joinUrl ? `<div class="foot"><a class="btn-pill solid sm" href="${esc(w.joinUrl)}" target="_blank" rel="noopener noreferrer">Join <span class="arrow" aria-hidden="true">→</span></a></div>` : ""}</article>`; }).join("")}</div>`
    : empty(s),

  news: (s) => ws.news.length
    ? `<div class="plain-grid">${ws.news.map((n) => `
        <article class="hub-card item-card"><span class="mono nocase">${esc(fmtDate(n.date))}</span><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p></article>`).join("")}</div>`
    : empty(s),
};

const currentId = () => {
  const id = location.hash.slice(1);
  if (id === "settings") return "settings"; // reached from the gear and the profile menu, not listed in the sidebar
  return sections.some((s) => s.id === id) ? id : DEFAULT_ID; // "#completed" falls through to My Courses
};

// ---------- My Courses tabs ----------
function selectTab(name) {
  const list = shell && $(".tabs", shell.panel); // a resize can arrive before the shell has mounted
  if (!list) return;
  const bar = $(".tab-bar", list);
  let current;
  $$("[role=tab]", list).forEach((t) => {
    const on = t.dataset.tab === name;
    t.setAttribute("aria-selected", on);
    t.tabIndex = on ? 0 : -1;
    $(`#panel-${t.dataset.tab}`).hidden = !on;
    if (on) current = t;
  });
  bar.style.width = `${current.offsetWidth}px`;
  bar.style.transform = `translateX(${current.offsetLeft}px)`;
  current.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function setupTabs() {
  const list = $(".tabs", shell.panel);
  if (!list) return;
  selectTab(tabFromHash());
  requestAnimationFrame(() => $(".tab-bar", list).classList.add("ready")); // no slide on first paint
  document.fonts?.ready.then(() => selectTab(tabFromHash())); // web fonts change tab widths
  const go = (name) => { location.hash = `#${name}`; };
  list.addEventListener("click", (e) => { const t = e.target.closest("[role=tab]"); if (t) go(t.dataset.tab); });
  list.addEventListener("keydown", (e) => {
    const i = TAB_HASHES.indexOf(tabFromHash());
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TAB_HASHES.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const name = TAB_HASHES[(next + TAB_HASHES.length) % TAB_HASHES.length];
    go(name);
    $(`#tab-${name}`).focus();
  });
}
let resizeFrame = 0; // once per frame, not on every resize event
addEventListener("resize", () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => selectTab(tabFromHash())); });

let me = null; // signed-in student from /api/me
let stopSettings = null;
function renderSettings() {
  shell.setActive("settings");
  shell.setCrumb(["Settings"]);
  shell.closeDrawer();
  document.title = "Settings · IICFE Study Hub";
  shell.panel.innerHTML = settingsView(me);
  stopSettings = mountSettings(shell.panel);
  shownId = "settings";
}

function render() {
  stopSettings?.();
  stopSettings = null;
  const id = currentId();
  if (id === "settings") return renderSettings();
  const s = sections.find((x) => x.id === id);
  shell.setActive(id);
  shell.setCrumb(["Workspace", s.label]);
  shell.closeDrawer();
  document.title = `${s.label} · My Workspace · IICFE Study Hub`;
  if (!ws) { shell.panel.innerHTML = skeleton(); return; }
  // The landing section opens with the greeting band; the others open with a plain title.
  const head = id === DEFAULT_ID ? "" : `<div class="panel-head"><h1>${esc(s.label)}</h1><p>${esc(s.desc)}</p></div>`;
  shell.panel.innerHTML = head + VIEW[id](s);
  shownId = id;
  if (id === DEFAULT_ID) setupTabs();
}

async function init() {
  // Every request starts now, before /api/me answers; copies kept from the last visit draw at once and are re-checked with the server.
  const manifestP = Founders.load().catch(() => null);
  const labP = swrApi(`${Founders.LAB_API}/bundle?parts=progress,sessions`, (b) => { labSessions = b.sessions; Founders.prime(b.progress); })
    .catch(() => null); // not enrolled in Founder's Lab, or it is down: its card keeps the server's numbers
  let drawn = false, latest = null; // `ws` is set only once everything is in, so the page never draws half its data
  const wsP = swrApi("/api/workspace", (d) => { latest = d; if (drawn) { ws = d; redraw(); } });
  wsP.catch(() => {}); // shown below
  const user = me = await Auth.me();
  if (!user) return location.replace("signin.html");
  shell = mountShell({ nav: sections, user });
  addEventListener("hashchange", () => {
    if (ws && currentId() === shownId && $(".tabs", shell.panel)) return selectTab(tabFromHash()); // tab switch only: keep the sliding underline
    render(); scrollTo({ top: 0 }); shell.panel.focus({ preventScroll: true }); });
  render();

  try {
    [, manifest] = await Promise.all([wsP, manifestP, labP]);
    ws = latest;
  } catch (e) {
    shell.panel.replaceChildren(errorBox(e.message, () => location.reload()));
    return;
  }
  drawn = true;
  splitCourses();
  // Re-draw when Founder's Lab progress changes (a save in this window, or a refresh after the student comes back).
  const signature = () => JSON.stringify(Object.values(courses).map((l) => l.map((c) => [c.courseId, c.progressPct, c.modulesCompleted, c.fl?.doneSteps])));
  Founders.watch(() => {
    const before = signature();
    splitCourses();
    if (signature() !== before && ["active", "journey"].includes(currentId())) render(); // skip no-op re-renders (focus fires often)
  });
  shell.setNotifications(notificationsFrom(ws));
  render();
}
// The server's copy of the workspace differed from the one kept from the last visit.
function redraw() {
  splitCourses();
  shell.setNotifications(notificationsFrom(ws));
  if (currentId() !== "settings") render(); // never under a half-filled form
}

init();
