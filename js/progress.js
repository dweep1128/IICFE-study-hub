// Founder's Lab: manifest loader + progress read from what the partner pages already save in localStorage.
//
// INTERIM, front-end only: this is per-browser, not per-student. A later phase must move it to the Google Sheet
// through server/ keyed by student, so progress follows the student across devices. Not built yet on purpose.
const Founders = (() => {
  const COURSE_ID = "F001";
  const CONTENT_BASE = "/content/founders-lab/";
  const FIRST_SESSION_NO = 1;
  const PCT = 100;
  // Which course-sidebar tab shows each step (Resources = notes + activities, Mock Tests = practice, Final Exam = the "real-test" step: the key keeps its old name, students only ever see "Final Exam").
  const STEP_TAB = { "study-notes": "resources", activities: "resources", practice: "mock", "real-test": "final" };
  const SINGLE_STEP_TABS = ["mock", "final"]; // one native page per tab, so the hash is just "#mock" / "#final"
  let manifestPromise = null;

  const readKey = (key) => {
    try { const v = localStorage.getItem(key); return v == null ? null : JSON.parse(v); } catch { return null; }
  };
  // Native views save through this so the step bar, Overview and rings (which read the same keys) refresh in this window too.
  const PROGRESS_EVENT = "founders-progress";
  const writeKey = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: progress lasts for this page only */ }
    dispatchEvent(new Event(PROGRESS_EVENT));
  };
  const allTrue = (obj, ids = []) => ids.length > 0 && ids.every((id) => obj?.[id] === true);
  const countTrue = (obj, ids = []) => ids.filter((id) => obj?.[id] === true).length;

  // The pages store different shapes, so "done" is decided per step key.
  function statusOf(item) {
    const v = readKey(item.storageKey);
    const started = v != null;
    switch (item.key) {
      // have / need = parts finished out of parts required; the Final Exam's Requirements page and its progress bar read them.
      case "study-notes": return { started, done: allTrue(v, item.requires), have: countTrue(v, item.requires), need: item.requires.length };
      case "activities": return { started, done: allTrue(v?.done, item.requires), have: countTrue(v?.done, item.requires), need: item.requires.length };
      case "practice": return { started, done: v === true, have: v === true ? 1 : 0, need: 1 };
      case "real-test": return { started, done: !!v, score: v && Number.isFinite(v.score) ? { score: v.score, total: v.n } : null };
      default: return { started, done: false };
    }
  }

  // The Final Exam's own storage keys: "fl-<session>-real-<what>" ("real" is the old name; the keys must not change).
  const examKey = (sessionId, what) => `fl-${sessionId}-real-${what}`;
  // The old unlock-key flag is no longer used; remove it wherever it is found.
  const purgeLegacy = (manifest) => manifest.sessions.forEach((s) => { try { localStorage.removeItem(examKey(s.id, "keys")); } catch { /* private mode */ } });

  const load = () => (manifestPromise ??= fetch(`${CONTENT_BASE}manifest.json`, { credentials: "same-origin" })
    .then((r) => { if (!r.ok) throw new Error("Course content is unavailable."); return r.json(); })
    .then((m) => { purgeLegacy(m); return m; })
    .catch((e) => { manifestPromise = null; throw e; }));

  // First unfinished step; a locked Final Exam is never the target: point at the next unfinished requirement instead.
  const nextItem = (s) => { const it = s.items.find((x) => !x.done); return it?.key === EXAM_KEY && s.gate.locked ? s.gate.nextRequirement : it; };

  // Recomputed from localStorage every call (cheap), so callers just re-render on a change event.
  function summary(manifest) {
    const sessions = manifest.sessions.map((s, i) => {
      const items = s.items.map((it) => ({ ...it, ...statusOf(it) }));
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

  // ---------- the Final Exam unlock rule (the ONE place it lives) ----------
  // The Final Exam opens when Study Notes, Activities and the Practice Test are all complete (their usual "done" checks above).
  // Whatever the rules say, an existing score slip or an exam in progress stays reachable. `session` is one entry of summary().sessions.
  const EXAM_KEY = "real-test";
  const REQUIREMENT_KEYS = ["study-notes", "activities", "practice"];
  function examGate(session) {
    const reqs = REQUIREMENT_KEYS.map((k) => session.items.find((it) => it.key === k)).filter(Boolean);
    const unlocked = reqs.length === REQUIREMENT_KEYS.length && reqs.every((r) => r.done);
    const exam = session.items.find((it) => it.key === EXAM_KEY);
    const inProgress = !!readKey(examKey(session.id, "prog"))?.order;
    const open = unlocked || !!exam?.done || inProgress; // exam.done = a slip exists
    const have = reqs.reduce((n, r) => n + r.have, 0);
    const need = reqs.reduce((n, r) => n + r.need, 0);
    const missing = reqs.filter((r) => !r.done);
    return { unlocked, open, locked: !open, requirements: reqs, missing, have, need, nextRequirement: missing[0] ?? null,
      // "Finish Activities to unlock the Final Exam"
      hint: missing.length ? `Finish ${missing.map((r) => r.label).join(" and ")} to unlock the Final Exam` : "" };
  }

  // "#resources/study-notes" for the first session, "#resources/s2/study-notes" afterwards.
  const hash = (manifest, sessionId, key) => {
    const tab = STEP_TAB[key] ?? "resources";
    if (SINGLE_STEP_TABS.includes(tab)) return `#${tab}`;
    return `#${tab}/${sessionId === manifest.sessions[0].id ? "" : `${sessionId}/`}${key}`;
  };
  const href = (manifest, sessionId, key) => `course.html?id=${COURSE_ID}${hash(manifest, sessionId, key)}`;
  const fileUrl = (item) => `${CONTENT_BASE}${item.file}`;

  // "storage" covers other tabs and windows, focus covers a missed one; the native views fire PROGRESS_EVENT themselves.
  function watch(cb) {
    const on = () => cb();
    addEventListener("storage", on);
    addEventListener("focus", on);
    addEventListener(PROGRESS_EVENT, on);
    return () => { removeEventListener("storage", on); removeEventListener("focus", on); removeEventListener(PROGRESS_EVENT, on); };
  }

  return { COURSE_ID, STEP_TAB, load, summary, examGate, examKey, hash, href, fileUrl, watch, readKey, writeKey };
})();
