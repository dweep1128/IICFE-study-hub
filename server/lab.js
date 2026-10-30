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
const { isId, httpError, parseJson } = require("./util");

const COURSE_ID = manifest.courseId;
const PROGRESS_TAB = "LabProgress";
const ATTEMPTS_TAB = "LabExamAttempts";
const CLIENT_PARTS = ["notes", "activities"]; // practice and the exam are written by this server only
const OPTIONS = 4;
const SECS_PER_MIN = 60;
const MS_PER_S = 1000;
const GRACE_SECONDS = 10; // slack for network delay on the auto-submit at time-up
const MIN_NAME_CHARS = 3;
const NAME_MAX = 40;
const TEAM_MAX = 30;
const GRADES = ["9", "10", "11"];
const MAX_POINTS = 100_000;
const MAX_TEAM_NAME = 30;
const MAX_FLAGS = 40;
const KEY_RE = /^[a-z0-9_-]{1,24}$/i;
// Slip times are shown in the school's time zone (MSBSS, Jaipur), whichever region the server runs in.
const SLIP_TIME_ZONE = "Asia/Kolkata";
// Same salt and hashing as the partner pages, so score slips issued earlier still verify on the Mentor desk.
const SLIP_SALT = "FoundersLab|MSBSS|GCEC|2026";

const NOT_AVAILABLE = "This module isn't available yet.";
const UNAVAILABLE = "Founder's Lab is temporarily unavailable. Please try again in a moment.";

// ---------- sessions known to the server ----------
const requiredIds = (s, key) => s.items.find((i) => i.key === key)?.requires ?? [];
const SESSIONS = new Map(manifest.sessions.map((s) => [s.id, { id: s.id, noteIds: requiredIds(s, "study-notes"), gameIds: requiredIds(s, "activities"), tests: tests[s.id] ?? null }]));

// ---------- small helpers ----------
const pad2 = (n) => String(n).padStart(2, "0");
const taken = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / SECS_PER_MIN)}m ${pad2(s % SECS_PER_MIN)}s`; };
function stamp(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: SLIP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const code6 = (s) => { const h = fnv(s) ^ fnv(s.split("").reverse().join("") + "#"); return ("000000" + (h >>> 0).toString(36).toUpperCase()).slice(-6); };
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

async function saveState(sid, sessionId, part, state) {
  const key = progressKey(sid, sessionId, part);
  const values = { studentId: sid, courseId: COURSE_ID, sessionId, part, stateJson: JSON.stringify(state), updatedAt: new Date().toISOString() };
  await withLock(key, async () => {
    if (!(await sheets.updateRow(PROGRESS_TAB, "progressKey", key, values))) await sheets.appendRow(PROGRESS_TAB, { progressKey: key, ...values });
  });
}

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

const submittedBody = (row, session) => ({ state: "submitted", slip: slipOf(row), total: Number(row.total), minutes: session.tests.final.minutes });
const slipOf = (row) => ({ line: row.slipLine, score: Number(row.score), n: Number(row.total), name: row.name, grade: row.grade, team: row.team, time: taken(Number(row.seconds)), ts: row.slipTs, code: row.slipCode });
const inProgressBody = (row, session, remaining) => ({
  state: "in_progress", name: row.name, grade: row.grade, team: row.team, total: Number(row.total), minutes: session.tests.final.minutes,
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
    const parts = [`FL-${session.id.toUpperCase()}`, row.name, `Gr ${row.grade}`, row.team, `${score}/${total}`, taken(seconds), stamp(at)];
    const code = code6(`${parts.join("|")}|${SLIP_SALT}`);
    const done = { draftJson: JSON.stringify(answers), submittedAt: at.toISOString(), score, seconds, slipLine: [...parts, code].join(" | "), slipCode: code, slipTs: parts[6] };
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
        exam: row?.submittedAt ? { state: "submitted", slip: slipOf(row) } : row ? { state: "in_progress" } : { state: "none" },
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

  // Body: { name, grade, team }. One attempt per student: a second start is refused whatever the state of the first.
  r.post("/:sid/exam/start", route(async (req, res) => {
    const session = sessionOf(req);
    const sid = req.user.studentId;
    const clean = (v, max) => String(v ?? "").trim().replace(/\|/g, "/").slice(0, max); // "|" separates the slip fields
    const name = clean(req.body?.name, NAME_MAX);
    const grade = String(req.body?.grade ?? "");
    const team = clean(req.body?.team, TEAM_MAX);
    if (name.length < MIN_NAME_CHARS || !GRADES.includes(grade) || !team) throw httpError(400, "Please fill in your full name, grade and team.");

    const key = attemptKey(sid, session.id);
    const body = await withLock(key, async () => {
      const t = await load(req, [PROGRESS_TAB, ATTEMPTS_TAB]); // fresh read right before the insert
      if (t.LabExamAttempts.some((a) => a.attemptKey === key)) throw httpError(409, "You have already taken or started this exam. It can only be taken once.");
      if (!gateOf(t, sid, session).unlocked) throw httpError(403, "Finish Study Notes, Activities and the Practice Test first.");
      const qs = session.tests.final.qs;
      const order = shuffled(qs.map((_, i) => i)).map((qi) => ({ qi, o: shuffled([0, 1, 2, 3]) }));
      const row = {
        attemptKey: key, studentId: sid, courseId: COURSE_ID, sessionId: session.id, name, grade, team, startedAt: new Date().toISOString(),
        orderJson: JSON.stringify(order), draftJson: JSON.stringify(order.map(() => null)), submittedAt: "", score: "", total: order.length, seconds: "", slipLine: "", slipCode: "", slipTs: "",
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
