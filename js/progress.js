// Founder's Lab: manifest loader + the student's progress, read from and written to the server
// (/api/courses/F001/lab/*, stored per student in the Google Sheet), so it follows the student across browsers and devices.
//
// The public API is unchanged (summary, examGate, watch, readKey, writeKey), so Overview and the rings are not
// aware where progress lives. Nothing about progress is kept in localStorage any more.
// Reads are synchronous, from `store`, which mirrors the server: load() fills it, ready() (re)fills it, a window focus refreshes it.
// Writes (Study Notes, Activities) update `store` at once and are saved in the background, with retries.
// The Practice Test result and the Final Exam are written by the server only; tests.js hands the server's answer to record*().
const Founders = (() => {
  const COURSE_ID = "F001";
  const CONTENT_BASE = "/content/founders-lab/";
  const LAB_API = `/api/courses/${COURSE_ID}/lab`;
  const FIRST_SESSION_NO = 1;
  const PCT = 100;
  const SAVE_DELAY_MS = 600; // coalesces rapid ticks into one save
  const SAVE_RETRY_MS = 3000;
  const SAVE_TRIES = 3;
  const REFRESH_MIN_MS = 10_000; // how often coming back to the window may re-read the server
  const BROWSER_PARTS = { "study-notes": "notes", activities: "activities" }; // the only parts the browser may write
  const PROGRESS_EVENT = "founders-progress";
  let manifestPromise = null;

  // ---------- the journey (7 stages, ticks, answers): computed by the server, drawn here ----------
  let journeyCache = null;
  // Loads (or returns the cached) journey. `force` re-reads it from the server. Watchers are told whenever it changes.
  async function journey(force = false) {
    if (force || !journeyCache) { journeyCache = await api(`${LAB_API}/journey`); changed(); }
    return journeyCache;
  }
  const journeyNow = () => journeyCache;
  // For writes that return the updated journey (a tick, an answer).
  const setJourney = (j) => { journeyCache = j; changed(); };

  // ---------- the store: a mirror of the server's progress, keyed by each step's storageKey ----------
  const store = new Map(); // storageKey -> value ({id:true,...} for notes, {team,pts,done} for activities, true for practice, the score slip for the exam)
  const examState = new Map(); // sessionId -> "none" | "in_progress" | "submitted"
  const writable = new Map(); // storageKey -> { sessionId, part } for the keys the browser may save
  const pending = new Map(); // storageKey -> { value, tries, timer }
  let loaded = false;
  let lastRefresh = 0;

  const changed = () => dispatchEvent(new Event(PROGRESS_EVENT));
  const readKey = (key) => (store.has(key) ? store.get(key) : null);
  const itemOf = (manifest, sessionId, key) => manifest.sessions.find((s) => s.id === sessionId)?.items.find((i) => i.key === key);

  // Fills the store from the server's answer. A key with an unsaved local change is left alone, so a refresh never undoes it.
  function applyServer(manifest, data) {
    for (const s of manifest.sessions) {
      const sp = data.sessions?.[s.id];
      if (!sp) continue;
      const put = (item, value) => {
        if (!item || pending.has(item.storageKey)) return;
        if (value == null || value === false) store.delete(item.storageKey);
        else store.set(item.storageKey, value);
      };
      put(itemOf(manifest, s.id, "study-notes"), sp.notes);
      put(itemOf(manifest, s.id, "activities"), sp.activities);
      put(itemOf(manifest, s.id, "practice"), sp.practice?.done ? true : null);
      put(itemOf(manifest, s.id, "real-test"), sp.exam?.state === "submitted" ? sp.exam.slip : null);
      examState.set(s.id, sp.exam?.state ?? "none");
    }
  }

  async function refresh() {
    const manifest = await load();
    applyServer(manifest, await api(`${LAB_API}/progress`));
    loaded = true;
    lastRefresh = Date.now();
    changed();
  }

  // For the screens that show progress: resolves once progress is loaded, retrying the server on every call; rejects with a message
  // the router turns into an error box with a Retry button.
  const ready = () => (loaded ? Promise.resolve() : refresh());

  // ---------- saving Study Notes / Activities ----------
  async function flush(key) {
    const p = pending.get(key);
    const target = writable.get(key);
    if (!p || !target) return;
    clearTimeout(p.timer);
    const sent = p.value;
    try {
      await api(`${LAB_API}/progress`, { method: "POST", body: { sessionId: target.sessionId, part: target.part, state: sent } });
      if (pending.get(key)?.value === sent) pending.delete(key);
      else flush(key); // changed again while saving: send the newest
    } catch (err) {
      p.tries += 1;
      if (p.tries < SAVE_TRIES) p.timer = setTimeout(() => flush(key), SAVE_RETRY_MS);
      else { pending.delete(key); toast("We couldn't save your progress. Check your connection and try again."); }
    }
  }

  function writeKey(key, value) {
    store.set(key, value);
    changed();
    if (!writable.has(key)) return;
    const p = pending.get(key) ?? { tries: 0 };
    clearTimeout(p.timer);
    p.value = value;
    p.tries = 0;
    p.timer = setTimeout(() => flush(key), SAVE_DELAY_MS);
    pending.set(key, p);
  }

  // Leaving the page with an unsaved change: send it now (keepalive lets the request outlive the page).
  addEventListener("pagehide", () => {
    for (const [key, p] of pending) {
      const t = writable.get(key);
      if (t) fetch(`${LAB_API}/progress`, { method: "POST", keepalive: true, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: t.sessionId, part: t.part, state: p.value }) }).catch(() => {});
    }
  });

  // ---------- results the server computed (tests.js passes them in; the browser can't write these parts) ----------
  function recordPractice(sessionId) {
    const item = manifestSync()?.sessions.find((s) => s.id === sessionId)?.items.find((i) => i.key === "practice");
    if (item) store.set(item.storageKey, true);
    changed();
  }
  // state: "in_progress" | "submitted" (with the score slip)
  function recordExam(sessionId, state, slip) {
    const item = manifestSync()?.sessions.find((s) => s.id === sessionId)?.items.find((i) => i.key === "real-test");
    examState.set(sessionId, state);
    if (item && slip) store.set(item.storageKey, slip);
    changed();
  }
  let manifestValue = null;
  const manifestSync = () => manifestValue;

  const allTrue = (obj, ids = []) => ids.length > 0 && ids.every((id) => obj?.[id] === true);
  const countTrue = (obj, ids = []) => ids.filter((id) => obj?.[id] === true).length;

  // The pages store different shapes, so "done" is decided per step key.
  function statusOf(item, sessionId) {
    const v = readKey(item.storageKey);
    const started = v != null;
    switch (item.key) {
      // have / need = parts finished out of parts required; the Final Exam's Requirements page and its progress bar read them.
      case "study-notes": return { started, done: allTrue(v, item.requires), have: countTrue(v, item.requires), need: item.requires.length };
      case "activities": return { started, done: allTrue(v?.done, item.requires), have: countTrue(v?.done, item.requires), need: item.requires.length };
      case "practice": return { started, done: v === true, have: v === true ? 1 : 0, need: 1 };
      case "real-test": return { started: started || examState.get(sessionId) === "in_progress", done: !!v, score: v && Number.isFinite(v.score) ? { score: v.score, total: v.n } : null };
      default: return { started, done: false };
    }
  }

  // Old per-browser progress is no longer read or written: drop what earlier versions left in this browser.
  const purgeLegacy = () => { try { Object.keys(localStorage).filter((k) => k.startsWith("fl-")).forEach((k) => localStorage.removeItem(k)); } catch { /* private mode */ } };

  // The manifest only (content/founders-lab/manifest.json). Progress is loaded separately by ready()/refresh().
  function load() {
    return (manifestPromise ??= fetch(`${CONTENT_BASE}manifest.json`, { credentials: "same-origin" })
      .then((r) => { if (!r.ok) throw new Error("Course content is unavailable."); return r.json(); })
      .then((m) => {
        purgeLegacy();
        manifestValue = m;
        for (const s of m.sessions) for (const it of s.items) if (BROWSER_PARTS[it.key]) writable.set(it.storageKey, { sessionId: s.id, part: BROWSER_PARTS[it.key] });
        return m;
      })
      .catch((e) => { manifestPromise = null; throw e; }));
  }

  // First unfinished step; a locked Final Exam is never the target: point at the next unfinished requirement instead.
  const nextItem = (s) => { const it = s.items.find((x) => !x.done); return it?.key === EXAM_KEY && s.gate.locked ? s.gate.nextRequirement : it; };

  // Recomputed from the store on every call (cheap), so callers just re-render on a change event.
  function summary(manifest) {
    const sessions = manifest.sessions.map((s, i) => {
      const items = s.items.map((it) => ({ ...it, ...statusOf(it, s.id) }));
      const doneCount = items.filter((it) => it.done).length;
      return { ...s, no: i + FIRST_SESSION_NO, items, doneCount, total: items.length, gate: examGate({ id: s.id, items }),
        complete: items.length > 0 && doneCount === items.length, started: items.some((it) => it.started) };
    });
    const doneSteps = sessions.reduce((n, s) => n + s.doneCount, 0);
    const totalSteps = sessions.reduce((n, s) => n + s.total, 0);
    const current = sessions.find((s) => !s.complete) ?? null;
    return {
      sessions, doneSteps, totalSteps,
      percent: totalSteps ? Math.round((doneSteps / totalSteps) * PCT) : 0,
      sessionsDone: sessions.filter((s) => s.complete).length, sessionsTotal: sessions.length,
      current, next: current ? { session: current, item: nextItem(current), hint: current.gate.locked ? current.gate.hint : "" } : null,
    };
  }

  // ---------- the Final Exam unlock rule (the browser's copy, for display; the server checks the same rule before it starts an exam) ----------
  // The Final Exam opens when Study Notes, Activities and the Practice Test are all complete (their usual "done" checks above).
  // Whatever the rules say, an existing score slip or an exam in progress stays reachable. `session` is one entry of summary().sessions.
  const EXAM_KEY = "real-test";
  const REQUIREMENT_KEYS = ["study-notes", "activities", "practice"];
  function examGate(session) {
    const reqs = REQUIREMENT_KEYS.map((k) => session.items.find((it) => it.key === k)).filter(Boolean);
    const unlocked = reqs.length === REQUIREMENT_KEYS.length && reqs.every((r) => r.done);
    const exam = session.items.find((it) => it.key === EXAM_KEY);
    const inProgress = examState.get(session.id) === "in_progress";
    const open = unlocked || !!exam?.done || inProgress; // exam.done = a slip exists
    const have = reqs.reduce((n, r) => n + r.have, 0);
    const need = reqs.reduce((n, r) => n + r.need, 0);
    const missing = reqs.filter((r) => !r.done);
    return { unlocked, open, locked: !open, requirements: reqs, missing, have, need, nextRequirement: missing[0] ?? null,
      // "Finish Activities to unlock the Final Exam"
      hint: missing.length ? `Finish ${missing.map((r) => r.label).join(" and ")} to unlock the Final Exam` : "" };
  }

  // Every step lives under Sessions: "#sessions/1/study-notes", "#sessions/1/practice", "#sessions/1/real-test".
  const hash = (manifest, sessionId, key) => `#sessions/${manifest.sessions.findIndex((s) => s.id === sessionId) + FIRST_SESSION_NO}/${key}`;
  const href = (manifest, sessionId, key) => `course.html?id=${COURSE_ID}${hash(manifest, sessionId, key)}`;
  const fileUrl = (item) => `${CONTENT_BASE}${item.file}`;

  // Coming back to this window re-reads the server (another browser may have moved on), at most every REFRESH_MIN_MS.
  addEventListener("focus", () => { if (loaded && Date.now() - lastRefresh > REFRESH_MIN_MS) refresh().catch(() => {}); });

  // Calls back whenever progress changes in this window (a tick, a finished game, a result from the server, a refresh).
  function watch(cb) {
    const on = () => cb();
    addEventListener(PROGRESS_EVENT, on);
    return () => removeEventListener(PROGRESS_EVENT, on);
  }

  // The lab API for one session (practice, exam). `api` redirects to sign-in on 401 and throws an Error with the server's message otherwise.
  const lab = (sessionId, path, opts) => api(`${LAB_API}/${sessionId}/${path}`, opts);

  return { COURSE_ID, journey, journeyNow, setJourney, load, ready, refresh, summary, examGate, hash, href, fileUrl, watch, readKey, writeKey, lab, recordPractice, recordExam };
})();
