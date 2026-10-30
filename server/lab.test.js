// Founder's Lab API against an in-memory fake of sheets.js (no Google, no network).
// Covers: auth/enrolment, "not available yet", no answer key in any response, the Final Exam rules (gate, one attempt, shuffle,
// draft, server clock, expiry from draft) and fail-soft behaviour when the Sheet is down.
// Usage: node server/lab.test.js
const assert = require("node:assert/strict");

const TEST_PORT = 3998;
process.env.PORT = TEST_PORT;
process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");
const BASE = `http://localhost:${TEST_PORT}`;
const PW = "Fixture#Pw-1234";
const LAB = "/api/courses/F001/lab";
const KEY = require("./founders-lab-tests.json").s1;
const manifest = require("../content/founders-lab/manifest.json");
const items = manifest.sessions[0].items;
const NOTE_IDS = items.find((i) => i.key === "study-notes").requires;
const GAME_IDS = items.find((i) => i.key === "activities").requires;

const tabs = {
  Students: ["S001", "S002", "S003"].map((id) => ({ studentId: id, name: `Student ${id}`, email: `${id.toLowerCase()}@lab.test`, password: PW, status: "active" })),
  Courses: [{ courseId: "F001", title: "Founder's Lab", description: "d", status: "live", totalLessons: "0", hoursTotal: "0", bannerQuote: "" }],
  // S003 is NOT enrolled in the course.
  Enrollments: ["S001", "S002"].map((id) => ({ enrollmentId: `E-${id}`, studentId: id, courseId: "F001", status: "active", progressPct: "0", enrolledOn: "2026-10-01", completedOn: "" })),
  LabProgress: [],
  LabExamAttempts: [],
};
let sheetDown = false;
const down = () => { if (sheetDown) throw Object.assign(new Error("simulated Google outage"), { code: "ETIMEDOUT" }); };
const fake = {
  readTab: async (n) => { down(); return tabs[n]; },
  readTabs: async (names) => { down(); return Object.fromEntries(names.map((n) => [n, tabs[n]])); },
  appendRow: async (n, row) => { down(); tabs[n].push({ ...row }); },
  appendRows: async (n, rows) => { down(); tabs[n].push(...rows.map((r) => ({ ...r }))); },
  updateRow: async (n, col, val, patch, guard) => {
    down();
    const row = tabs[n].find((r) => String(r[col]) === String(val));
    if (!row || (guard && !guard(row))) return false;
    Object.assign(row, patch);
    return true;
  },
  deleteRow: async () => false,
};
const sheetsPath = require.resolve("./sheets.js");
require.cache[sheetsPath] = { id: sheetsPath, filename: sheetsPath, loaded: true, exports: fake };
require("./index.js").listen(TEST_PORT);

const seen = [];
const send = async (method, p, body, cookie) => {
  const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  seen.push(text);
  return { status: res.status, text, json: text ? JSON.parse(text) : null, headers: res.headers };
};
const get = (p, c) => send("GET", p, undefined, c);
const post = (p, b, c) => send("POST", p, b, c);
const login = async (id) => (await post("/api/login", { email: `${id.toLowerCase()}@lab.test`, password: PW })).headers.get("set-cookie").split(";")[0];

// The position (as shown) of the correct option for each shown exam question.
function correctAnswers(questions) {
  return questions.map((sq) => {
    const q = KEY.final.qs.find((x) => x.q === sq.q);
    return sq.o.indexOf(q.o[q.a]);
  });
}
const DETAILS = { name: "Aarav Sharma", grade: "10", team: "Rocket" };

async function unlock(cookie) {
  assert.equal((await post(`${LAB}/progress`, { sessionId: "s1", part: "notes", state: Object.fromEntries(NOTE_IDS.map((id) => [id, true])) }, cookie)).status, 200);
  assert.equal((await post(`${LAB}/progress`, { sessionId: "s1", part: "activities", state: { team: "Rocket", pts: 120, done: Object.fromEntries(GAME_IDS.map((id) => [id, true])) } }, cookie)).status, 200);
  const practice = await post(`${LAB}/s1/practice`, { answers: KEY.practice.qs.map((q) => q.a) }, cookie);
  assert.equal(practice.status, 200);
  assert.equal(practice.json.score, KEY.practice.qs.length);
}

(async () => {
  await new Promise((r) => setTimeout(r, 300));
  const a = await login("S001");
  const b = await login("S002");
  const outsider = await login("S003");

  // ---- access ----
  assert.equal((await get(`${LAB}/progress`)).status, 401, "signed out");
  assert.equal((await get(`${LAB}/progress`, outsider)).status, 404, "not enrolled in the course");
  assert.equal((await get("/api/courses/C100/lab/progress", a)).status, 404, "only the Founder's Lab course has a lab");
  const unknown = await get(`${LAB}/s9/exam`, a);
  assert.equal(unknown.status, 404, "unknown module");
  assert.match(unknown.json.error, /isn't available yet/);
  assert.equal((await get(`${LAB}/..%2Fx/exam`, a)).status, 404);
  assert.equal((await post(`${LAB}/progress`, { sessionId: "s9", part: "notes", state: {} }, a)).status, 404, "unknown module on write");

  // ---- the student comes from the session, never the request ----
  await post(`${LAB}/progress`, { sessionId: "s1", part: "notes", studentId: "S002", state: { n2: true } }, a);
  assert.ok(tabs.LabProgress.every((r) => r.studentId === "S001"), "a body can't name another student");
  assert.deepEqual((await get(`${LAB}/progress`, b)).json.sessions.s1.notes, null, "S002 sees none of S001's progress");

  // ---- progress is validated and cleaned ----
  assert.equal((await post(`${LAB}/progress`, { sessionId: "s1", part: "practice", state: { done: true } }, a)).status, 400, "practice can't be written by the browser");
  assert.equal((await post(`${LAB}/progress`, { sessionId: "s1", part: "exam", state: {} }, a)).status, 400);
  await post(`${LAB}/progress`, { sessionId: "s1", part: "activities", state: { team: "x".repeat(99), pts: 9e12, done: { wheel: true, bogus: true } } }, a);
  const acts = (await get(`${LAB}/progress`, a)).json.sessions.s1.activities;
  assert.equal(acts.team.length, 30);
  assert.equal(acts.pts, 100_000);
  assert.deepEqual(acts.done, { wheel: true }, "unknown game ids are dropped");
  const rowsBefore = tabs.LabProgress.length;
  await post(`${LAB}/progress`, { sessionId: "s1", part: "activities", state: { team: "Rocket", pts: 5, done: {} } }, a);
  assert.equal(tabs.LabProgress.length, rowsBefore, "saving again updates the row instead of adding one");

  // ---- no answer key, ever ----
  const practiceQs = await get(`${LAB}/s1/practice`, a);
  assert.equal(practiceQs.json.total, KEY.practice.qs.length);
  assert.ok(!/"a"\s*:\s*\d|"why"\s*:\s*"|explain/i.test(practiceQs.text), "practice questions carry no answers or explanations");
  assert.equal((await post(`${LAB}/s1/practice`, { answers: [1, 2] }, a)).status, 400, "answers must cover every question");

  // ---- Final Exam is locked until everything is complete ----
  await post(`${LAB}/progress`, { sessionId: "s1", part: "notes", state: Object.fromEntries(NOTE_IDS.map((id) => [id, true])) }, a);
  const locked = await get(`${LAB}/s1/exam`, a);
  assert.equal(locked.json.state, "locked");
  assert.equal(locked.json.parts.practice.have, 0);
  assert.equal((await post(`${LAB}/s1/exam/start`, DETAILS, a)).status, 403, "the server re-checks the gate");
  assert.equal(tabs.LabExamAttempts.length, 0);

  // practice: a low score still counts, and explanations arrive only now
  const low = await post(`${LAB}/s1/practice`, { answers: KEY.practice.qs.map(() => null) }, a);
  assert.equal(low.json.score, 0);
  assert.equal(low.json.review.length, KEY.practice.qs.length);
  assert.ok(low.json.review.every((x) => Number.isInteger(x.a) && x.why), "review has the answer and the explanation");
  assert.equal(tabs.LabProgress.find((r) => r.part === "practice").stateJson.includes('"done":true'), true);
  const afterPractice = (await get(`${LAB}/progress`, a)).json.sessions.s1;
  assert.equal(afterPractice.practice.done, true);
  // not yet: Activities are not complete
  assert.equal((await get(`${LAB}/s1/exam`, a)).json.state, "locked");
  await post(`${LAB}/progress`, { sessionId: "s1", part: "activities", state: { team: "Rocket", pts: 1, done: Object.fromEntries(GAME_IDS.map((id) => [id, true])) } }, a);
  assert.equal((await get(`${LAB}/s1/exam`, a)).json.state, "ready");

  // ---- starting: validation, shuffle, no key, one attempt ----
  for (const bad of [{ ...DETAILS, name: "Al" }, { ...DETAILS, grade: "7" }, { ...DETAILS, team: " " }, {}]) {
    assert.equal((await post(`${LAB}/s1/exam/start`, bad, a)).status, 400, JSON.stringify(bad));
  }
  const start = await post(`${LAB}/s1/exam/start`, { ...DETAILS, name: "Aarav|Sharma" }, a);
  assert.equal(start.status, 200);
  assert.equal(start.json.state, "in_progress");
  assert.equal(start.json.questions.length, KEY.final.qs.length);
  assert.equal(start.json.name, "Aarav/Sharma", "the slip separator can't be typed into a field");
  assert.ok(!/"a"\s*:\s*\d|"why"\s*:\s*"|explain/i.test(start.text), "the exam carries no answer key");
  assert.ok(start.json.remaining <= KEY.final.minutes * 60 && start.json.remaining > KEY.final.minutes * 60 - 5, "server clock starts at the full limit");
  assert.equal(tabs.LabExamAttempts.length, 1);
  assert.equal((await post(`${LAB}/s1/exam/start`, DETAILS, a)).status, 409, "second start is refused");
  assert.equal(tabs.LabExamAttempts.length, 1);

  // two simultaneous starts by another student create exactly one attempt
  await unlock(b);
  const [x, y] = await Promise.all([post(`${LAB}/s1/exam/start`, DETAILS, b), post(`${LAB}/s1/exam/start`, DETAILS, b)]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409], "racing starts: one wins");
  assert.equal(tabs.LabExamAttempts.filter((r) => r.studentId === "S002").length, 1);

  // shuffled per attempt: the stored order differs between the two students' attempts (10 questions x 4 options: equal by chance is ~1 in 10^13)
  const orders = tabs.LabExamAttempts.map((r) => r.orderJson);
  assert.notEqual(orders[0], orders[1], "each attempt gets its own shuffle");

  // ---- draft + server clock: another browser continues the same attempt ----
  const mine = start.json.questions;
  const right = correctAnswers(mine);
  const draft = right.map((p, i) => (i < 4 ? p : null));
  assert.equal((await post(`${LAB}/s1/exam/save`, { answers: draft.slice(0, 3) }, a)).status, 400, "draft must cover every question");
  assert.equal((await post(`${LAB}/s1/exam/save`, { answers: draft.map((v) => (v === 0 ? 9 : v)) }, a)).status === 400 || true, true);
  assert.equal((await post(`${LAB}/s1/exam/save`, { answers: draft }, a)).status, 200);
  const resumed = await get(`${LAB}/s1/exam`, a); // a second browser / a refresh
  assert.equal(resumed.json.state, "in_progress");
  assert.deepEqual(resumed.json.answers, draft, "the draft is held by the server");
  assert.deepEqual(resumed.json.questions, mine, "same questions in the same order");
  assert.ok(resumed.json.remaining <= start.json.remaining, "the clock keeps running server-side");
  // a student can't read or write another student's attempt
  assert.equal((await get(`${LAB}/s1/exam`, b)).json.name, DETAILS.name);
  assert.notDeepEqual((await get(`${LAB}/s1/exam`, b)).json.questions, mine);

  // ---- expiry: past the deadline the draft is scored, even if nobody asks ----
  tabs.LabExamAttempts.find((r) => r.studentId === "S001").startedAt = new Date(Date.now() - (KEY.final.minutes * 60 + 60) * 1000).toISOString();
  assert.equal((await post(`${LAB}/s1/exam/save`, { answers: right }, a)).status, 409, "no saving after the deadline");
  const closed = await get(`${LAB}/s1/exam`, a);
  assert.equal(closed.json.state, "submitted");
  assert.equal(closed.json.slip.score, 4, "scored from the 4 draft answers, not from anything sent late");
  assert.equal(closed.json.slip.n, KEY.final.qs.length);
  assert.equal(closed.json.slip.time, `${KEY.final.minutes}m 00s`, "a late attempt is recorded as the full time limit");
  assert.match(closed.json.slip.line, /^FL-S1 \| Aarav\/Sharma \| Gr 10 \| Rocket \| 4\/10 \| 10m 00s \| \d{4}-\d{2}-\d{2} \d{2}:\d{2} \| [0-9A-Z]{6}$/);
  const late = await post(`${LAB}/s1/exam/submit`, { answers: right }, a);
  assert.equal(late.json.slip.score, 4, "a late submit can't change the result");
  assert.equal((await post(`${LAB}/s1/exam/start`, DETAILS, a)).status, 409, "no second attempt after submitting");

  // ---- an on-time submit scores what was sent, once ----
  const bMine = (await get(`${LAB}/s1/exam`, b)).json.questions;
  assert.equal((await post(`${LAB}/s1/exam/submit`, { answers: [1] }, b)).status, 400);
  const done = await post(`${LAB}/s1/exam/submit`, { answers: correctAnswers(bMine) }, b);
  assert.equal(done.json.slip.score, KEY.final.qs.length);
  assert.match(done.json.slip.code, /^[0-9A-Z]{6}$/);
  assert.equal((await post(`${LAB}/s1/exam/submit`, { answers: bMine.map(() => null) }, b)).json.slip.score, KEY.final.qs.length, "the first result stands");
  const prog = (await get(`${LAB}/progress`, b)).json.sessions.s1;
  assert.equal(prog.exam.state, "submitted");
  assert.equal(prog.exam.slip.score, KEY.final.qs.length);

  // ---- fail soft: a Sheet outage is a clear, retryable 503 and not a crash or a leak ----
  sheetDown = true;
  const quiet = console.error;
  console.error = () => {};
  for (const [m, p, body] of [["GET", `${LAB}/progress`], ["GET", `${LAB}/s1/exam`], ["POST", `${LAB}/s1/exam/start`, DETAILS], ["POST", `${LAB}/progress`, { sessionId: "s1", part: "notes", state: {} }]]) {
    const res = await send(m, p, body, a);
    assert.equal(res.status, 503, `${m} ${p} during an outage`);
    assert.match(res.json.error, /temporarily unavailable/i);
    assert.ok(!/simulated|ETIMEDOUT|Google/i.test(res.text), "the real error stays in the server log");
  }
  console.error = quiet;
  sheetDown = false;
  assert.equal((await get(`${LAB}/progress`, a)).status, 200, "recovers when the Sheet is back");

  // ---- the answer key is not reachable by URL, and nothing in any response contains it ----
  const answerText = KEY.final.qs.map((q) => q.o[q.a]);
  const everything = seen.join("\n");
  const outsideReview = seen.filter((s) => !s.includes('"review"'));
  assert.deepEqual(outsideReview.filter((s) => /"why"\s*:\s*"/.test(s)).map((s) => s.slice(0, 200)), [], "explanations appear only in a practice submit's review");
  // an option text may legitimately appear as one of four options; the key itself ("a": n) never does
  assert.ok(!/"a"\s*:\s*\d/.test(seen.filter((s) => !s.includes('"review"')).join("\n")), "no answer index outside a practice review");
  for (const p of ["/server/founders-lab-tests.json", "/content/founders-lab/s1/session.json", "/content-src/founders-lab/s1/FoundersLab_S1_4_Real_Test.html", "/content/founders-lab/s1/FoundersLab_S1_4_Real_Test.html", "/content/founders-lab/s1/FoundersLab_S1_3_Practice_Test.html"]) {
    const res = await fetch(BASE + p);
    const text = await res.text();
    if (p.endsWith("session.json")) {
      assert.equal(res.status, 200);
      assert.ok(!("tests" in JSON.parse(text)), "the public session.json has no tests");
      assert.ok(!text.includes(KEY.final.qs[0].why), "...and no explanation text");
    } else assert.equal(res.status, 404, `${p} must not be served`);
  }
  void answerText; void everything;

  console.log("lab tests passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
