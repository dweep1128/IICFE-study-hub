// Course hub: router and course data. The sidebar, top bar, bell and helpers come from js/shell.js.
const Panels = {};
const Hub = {
  courseId: new URLSearchParams(location.search).get("id") || "",
  user: null,
  title: "",
  manifest: null, // content manifest (Founder's Lab only for now), loaded before the first route
  cleanup: null,
  _hub: null,
  // Overview data is shared by the breadcrumb and the overview panel, so fetch it once.
  getHub() { return (this._hub ??= api(`/api/courses/${encodeURIComponent(this.courseId)}/hub`).catch((e) => { this._hub = null; throw e; })); },
  url(path) { return `/api/courses/${encodeURIComponent(this.courseId)}/${path}`; },
};

// The Founder's Lab portal's own navigation, then Study Hub's Certificate and Amigo.
const NAV = [
  { id: "overview", label: "Overview", icon: "pGrid" },
  { id: "journey", label: "My Journey", icon: "pCompass" },
  { id: "toolkit", label: "Toolkit", icon: "pBook" },
  { id: "sessions", label: "Sessions", icon: "pCalendar" },
  { id: "documents", label: "Documents", icon: "pFile" },
  { id: "certificate", label: "Certificate", icon: "certificate" },
  { id: "amigo", label: "Amigo", icon: "chatbot" }, // icon name is the shell's chat-bubble glyph
];
const NEEDS_PROGRESS = new Set(["sessions", "certificate"]);

let shell;
let seq = 0;

// "#resources/study-notes" -> ["resources", "study-notes"]
const hashParts = () => location.hash.slice(1).split("/");
const LEGACY_IDS = { chatbot: "amigo" }; // old bookmarks
// Old bookmarks to the session steps: #resources/study-notes, #resources/s2/activities, #mock, #final, #final/mentor-desk -> the same step under Sessions.
function legacyHash() {
  const [a, b, c] = hashParts();
  const sid = /^s(d+)$/.exec(b ?? "");
  const no = sid ? sid[1] : "1";
  const key = sid ? c : b;
  if (a === "resources") return `#sessions/${no}${key ? `/${key}` : ""}`;
  if (a === "mock") return "#sessions/1/practice";
  if (a === "final" || a === "exam") return `#sessions/1/${b === "mentor-desk" ? "mentor-desk" : "real-test"}`;
  return null;
}
const currentId = () => {
  const raw = hashParts()[0];
  const id = LEGACY_IDS[raw] ?? raw;
  return NAV.some((n) => n.id === id) ? id : "overview";
};

// Small lock beside "Final Exam" while it is locked. The link still works: it opens the Requirements page.
const LOCK_TIP = "Complete Resources and the Practice Test to unlock";
function syncExamLock() {
  const a = document.querySelector('.side-nav a[data-id="final"]');
  if (!a || !Hub.manifest) return;
  const sum = Founders.summary(Hub.manifest);
  const locked = (sum.current ?? sum.sessions.at(-1)).gate.locked;
  let badge = $(".nav-lock", a);
  if (!locked) { badge?.remove(); a.removeAttribute("title"); return; }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "nav-lock";
    badge.innerHTML = `${icon("lock")}<span class="sr-only">(locked)</span>`;
    a.append(badge);
  }
  a.title = LOCK_TIP;
}

// A module the course doesn't have (or hasn't released) gets a calm, specific message instead of a crash or a silent fallback.
const notAvailableYet = (el) => { el.innerHTML = emptyState("This module isn't available yet", "It will open here when your mentors release it.", icon("lock")); };

const labelOf = (id) => NAV.find((n) => n.id === id)?.label ?? "Sessions";

// "Your journey" in the sidebar: the stage progress, drawn from the server's journey.
function drawJourneyWidget() {
  const j = Founders.journeyNow();
  shell.setWidget(j ? `<a class="jw" href="#journey">
    <div class="jw-top"><b>Your journey</b><span class="jw-chev" aria-hidden="true">${icon("pChevron")}</span></div>
    <div class="jw-row"><div class="jw-track" role="progressbar" aria-label="Journey progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${j.percent}"><i style="transform:scaleX(${j.percent / 100})"></i></div><span class="jw-pct">${j.percent}%</span></div>
    <p class="jw-lab">${j.doneStages} of ${j.totalStages} stages</p></a>` : "");
}

async function route(isFirst = false) {
  const legacy = legacyHash();
  if (legacy) return location.replace(legacy); // the hashchange runs route() again
  const id = currentId();
  const mine = ++seq;
  const panel = shell.panel;
  shell.setActive(id);
  shell.closeDrawer();
  shell.setRail(id === "sessions" && Sessions.wantsRail()); // Session 1's reading layout gets the 72px icon rail (see shell.js)
  syncExamLock();

  // Tabs inside a session switch in place, so a game or a quiz in progress and the scroll position survive.
  if (id === "sessions" && Sessions.go(hashParts().slice(1))) return;

  Hub.cleanup?.();
  Hub.cleanup = null;
  document.title = `${labelOf(id)} · IICFE Study Hub`;
  panel.innerHTML = skeleton();

  const el = document.createElement("div");
  try {
    // Screens that show progress wait for it; if the server can't be reached this falls through to the error box and its Retry.
    if (Hub.manifest && NEEDS_PROGRESS.has(id)) await Founders.ready();
    const cleanup = await Panels[id](el, Hub);
    if (mine !== seq) return cleanup?.(); // user already moved on
    panel.replaceChildren(el);
    Hub.cleanup = cleanup ?? null;
  } catch (err) {
    if (mine !== seq) return;
    panel.replaceChildren(errorBox(err.message, () => route()));
  }
  if (!isFirst) { scrollTo({ top: 0 }); panel.focus({ preventScroll: true }); }
}

function showNotFound() {
  shell.hideNav();
  shell.setCrumb(["My Courses", "Course not found"]);
  document.title = "Course not found · IICFE Study Hub";
  shell.panel.innerHTML = `<div class="box empty"><div class="empty-ic">${icon("inbox")}</div><h1 class="empty-title">Course not found</h1>
    <p>We couldn't find that course, or you aren't enrolled in it.</p>
    <p><a class="btn-pill solid" href="workspace.html#active"><span aria-hidden="true">←</span> Back to My Courses</a></p></div>`;
}

async function startHub() {
  Hub.user = await Auth.me();
  if (!Hub.user) return location.replace("signin.html");

  document.body.classList.add("hub-page");
  shell = mountShell({ nav: NAV, backLink: { href: "workspace.html", label: "My Workspace" }, user: Hub.user, profileHref: "#profile" });
  shell.panel.innerHTML = skeleton();
  if (!/^[\w-]{1,40}$/.test(Hub.courseId)) return showNotFound();

  try {
    const [h, manifest] = await Promise.all([Hub.getHub(), Hub.courseId === Founders.COURSE_ID ? Founders.load() : null]);
    Hub.title = h.course.title;
    Hub.manifest = manifest;
  } catch (e) {
    if (e.status === 404) return showNotFound();
    return shell.panel.replaceChildren(errorBox(e.message, () => location.reload()));
  }

  addEventListener("hashchange", () => route());
  shell.setTopbar({ left: Hub.title, right: Hub.manifest?.cohortLabel ?? Hub.title }); // the left becomes the startup name once the profile exists
  Founders.watch(syncExamLock);
  if (Hub.manifest) {
    Founders.watch(drawJourneyWidget);
    Founders.journey().catch(() => {}); // the sidebar widget fills in when this arrives; the Overview and My Journey show their own Retry if it fails
    Founders.ready().catch(() => {}); // start loading lab progress now; each screen that needs it waits for it (and shows Retry if it fails)
  }
  // The bell lists dues, webinars and news from the same data the workspace uses.
  api("/api/workspace").then((ws) => shell.setNotifications(notificationsFrom(ws))).catch(() => shell.setNotifications([]));
  route(true);
}
