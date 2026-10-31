// Founder's Lab API: per-student progress, the Practice Test and the Final Exam. Mounted under /api/courses/F001/lab by index.js.
// The student is ALWAYS taken from the session (req.user, set by requireLogin), never from the URL or the body.
// Answer keys live in founders-lab-tests.json, which only this file reads: they are never sent to the browser. The Final Exam is
// shuffled here, timed here (the server clock decides) and its draft is saved here, so a refresh or a second browser continues
// the same attempt.
//
// ponytail: Google Sheets has no unique constraint and no transactions. "One attempt per student" is enforced by a per-process
// lock plus a fresh re-read right before the insert. That is exact on one server instance; on several instances (Vercel can run
// more than one) two simultaneous Start taps could both pass the re-read. Fine for this demo. For a real cohort, move
// LabExamAttempts to a database with a unique key on attemptKey and swap it in behind server/sheets.js.
const crypto = require("crypto");
const express = require("express");
const sheets = require("./sheets");
const tests = require("./founders-lab-tests.json");
const manifest = require("../content/founders-lab/manifest.json");
const { buildJourney, ALL_ITEMS } = require("./journey");
const submissions = require("./submissions");
const competitions = require("./competitions");
const sessionsLib = require("./sessions");
const rules = require("../js/profile-rules.js"); // the same file the browser's form uses
const { isId, httpError, parseJson } = require("./util");

const COURSE_ID = manifest.courseId;
const PROGRESS_TAB = "LabProgress";
const ATTEMPTS_TAB = "LabExamAttempts";
const CHECKLIST_TAB = "LabChecklist";
const SUBMISSIONS_TAB = "LabSubmissions";
const COMPETITIONS_TAB = "LabCompetitions";
const ENTRIES_TAB = "LabCompetitionEntries";
const SESSIONS_TAB = "LabSessions";
const PROFILES_TAB = "LabProfiles";
const MAX_SESSION_NO = 1000;
const MAX_TICKS = 200; // a bound on the request, not on the outputs a session may list
const JOURNEY_TABS = [CHECKLIST_TAB, SUBMISSIONS_TAB];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MAX_ID_LENGTH = 400;
const CLIENT_PARTS = ["notes", "activities"]; // practice and the exam are written by this server only
const OPTIONS = 4;
const SECS_PER_MIN = 60;
const MS_PER_S = 1000;
const GRACE_SECONDS = 10; // slack for network delay on the auto-submit at time-up
const MAX_POINTS = 100_000;
const MAX_TEAM_NAME = 30;
const MAX_FLAGS = 40;
const KEY_RE = /^[a-z0-9_-]{1,24}$/i;

const NOT_AVAILABLE = "This module isn't available yet.";
const UNAVAILABLE = "Founder's Lab is temporarily unavailable. Please try again in a moment.";

// ---------- sessions known to the server ----------
const requiredIds = (s, key) => s.items.find((i) => i.key === key)?.requires ?? [];
const SESSIONS = new Map(manifest.sessions.map((s) => [s.id, { id: s.id, noteIds: requiredIds(s, "study-notes"), gameIds: requiredIds(s, "activities"), tests: tests[s.id] ?? null }]));

// ---------- small helpers ----------
const shuffled = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// Runs jobs with the same key one after another (per process; see the ponytail note at the top).
const queues = new Map();
function withLock(key, job) {
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(job);
  queues.set(key, run);
  run.finally(() => { if (queues.get(key) === run) queues.delete(key); }).catch(() => undefined);
  return run;
}

// ---------- progress rows ----------
const todayIST = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
const checkKey = (sid, itemId) => `${sid}|${COURSE_ID}|${itemId}`;
const progressKey = (sid, sessionId, part) => `${sid}|${COURSE_ID}|${sessionId}|${part}`;
const attemptKey = (sid, sessionId) => `${sid}|${COURSE_ID}|${sessionId}`;

function flags(v, allowed) {
  const out = {};
  if (v && typeof v === "object") {
    for (const [k, on] of Object.entries(v).slice(0, MAX_FLAGS)) if (on === true && KEY_RE.test(k) && (!allowed || allowed.includes(k))) out[k] = true;
  }
  return out;
}

// Cleans what the browser sent. Unknown keys are dropped; sizes and ranges are capped. Same shapes the views already save.
function cleanState(part, raw, session) {
  const r = raw && typeof raw === "object" ? raw : {};
  if (part === "notes") return flags(r);
  return {
    team: typeof r.team === "string" ? r.team.trim().slice(0, MAX_TEAM_NAME) : "",
    pts: Number.isFinite(r.pts) ? Math.max(0, Math.min(MAX_POINTS, Math.round(r.pts))) : 0,
    done: flags(r.done, session.gameIds),
  };
}

const stateOf = (t, sid, sessionId, part) => {
  const row = t.LabProgress.find((r) => r.progressKey === progressKey(sid, sessionId, part));
  return row ? parseJson(row.stateJson, null) : null;
};

// Updates the row whose keyColumn is `key`, or adds it. One at a time per key (per process; see the ponytail note at the top).
function upsert(tab, keyColumn, key, values) {
  return withLock(`${tab}|${key}`, async () => {
    if (!(await sheets.updateRow(tab, keyColumn, key, values))) await sheets.appendRow(tab, { [keyColumn]: key, ...values });
  });
}

const saveState = (sid, sessionId, part, state) => upsert(PROGRESS_TAB, "progressKey", progressKey(sid, sessionId, part), {
  studentId: sid, courseId: COURSE_ID, sessionId, part, stateJson: JSON.stringify(state), updatedAt: new Date().toISOString(),
});

// The latest checkpoint submission per journey item (itemId -> submission view).
function proofsOf(t, sid) {
  const mine = t.LabSubmissions.filter((r) => r.studentId === sid && r.uploadType === "checkpoint");
  const out = {};
  for (const row of submissions.latestByItem(mine).values()) out[row.itemId] = submissions.toView(row);
  return out;
}
const journeyOf = (t, sid) => buildJourney(t.LabChecklist.filter((r) => r.studentId === sid), proofsOf(t, sid));

// ---------- the unlock rule (the server's copy: the browser's is only for display) ----------
function gateOf(t, sid, session) {
  const notes = stateOf(t, sid, session.id, "notes") ?? {};
  const acts = stateOf(t, sid, session.id, "activities")?.done ?? {};
  const practice = stateOf(t, sid, session.id, "practice");
  const have = (obj, ids) => ids.filter((id) => obj[id] === true).length;
  const parts = {
    notes: { have: have(notes, session.noteIds), need: session.noteIds.length },
    activities: { have: have(acts, session.gameIds), need: session.gameIds.length },
    practice: { have: practice?.done === true ? 1 : 0, need: 1 },
  };
  return { unlocked: Object.values(parts).every((p) => p.need > 0 && p.have === p.need), parts };
}

// ---------- exam rows ----------
const limitSeconds = (session) => session.tests.final.minutes * SECS_PER_MIN;
const elapsedSeconds = (row) => (Date.now() - Date.parse(row.startedAt)) / MS_PER_S;
const orderOf = (row) => parseJson(row.orderJson, []);
const draftOf = (row, n) => { const d = parseJson(row.draftJson, []); return Array.from({ length: n }, (_, i) => (Number.isInteger(d[i]) ? d[i] : null)); };
const shown = (row, session) => orderOf(row).map(({ qi, o }) => { const q = session.tests.final.qs[qi]; return { q: q.q, o: o.map((oi) => q.o[oi]) }; });
const scoreOf = (row, session, answers) => orderOf(row).reduce((n, { qi, o }, i) => n + (answers[i] != null && o[answers[i]] === session.tests.final.qs[qi].a ? 1 : 0), 0);

function cleanAnswers(raw, length) {
  if (!Array.isArray(raw) || raw.length !== length) throw httpError(400, "Invalid answers.");
  return raw.map((a) => {
    if (a === null) return null;
    if (Number.isInteger(a) && a >= 0 && a < OPTIONS) return a;
    throw httpError(400, "Invalid answers.");
  });
}

const submittedBody = (row, session) => ({ state: "submitted", score: Number(row.score), total: Number(row.total), seconds: Number(row.seconds), minutes: session.tests.final.minutes });
const inProgressBody = (row, session, remaining) => ({
  state: "in_progress", total: Number(row.total), minutes: session.tests.final.minutes,
  questions: shown(row, session), answers: draftOf(row, Number(row.total)), remaining: Math.max(0, remaining),
});

// Closes an attempt exactly once with `answers`. Late = past the deadline: scored from the saved draft, time recorded as the full limit.
async function finalize(sid, session, answers, late) {
  const key = attemptKey(sid, session.id);
  return withLock(key, async () => {
    const row = (await sheets.readTabs([ATTEMPTS_TAB]))[ATTEMPTS_TAB].find((r) => r.attemptKey === key);
    if (!row) throw httpError(409, "This exam has not started.");
    if (row.submittedAt) return row; // another request closed it first: that result stands
    const limit = limitSeconds(session);
    const seconds = late ? limit : Math.min(limit, Math.round(elapsedSeconds(row)));
    const at = late ? new Date(Date.parse(row.startedAt) + limit * MS_PER_S) : new Date();
    const score = scoreOf(row, session, answers);
    const total = Number(row.total);
    const done = { draftJson: JSON.stringify(answers), submittedAt: at.toISOString(), score, seconds };
    await sheets.updateRow(ATTEMPTS_TAB, "attemptKey", key, done);
    return { ...row, ...done };
  });
}

// The authoritative state of this student's exam. Closes an attempt that ran past its deadline.
async function examState(t, sid, session) {
  const row = t.LabExamAttempts.find((r) => r.attemptKey === attemptKey(sid, session.id));
  const total = session.tests.final.qs.length;
  const minutes = session.tests.final.minutes;
  if (!row) {
    const gate = gateOf(t, sid, session);
    return gate.unlocked ? { state: "ready", total, minutes } : { state: "locked", total, minutes, parts: gate.parts };
  }
  if (row.submittedAt) return submittedBody(row, session);
  const secs = elapsedSeconds(row);
  if (secs > limitSeconds(session) + GRACE_SECONDS) return submittedBody(await finalize(sid, session, draftOf(row, Number(row.total)), true), session);
  return inProgressBody(row, session, limitSeconds(session) - secs);
}

// ---------- router ----------
module.exports = function labRouter({ requireLogin }) {
  const r = express.Router({ mergeParams: true });
  r.use(requireLogin);

  // Every lab request: the right course, an enrolled student, and (for per-session routes) a module this server knows.
  async function load(req, tabs) {
    if (req.params.id !== COURSE_ID) throw httpError(404, "Course not found");
    const t = await sheets.readTabs(["Enrollments", ...tabs]);
    if (!t.Enrollments.some((e) => e.studentId === req.user.studentId && e.courseId === COURSE_ID)) throw httpError(404, "Course not found");
    return t;
  }
  const sessionOf = (req) => {
    const s = isId(req.params.sid) ? SESSIONS.get(req.params.sid) : null;
    if (!s?.tests) throw httpError(404, NOT_AVAILABLE);
    return s;
  };
  // Real errors stay in the server log; the browser gets a clear, retryable message.
  const route = (fn) => async (req, res, next) => {
    try { await fn(req, res); } catch (err) {
      if (err.expose) return next(err);
      console.error(`[lab] ${req.method} ${req.originalUrl}:`, err.code ?? "", err.message);
      next(httpError(503, UNAVAILABLE));
    }
  };

  // ----- journey (the 7 stages, ticks and written answers) -----
  r.get("/journey", route(async (req, res) => {
    const t = await load(req, JOURNEY_TABS);
    res.json(journeyOf(t, req.user.studentId));
  }));

  // Body: { itemId, checked } for tick items, { itemId, answer } for written items. Upload items are completed by an approved upload, never here.
  // The stage is never sent or stored: it is derived from the ticks (server/journey.js). Returns the updated journey.
  r.post("/journey/check", route(async (req, res) => {
    const sid = req.user.studentId;
    const { itemId, checked, answer } = req.body ?? {};
    const item = typeof itemId === "string" ? ALL_ITEMS.get(itemId) : undefined;
    if (!item) throw httpError(400, "Invalid request.");
    if (item.kind === "upload") throw httpError(400, "This item is completed by uploading proof.");
    const isText = item.kind === "text";
    if (isText ? typeof answer !== "string" : typeof checked !== "boolean") throw httpError(400, "Invalid request.");
    const text = isText ? answer.trim() : "";
    if (isText && text.length > (item.maxLength ?? 0)) throw httpError(400, `Keep your answer under ${item.maxLength} characters.`);

    const t = await load(req, JOURNEY_TABS);
    // Ticking ahead is refused: items in a locked stage are a preview only. Unticking is always allowed.
    if (isText ? text !== "" : checked === true) {
      const stage = journeyOf(t, sid).stages.find((s) => s.id === item.stageId);
      if (stage.status === "locked") throw httpError(409, "Finish the compulsory items in the earlier stage first.");
    }
    const on = isText ? text !== "" : checked;
    await upsert(CHECKLIST_TAB, "checkKey", checkKey(sid, item.id), {
      studentId: sid, itemId: item.id, checked: on ? "TRUE" : "FALSE", checkedDate: todayIST(), ...(isText && { answer: text }),
    });
    res.json({ ok: true, journey: journeyOf(await load(req, JOURNEY_TABS), sid) });
  }));

  // ----- submissions (a pasted https link for now; see submissions.js) -----
  // Body: { uploadType, itemId, url }. The item, its label and its rules are looked up here, never taken from the browser.
  function resolveItem(t, sid, type, itemId) {
    if (type === "activity") {
      // A session upload slot: the id is "s<no>|<slot name>" and both must exist in a visible session.
      const m = /^s(\d+)\|(.+)$/.exec(itemId);
      const session = m && sessionsLib.buildSessions(t.LabSessions).find((x) => x.no === Number(m[1]) && x.visible);
      if (!session || !session.slots.includes(m[2])) throw httpError(400, "Unknown item.");
      return { label: m[2], sessionNo: session.no };
    }
    if (type === "checkpoint") {
      const item = ALL_ITEMS.get(itemId);
      if (!item || item.kind !== "upload") throw httpError(400, "Unknown item.");
      // Same rule as ticking: a locked stage is a preview only.
      if (journeyOf(t, sid).stages.find((x) => x.id === item.stageId).status === "locked") throw httpError(409, "Finish the compulsory items in the earlier stage first.");
      return { label: item.label };
    }
    throw httpError(400, "Unknown item."); // required documents are added with their page
  }

  r.post("/submissions", route(async (req, res) => {
    const sid = req.user.studentId;
    const { uploadType, itemId, url } = req.body ?? {};
    if (!submissions.UPLOAD_TYPES.includes(uploadType) || typeof itemId !== "string" || itemId.length > MAX_ID_LENGTH) throw httpError(400, "Invalid request.");
    const link = submissions.checkLink(url);
    if (link.error) throw httpError(400, link.error);

    const key = `${sid}|${uploadType}|${itemId}`;
    const submission = await withLock(`submission|${key}`, async () => {
      const t = await load(req, [...JOURNEY_TABS, SESSIONS_TAB]); // fresh read right before the insert
      const item = resolveItem(t, sid, uploadType, itemId);
      const mine = t.LabSubmissions.filter((x) => x.studentId === sid && x.uploadType === uploadType && x.itemId === itemId);
      const latest = [...submissions.latestByItem(mine).values()][0];
      if (latest && submissions.statusOf(latest) === "approved") throw httpError(409, "This item is already approved.");
      const version = (latest ? Number(latest.version) : 0) + 1;
      const row = {
        subId: `${key}|v${version}`, studentId: sid, courseId: COURSE_ID, uploadType, itemId, itemLabel: item.label, sessionNo: item.sessionNo ?? "",
        url: link.url, fileName: submissions.nameFromLink(link.url), version, status: "submitted", reviewNote: "", reviewer: "", submittedAt: new Date().toISOString(), reviewedAt: "",
      };
      await sheets.appendRow(SUBMISSIONS_TAB, row);
      return submissions.toView(row);
    });
    res.json({ ok: true, submission, journey: journeyOf(await load(req, JOURNEY_TABS), sid) });
  }));

  // ----- sessions (the timeline and each session's page) -----
  const sessionFor = (t, no) => sessionsLib.buildSessions(t.LabSessions).find((x) => x.no === no);
  const sessionNo = (req) => { const n = Number(req.params.no); return Number.isInteger(n) && n > 0 && n < MAX_SESSION_NO ? n : 0; };
  const SESSION_TABS = [SESSIONS_TAB, PROGRESS_TAB, ATTEMPTS_TAB, SUBMISSIONS_TAB];
  // Everything one student has done in one session, read from rows already loaded.
  function sessionState(t, sid, s) {
    const nativeSession = SESSIONS.get(sessionsLib.idOf(s.no));
    const native = nativeSession?.tests ? nativeSession : null;
    const mine = t.LabSubmissions.filter((x) => x.studentId === sid && x.uploadType === "activity" && String(x.sessionNo) === String(s.no));
    const latest = submissions.latestByItem(mine);
    const subs = {};
    for (const slot of s.slots) { const row = latest.get(`activity:s${s.no}|${slot}`); if (row) subs[slot] = submissions.toView(row); }
    const exam = native && t.LabExamAttempts.find((a) => a.attemptKey === attemptKey(sid, native.id));
    const quiz = stateOf(t, sid, sessionsLib.idOf(s.no), "quiz");
    const ticked = stateOf(t, sid, sessionsLib.idOf(s.no), "ticks")?.ticked ?? [];
    const videoWatched = stateOf(t, sid, sessionsLib.idOf(s.no), "video")?.watched === true;
    const uploadCount = s.slots.filter((slot) => subs[slot] && submissions.counts(subs[slot])).length;
    const steps = sessionsLib.stepsOf(s, { ticked, native: !!native, examDone: !!exam?.submittedAt, quizAttempts: quiz?.attempts ?? 0, uploadCount, videoWatched });
    return { native, subs, ticked, quiz, steps, exam, videoWatched };
  }

  function sessionCards(t, sid) {
    return sessionsLib.buildSessions(t.LabSessions).map((s) => {
      if (!s.visible) return { no: s.no, name: s.name, visible: false };
      const st = sessionState(t, sid, s);
      const gate = st.native ? gateOf(t, sid, st.native) : null;
      return {
        no: s.no, name: s.name, visible: true, phase: s.phase, date: s.date, time: s.time, duration: s.duration, description: sessionsLib.describe(s.activities), steps: st.steps,
        lab: gate && { notes: gate.parts.notes, games: gate.parts.activities, practice: gate.parts.practice.have === 1, exam: st.exam?.submittedAt ? "submitted" : st.exam ? "in_progress" : "none" },
      };
    });
  }

  r.get("/sessions", route(async (req, res) => {
    const t = await load(req, SESSION_TABS);
    res.json({ sessions: sessionCards(t, req.user.studentId), next: sessionsLib.nextSession(sessionsLib.buildSessions(t.LabSessions), todayIST()) });
  }));

  // A locked or unknown session is a 404, so its content is never sent.
  r.get("/sessions/:no", route(async (req, res) => {
    const no = sessionNo(req);
    const t = await load(req, SESSION_TABS);
    const s = no ? sessionFor(t, no) : null;
    if (!s?.visible) throw httpError(404, NOT_AVAILABLE);
    const st = sessionState(t, req.user.studentId, s);
    res.json({
      no: s.no, sessionId: sessionsLib.idOf(s.no), native: !!st.native, name: s.name, phase: s.phase, date: s.date, time: s.time, duration: s.duration, readingUrl: s.readingUrl,
      activities: s.activities, instructions: s.instructions, outputs: s.outputs, recap: s.recap, takeaways: s.takeaways, uploadSlots: s.slots,
      video: s.video, videoWatched: st.videoWatched,
      quiz: s.quiz.map(({ q, options }) => ({ q, options })), ticked: st.ticked, submissions: st.subs, steps: st.steps,
      quizResult: st.quiz ? { bestScore: st.quiz.best, attempts: st.quiz.attempts } : null, hasPitchTimer: sessionsLib.PITCH_TIMER_SEED.test(s.instructions),
    });
  }));

  // Body: { ticked: [output index, ...] }
  r.post("/sessions/:no/ticks", route(async (req, res) => {
    const no = sessionNo(req);
    const t = await load(req, [SESSIONS_TAB]);
    const s = no ? sessionFor(t, no) : null;
    if (!s?.visible) throw httpError(404, NOT_AVAILABLE);
    const raw = req.body?.ticked;
    if (!Array.isArray(raw) || raw.length > MAX_TICKS || !raw.every((n) => Number.isInteger(n) && n >= 0 && n < s.outputs.length)) throw httpError(400, "Invalid request.");
    const ticked = [...new Set(raw)].sort((a, b) => a - b);
    await saveState(req.user.studentId, sessionsLib.idOf(no), "ticks", { ticked });
    res.json({ ok: true, ticked });
  }));

  // Body: { watched: boolean }. Only a session that has a video can be marked. This is progress only: it is not part of the Final Exam gate.
  r.post("/sessions/:no/video", route(async (req, res) => {
    const no = sessionNo(req);
    const t = await load(req, [SESSIONS_TAB]);
    const s = no ? sessionFor(t, no) : null;
    if (!s?.visible || !s.video) throw httpError(404, NOT_AVAILABLE);
    if (typeof req.body?.watched !== "boolean") throw httpError(400, "Invalid request.");
    await saveState(req.user.studentId, sessionsLib.idOf(no), "video", { watched: req.body.watched });
    res.json({ ok: true, watched: req.body.watched });
  }));

  // Body: { answers: [option index or -1, ...] }. The answer key lives in the Sheet row and only leaves with the graded result.
  r.post("/sessions/:no/quiz", route(async (req, res) => {
    const no = sessionNo(req);
    const sid = req.user.studentId;
    const t = await load(req, [SESSIONS_TAB, PROGRESS_TAB]);
    const s = no ? sessionFor(t, no) : null;
    if (!s?.visible || !s.quiz.length) throw httpError(404, NOT_AVAILABLE);
    const graded = sessionsLib.gradeQuiz(s.quiz, req.body?.answers);
    if (!graded) throw httpError(400, "Invalid answers.");
    const prev = stateOf(t, sid, sessionsLib.idOf(no), "quiz");
    const state = { best: Math.max(prev?.best ?? 0, graded.score), attempts: (prev?.attempts ?? 0) + 1 };
    await saveState(sid, sessionsLib.idOf(no), "quiz", state);
    res.json({ grade: { ...graded, bestScore: state.best, attempts: state.attempts } });
  }));

  // ----- the startup profile (every field optional; a blank profile is fine) -----
  const profileKey = (sid) => `${sid}|${COURSE_ID}`;
  const profileOf = (t, sid) => {
    const row = t.LabProfiles.find((x) => x.profileKey === profileKey(sid));
    return row ? rules.toProfile({ ...row, team: parseJson(row.teamJson, []) }) : null;
  };
  const profileBody = (p) => ({ profile: p, completion: rules.completion(p) });
  const saveProfile = async (sid, p) => {
    await upsert(PROFILES_TAB, "profileKey", profileKey(sid), {
      studentId: sid, courseId: COURSE_ID, ...Object.fromEntries(rules.FIELDS.map((f) => [f, p[f]])),
      teamJson: JSON.stringify(p.team), completionPct: String(rules.completion(p)), updatedAt: new Date().toISOString(),
    });
    return p;
  };

  r.get("/profile", route(async (req, res) => {
    const t = await load(req, [PROFILES_TAB]);
    res.json(profileBody(profileOf(t, req.user.studentId)));
  }));

  // Body: the profile's fields. A part-filled profile saves; only too-long or malformed values are refused.
  r.post("/profile", route(async (req, res) => {
    const sid = req.user.studentId;
    const next = rules.toProfile(req.body);
    const errors = rules.validate(next, typeof req.body?.stage === "string" ? req.body.stage.trim() : "");
    if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], errors });
    await load(req, []);
    res.json({ ok: true, ...profileBody(await saveProfile(sid, next)) });
  }));

  // ----- competitions -----
  const competitionsFor = (t, sid) => competitions.listFor(t.LabCompetitions, t.LabCompetitionEntries.filter((e) => e.studentId === sid), todayIST());

  r.get("/competitions", route(async (req, res) => {
    const t = await load(req, [COMPETITIONS_TAB, ENTRIES_TAB]);
    res.json({ competitions: competitionsFor(t, req.user.studentId) });
  }));

  // Body: { compId, status?, saved? }
  r.post("/competitions", route(async (req, res) => {
    const sid = req.user.studentId;
    const { compId, status, saved } = req.body ?? {};
    if (typeof compId !== "string") throw httpError(400, "Invalid request.");
    if (status !== undefined && !competitions.STATUSES.includes(status)) throw httpError(400, "Invalid status.");
    if (saved !== undefined && typeof saved !== "boolean") throw httpError(400, "Invalid request.");
    if (status === undefined && saved === undefined) throw httpError(400, "Nothing to update.");
    const t = await load(req, [COMPETITIONS_TAB, ENTRIES_TAB]);
    if (!competitionsFor(t, sid).some((c) => c.id === compId)) throw httpError(404, "Competition not found.");
    await upsert(ENTRIES_TAB, "entryKey", `${sid}|${compId}`, {
      studentId: sid, compId, updatedAt: todayIST(), ...(status && { status }), ...(saved !== undefined && { saved: saved ? "TRUE" : "FALSE" }),
    });
    res.json({ ok: true, competitions: competitionsFor(await load(req, [COMPETITIONS_TAB, ENTRIES_TAB]), sid) });
  }));

  // ----- progress -----
  r.get("/progress", route(async (req, res) => {
    const sid = req.user.studentId;
    const t = await load(req, [PROGRESS_TAB, ATTEMPTS_TAB]);
    const sessions = {};
    for (const s of SESSIONS.values()) {
      const row = t.LabExamAttempts.find((a) => a.attemptKey === attemptKey(sid, s.id));
      const practice = stateOf(t, sid, s.id, "practice");
      sessions[s.id] = {
        notes: stateOf(t, sid, s.id, "notes"),
        activities: stateOf(t, sid, s.id, "activities"),
        practice: practice?.done ? { done: true, score: practice.score ?? null, total: practice.total ?? null } : null,
        exam: row?.submittedAt ? { state: "submitted", score: Number(row.score), total: Number(row.total), seconds: Number(row.seconds) } : row ? { state: "in_progress" } : { state: "none" },
      };
    }
    res.json({ sessions });
  }));

  r.post("/progress", route(async (req, res) => {
    const { sessionId, part, state } = req.body ?? {};
    const session = isId(sessionId) ? SESSIONS.get(sessionId) : null;
    if (!session) throw httpError(404, NOT_AVAILABLE);
    if (!CLIENT_PARTS.includes(part)) throw httpError(400, "Invalid request.");
    await load(req, []);
    await saveState(req.user.studentId, session.id, part, cleanState(part, state, session));
    res.json({ ok: true });
  }));

  // ----- Practice Test -----
  // Questions go out WITHOUT answers or explanations; those come back only from the submit below.
  r.get("/:sid/practice", route(async (req, res) => {
    const session = sessionOf(req);
    await load(req, []);
    const { qs } = session.tests.practice;
    res.json({ total: qs.length, questions: qs.map((q) => ({ q: q.q, o: q.o })) });
  }));

  // Body: { answers: [option index | null, ...] } in the questions' original order.
  r.post("/:sid/practice", route(async (req, res) => {
    const session = sessionOf(req);
    const { qs } = session.tests.practice;
    const answers = cleanAnswers(req.body?.answers, qs.length);
    await load(req, []);
    const score = qs.reduce((n, q, i) => n + (answers[i] === q.a ? 1 : 0), 0);
    const sid = req.user.studentId;
    const prev = stateOf(await sheets.readTabs([PROGRESS_TAB]), sid, session.id, "practice");
    // A low score still counts as done; best score and attempts are kept for the analysis.
    await saveState(sid, session.id, "practice", {
      done: true, score, total: qs.length, best: Math.max(prev?.best ?? 0, score), attempts: (prev?.attempts ?? 0) + 1,
    });
    res.json({ score, total: qs.length, review: qs.map((q) => ({ a: q.a, why: q.why })) });
  }));

  // ----- Final Exam -----
  r.get("/:sid/exam", route(async (req, res) => {
    const session = sessionOf(req);
    const t = await load(req, [PROGRESS_TAB, ATTEMPTS_TAB]);
    res.json(await examState(t, req.user.studentId, session));
  }));

  // No body. One attempt per student: a second start is refused whatever the state of the first.
  r.post("/:sid/exam/start", route(async (req, res) => {
    const session = sessionOf(req);
    const sid = req.user.studentId;
    const key = attemptKey(sid, session.id);
    const body = await withLock(key, async () => {
      const t = await load(req, [PROGRESS_TAB, ATTEMPTS_TAB]); // fresh read right before the insert
      if (t.LabExamAttempts.some((a) => a.attemptKey === key)) throw httpError(409, "You have already taken or started this exam. It can only be taken once.");
      if (!gateOf(t, sid, session).unlocked) throw httpError(403, "Finish Study Notes, Activities and the Practice Test first.");
      const qs = session.tests.final.qs;
      const order = shuffled(qs.map((_, i) => i)).map((qi) => ({ qi, o: shuffled([0, 1, 2, 3]) }));
      const row = {
        attemptKey: key, studentId: sid, courseId: COURSE_ID, sessionId: session.id, name: req.user.name, startedAt: new Date().toISOString(),
        orderJson: JSON.stringify(order), draftJson: JSON.stringify(order.map(() => null)), submittedAt: "", score: "", total: order.length, seconds: "",
      };
      await sheets.appendRow(ATTEMPTS_TAB, row);
      return inProgressBody(row, session, limitSeconds(session));
    });
    res.json(body);
  }));

  // Body: { answers: [position | null, ...] } as shown. Keeps the draft so a refresh or another browser resumes with it.
  r.post("/:sid/exam/save", route(async (req, res) => {
    const session = sessionOf(req);
    const sid = req.user.studentId;
    const answers = cleanAnswers(req.body?.answers, session.tests.final.qs.length);
    await load(req, []);
    const open = (row) => !row.submittedAt && elapsedSeconds(row) <= limitSeconds(session) + GRACE_SECONDS;
    const saved = await sheets.updateRow(ATTEMPTS_TAB, "attemptKey", attemptKey(sid, session.id), { draftJson: JSON.stringify(answers) }, open);
    if (!saved) throw httpError(409, "This exam is closed.");
    res.json({ ok: true });
  }));

  // Body: { answers }. Within the limit plus grace the answers sent are scored; later, only the saved draft counts.
  r.post("/:sid/exam/submit", route(async (req, res) => {
    const session = sessionOf(req);
    const sid = req.user.studentId;
    const t = await load(req, [ATTEMPTS_TAB]);
    const row = t.LabExamAttempts.find((a) => a.attemptKey === attemptKey(sid, session.id));
    if (!row) throw httpError(409, "This exam has not started.");
    if (row.submittedAt) return res.json(submittedBody(row, session));
    const n = Number(row.total);
    const late = elapsedSeconds(row) > limitSeconds(session) + GRACE_SECONDS;
    const answers = late ? draftOf(row, n) : cleanAnswers(req.body?.answers, n);
    res.json(submittedBody(await finalize(sid, session, answers, late), session));
  }));

  return r;
};
module.exports.COURSE_ID = COURSE_ID;
