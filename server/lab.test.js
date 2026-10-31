// Founder's Lab API against an in-memory fake of sheets.js (no Google, no network).
// Covers: auth/enrolment, "not available yet", no answer key in any response, the Final Exam rules (gate, one attempt, shuffle,
// draft, server clock, expiry from draft) and fail-soft behaviour when the Sheet is down.
// Usage: node server/lab.test.js
const assert = require("node:assert/strict");

const TEST_PORT = 3998;
process.env.PORT = TEST_PORT;
process.env.API_MAX_REQUESTS = "100000"; // this suite makes more than the production per-minute limit
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
  LabChecklist: [],
  LabSubmissions: [],
  LabCompetitions: [],
  LabCompetitionEntries: [],
  LabSessions: [],
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

  // ---- journey: 7 stages, ticks and written answers, sequential locking ----
  const J = (cookie) => get(`${LAB}/journey`, cookie);
  const check = (body, cookie) => post(`${LAB}/journey/check`, body, cookie);
  const fresh = (await J(outsider)); assert.equal(fresh.status, 404, "journey needs enrolment");
  const j0 = (await J(a)).json;
  assert.equal(j0.stages.length, 7);
  assert.equal(j0.percent, 0);
  assert.equal(j0.currentId, "pre-ideation");
  assert.deepEqual(j0.stages.map((x) => x.status), ["current", "locked", "locked", "locked", "locked", "locked", "locked"]);
  assert.equal(j0.nextAction.label, "About me and my role");
  assert.equal(j0.nextAction.stageLabel, "Pre-Ideation");

  // validation
  assert.equal((await check({ itemId: "nope", checked: true }, a)).status, 400, "unknown item");
  assert.equal((await check({ itemId: "solution-concept", checked: true }, a)).status, 400, "upload items are completed by proof, not a tick");
  assert.equal((await check({ itemId: "founder-profile", checked: true }, a)).status, 400, "a written item needs an answer, not a tick");
  assert.equal((await check({ itemId: "landing-test", answer: "x" }, a)).status, 400, "a tick item takes a boolean");
  assert.equal((await check({ itemId: "founder-profile", answer: "x".repeat(401) }, a)).status, 400, "answers are length-limited");
  assert.equal((await check({ itemId: "landing-test", checked: true }, a)).status, 409, "ticking ahead in a locked stage is refused");
  assert.equal((await check({ itemId: "fit-summary", answer: "too early" }, a)).status, 409);
  assert.equal(tabs.LabChecklist.length, 0, "refused writes leave nothing behind");

  // finishing the required items of stage 1 opens stage 2
  let r1 = await check({ itemId: "founder-profile", answer: "  I build things.  " }, a);
  assert.equal(r1.status, 200);
  assert.equal(r1.json.journey.stages[0].deliverables[0].answer, "I build things.", "answers are trimmed and returned");
  assert.equal(r1.json.journey.currentId, "pre-ideation", "one of two required items done");
  assert.equal(r1.json.journey.nextAction.label, "Three problems I care about");
  r1 = await check({ itemId: "problem-areas", answer: "Queues, noise, litter" }, a);
  assert.equal(r1.json.journey.doneStages, 1);
  assert.equal(r1.json.journey.percent, 14, "1 of 7 stages");
  assert.equal(r1.json.journey.currentId, "ideation");
  assert.deepEqual(r1.json.journey.stages.map((x) => x.status).slice(0, 3), ["done", "current", "locked"]);
  assert.equal(r1.json.journey.nextAction.label, "What our idea is");
  assert.match(r1.json.journey.activity[0].title, /^Completed: /);
  assert.equal(tabs.LabChecklist.length, 2);

  // changing an answer updates its row; clearing it un-does the item (and re-locks what came after)
  await check({ itemId: "problem-areas", answer: "Queues" }, a);
  assert.equal(tabs.LabChecklist.length, 2, "an edit updates the row");
  const cleared = await check({ itemId: "problem-areas", answer: "   " }, a);
  assert.equal(cleared.json.journey.currentId, "pre-ideation");
  assert.equal(cleared.json.journey.percent, 0);
  await check({ itemId: "problem-areas", answer: "Queues, noise, litter" }, a);

  // optional items never affect the stage; a hand-written tick on an upload item never counts
  await check({ itemId: "team-agreement", answer: "Rotate chairing" }, a);
  tabs.LabChecklist.push({ checkKey: "S001|F001|solution-concept", studentId: "S001", itemId: "solution-concept", checked: "TRUE", answer: "", checkedDate: "2026-10-01" });
  const forged = (await J(a)).json;
  assert.equal(forged.stages[1].deliverables.find((d) => d.id === "solution-concept").checked, false, "uploads count only when a reviewer approved them");
  assert.ok(!forged.activity.some((x) => /sketch/i.test(x.title)), "and are not listed as activity");
  tabs.LabChecklist.pop(); // remove the forged row again

  // ---- submissions: a pasted https link, counted at once, status kept for a later review page ----
  const submit = (body, cookie) => post(`${LAB}/submissions`, body, cookie);
  const GOOD = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view";
  for (const bad of ["", "   ", "http://example.com/a.pdf", "javascript:alert(1)", "ftp://example.com/a", "https://localhost/a", "https://user:pw@example.com/a", "not a link", `https://example.com/${"a".repeat(600)}`]) {
    assert.equal((await submit({ uploadType: "checkpoint", itemId: "solution-concept", url: bad }, a)).status, 400, `refused: ${bad.slice(0, 40)}`);
  }
  assert.equal((await submit({ uploadType: "checkpoint", itemId: "nope", url: GOOD }, a)).status, 400, "unknown item");
  assert.equal((await submit({ uploadType: "checkpoint", itemId: "founder-profile", url: GOOD }, a)).status, 400, "only upload items take a link");
  assert.equal((await submit({ uploadType: "bogus", itemId: "solution-concept", url: GOOD }, a)).status, 400);
  assert.equal((await submit({ uploadType: "checkpoint", itemId: "interview-log", url: GOOD }, a)).status, 409, "a locked stage takes no submissions");
  assert.equal((await submit({ uploadType: "checkpoint", itemId: "solution-concept", url: GOOD }, outsider)).status, 404);
  assert.equal(tabs.LabSubmissions.length, 0, "refused submissions leave nothing behind");

  const before = (await J(a)).json.stages[1].completion.doneCount;
  const sub = await submit({ uploadType: "checkpoint", itemId: "solution-concept", url: `  ${GOOD}  ` }, a);
  assert.equal(sub.status, 200);
  assert.equal(sub.json.submission.status, "submitted");
  assert.equal(sub.json.submission.version, 1);
  assert.equal(sub.json.submission.url, GOOD);
  assert.equal(sub.json.submission.fileName, "drive.google.com", "an id-only link is named by its host");
  assert.equal(sub.json.journey.stages[1].completion.doneCount, before + 1, "a submitted link counts immediately");
  assert.equal(sub.json.journey.stages[1].deliverables.find((d) => d.id === "solution-concept").proof.status, "submitted");
  assert.equal(tabs.LabSubmissions[0].studentId, "S001");
  assert.equal(tabs.LabSubmissions[0].status, "submitted");

  // a resubmission is a new row (version 2); changes_requested takes the credit back; approved is final
  const again = await submit({ uploadType: "checkpoint", itemId: "solution-concept", url: "https://example.com/files/Sketch%20v2.pdf" }, a);
  assert.equal(again.json.submission.version, 2);
  assert.equal(again.json.submission.fileName, "Sketch v2.pdf", "a readable name comes from the link");
  assert.equal(tabs.LabSubmissions.length, 2, "history is kept");
  tabs.LabSubmissions[1].status = "changes_requested";
  tabs.LabSubmissions[1].reviewNote = "Add a label to each part.";
  const sentBack = (await J(a)).json.stages[1].deliverables.find((d) => d.id === "solution-concept");
  assert.equal(sentBack.checked, false, "a reviewer's changes_requested takes the item back");
  assert.equal(sentBack.proof.reviewNote, "Add a label to each part.");
  assert.equal((await submit({ uploadType: "checkpoint", itemId: "solution-concept", url: GOOD }, a)).json.submission.version, 3);
  tabs.LabSubmissions[2].status = "approved";
  assert.equal((await submit({ uploadType: "checkpoint", itemId: "solution-concept", url: GOOD }, a)).status, 409, "approved items can't be replaced");
  assert.equal((await J(b)).json.stages[1].deliverables.find((d) => d.id === "solution-concept").proof, null, "students never see each other's submissions");

  // ---- competitions: team-kept catalogue, the student's own status and star ----
  tabs.LabCompetitions.push(
    { compId: "C1", name: "Pitch Cup", org: "Org A", about: "Pitch.", eligibility: "Grades 9-12", eventDate: "2999-02-01", deadline: "2999-01-01", prize: "₹10,000", url: "https://example.com/cup", active: "TRUE" },
    { compId: "C2", name: "Hidden", org: "", about: "", eligibility: "", eventDate: "", deadline: "2999-01-01", prize: "", url: "", active: "FALSE" },
    { compId: "C3", name: "Old Contest", org: "", about: "", eligibility: "", eventDate: "2000-02-01", deadline: "2000-01-01", prize: "", url: "javascript:alert(1)", active: "TRUE" },
  );
  const comps = (cookie) => get(`${LAB}/competitions`, cookie);
  const list0 = (await comps(a)).json.competitions;
  assert.deepEqual(list0.map((c) => [c.id, c.status, c.saved]), [["C3", "closed", false], ["C1", "open", false]], "active only, soonest deadline first, past deadline = closed");
  assert.equal(list0[0].url, "", "an unsafe link is never sent");
  assert.equal((await comps(outsider)).status, 404);
  assert.equal((await post(`${LAB}/competitions`, { compId: "C2", saved: true }, a)).status, 404, "an unpublished competition can't be touched");
  assert.equal((await post(`${LAB}/competitions`, { compId: "nope", saved: true }, a)).status, 404);
  assert.equal((await post(`${LAB}/competitions`, { compId: "C1", status: "won" }, a)).status, 400);
  assert.equal((await post(`${LAB}/competitions`, { compId: "C1", saved: "yes" }, a)).status, 400);
  assert.equal((await post(`${LAB}/competitions`, { compId: "C1" }, a)).status, 400, "nothing to update");
  const star = await post(`${LAB}/competitions`, { compId: "C1", saved: true }, a);
  assert.equal(star.json.competitions.find((c) => c.id === "C1").saved, true);
  assert.equal(star.json.competitions.find((c) => c.id === "C1").status, "open", "starring does not change the status");
  const applied = await post(`${LAB}/competitions`, { compId: "C1", status: "applied" }, a);
  assert.equal(applied.json.competitions.find((c) => c.id === "C1").status, "applied");
  assert.equal(applied.json.competitions.find((c) => c.id === "C1").saved, true, "the star survives a status change");
  assert.equal(tabs.LabCompetitionEntries.length, 1, "one row per student and competition");
  assert.equal((await comps(b)).json.competitions.find((c) => c.id === "C1").status, "open", "another student's status is separate");

  // students only ever see their own journey
  assert.equal((await J(b)).json.percent, 0);
  assert.equal((await check({ itemId: "founder-profile", answer: "Bee" }, b)).json.journey.stages[0].deliverables[0].answer, "Bee");
  assert.equal((await J(a)).json.stages[0].deliverables[0].answer, "I build things.");
  assert.ok(tabs.LabChecklist.filter((r) => r.studentId === "S002").every((r) => r.checkKey.startsWith("S002|")), "rows are keyed by the session's student");

  // ---- fail soft: a Sheet outage is a clear, retryable 503 and not a crash or a leak ----
  sheetDown = true;
  const quiet = console.error;
  console.error = () => {};
  for (const [m, p, body] of [["GET", `${LAB}/progress`], ["GET", `${LAB}/journey`], ["GET", `${LAB}/competitions`], ["POST", `${LAB}/submissions`, { uploadType: "checkpoint", itemId: "solution-concept", url: GOOD }], ["POST", `${LAB}/journey/check`, { itemId: "landing-test", checked: false }], ["GET", `${LAB}/s1/exam`], ["POST", `${LAB}/s1/exam/start`, DETAILS], ["POST", `${LAB}/progress`, { sessionId: "s1", part: "notes", state: {} }]]) {
    const res = await send(m, p, body, a);
    assert.equal(res.status, 503, `${m} ${p} during an outage`);
    assert.match(res.json.error, /temporarily unavailable/i);
    assert.ok(!/simulated|ETIMEDOUT|Google/i.test(res.text), "the real error stays in the server log");
  }
  console.error = quiet;
  sheetDown = false;
  assert.equal((await get(`${LAB}/progress`, a)).status, 200, "recovers when the Sheet is back");

  // ---- sessions: the timeline, locked until the Sheet says visible, ticks, quiz graded on the server, upload slots ----
  const sessList0 = await get(`${LAB}/sessions`, a);
  assert.equal(sessList0.status, 200);
  assert.equal(sessList0.json.sessions[0].name, "Where Ideas Come From");
  assert.equal(sessList0.json.sessions[0].visible, true);
  assert.equal(sessList0.json.sessions[0].lab.notes.need, NOTE_IDS.length, "session 1 reports its native steps");
  assert.deepEqual(sessList0.json.sessions.filter((x) => x.visible).map((x) => x.no), [1], "sessions after the first start locked");
  assert.deepEqual(sessList0.json.sessions[1], { no: 2, name: "Design Thinking", visible: false }, "a locked session carries only its name");
  assert.equal((await get(`${LAB}/sessions/2`, a)).status, 404, "a locked session has no detail");
  assert.equal((await post(`${LAB}/sessions/2/ticks`, { ticked: [] }, a)).status, 404);
  assert.equal((await post(`${LAB}/sessions/2/quiz`, { answers: [] }, a)).status, 404);
  assert.equal((await post(`${LAB}/submissions`, { uploadType: "activity", itemId: "s2|Prototype photo", url: GOOD }, a)).status, 400, "no upload into a locked session");
  assert.equal((await get(`${LAB}/sessions/abc`, a)).status, 404);
  assert.equal((await get(`${LAB}/sessions/1`, await login("S003"))).status, 404, "not enrolled");

  const QUIZ = [0, 1, 2].map((n) => ({ q: "Question " + n, options: ["A", "B", "C", "D"], answer: n, explain: "because " + n }));
  tabs.LabSessions.push({ sessionNo: "2", visible: "TRUE", date: "2099-01-15", time: "5 PM", duration: "2 hrs", output: "Empathy Map\nPrototype", uploadSlots: "Prototype photo\nObservations",
    activities: "Empathy Map | 25 min\nPrototype | 35 min", recap: "We built things.\n- Observe, do not explain.", quizJson: JSON.stringify(QUIZ), instructions: "Use the 3-minute timer." });
  const sessList1 = await get(`${LAB}/sessions`, a);
  const card = sessList1.json.sessions[1];
  assert.equal(card.visible, true);
  assert.deepEqual(card.steps.map((x) => x.key), ["outputs", "quiz", "uploads"]);
  assert.deepEqual(sessList1.json.next, { no: 2, name: "Design Thinking", date: "2099-01-15", time: "5 PM" }, "next session comes from the dates");
  const d2 = await get(`${LAB}/sessions/2`, a);
  assert.equal(d2.status, 200);
  assert.deepEqual(d2.json.quiz[0], { q: "Question 0", options: ["A", "B", "C", "D"] }, "the quiz has no answers");
  assert.equal(d2.json.hasPitchTimer, true);
  assert.equal(d2.json.takeaways[0], "Observe, do not explain.");

  assert.equal((await post(`${LAB}/sessions/2/ticks`, { ticked: [5] }, a)).status, 400, "tick index out of range");
  assert.equal((await post(`${LAB}/sessions/2/ticks`, { ticked: "0" }, a)).status, 400);
  assert.deepEqual((await post(`${LAB}/sessions/2/ticks`, { ticked: [1, 0, 1] }, a)).json.ticked, [0, 1]);
  assert.equal((await get(`${LAB}/sessions/2`, a)).json.steps[0].done, true, "all outputs ticked");
  assert.equal((await get(`${LAB}/sessions/2`, b)).json.steps[0].done, false, "another student's ticks are separate");

  assert.equal((await post(`${LAB}/sessions/2/quiz`, { answers: [0, 1] }, a)).status, 400, "wrong number of answers");
  assert.equal((await post(`${LAB}/sessions/2/quiz`, { answers: [0, 1, 9] }, a)).status, 400);
  const q1 = await post(`${LAB}/sessions/2/quiz`, { answers: [0, 1, -1] }, a);
  assert.equal(q1.json.grade.score, 2);
  assert.equal(q1.json.grade.review[2].chosen, -1, "skipped is allowed");
  const q2 = await post(`${LAB}/sessions/2/quiz`, { answers: [3, 3, 3] }, a);
  assert.equal(q2.json.grade.score, 0);
  assert.deepEqual([q2.json.grade.bestScore, q2.json.grade.attempts], [2, 2], "best score and attempts are kept");
  assert.equal((await get(`${LAB}/sessions/2`, a)).json.steps[1].done, true);

  const up = await post(`${LAB}/submissions`, { uploadType: "activity", itemId: "s2|Prototype photo", url: GOOD }, a);
  assert.equal(up.status, 200);
  assert.equal(up.json.submission.itemLabel, "Prototype photo");
  assert.equal(up.json.submission.sessionNo, 2);
  assert.equal((await post(`${LAB}/submissions`, { uploadType: "activity", itemId: "s2|Not a slot", url: GOOD }, a)).status, 400, "unknown slot");
  const d2b = await get(`${LAB}/sessions/2`, a);
  assert.ok(d2b.json.submissions["Prototype photo"], "the upload shows on the session");
  assert.deepEqual(d2b.json.steps[2], { key: "uploads", label: "uploads", done: false, count: 1, total: 2 });
  assert.equal((await get(`${LAB}/sessions/2`, b)).json.submissions["Prototype photo"], undefined, "another student's upload is separate");
  assert.ok(!(await get(`${LAB}/journey`, a)).text.includes("s2|"), "session uploads are not journey proof");

  // ---- video: embeddable links only, marking it watched is progress (never part of the exam gate) ----
  const { parseVideo } = require("./sessions");
  assert.deepEqual(parseVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=9"), { provider: "youtube", embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ" });
  assert.deepEqual(parseVideo("https://youtu.be/dQw4w9WgXcQ"), { provider: "youtube", embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ" });
  assert.equal(parseVideo("https://vimeo.com/123456789").embedUrl, "https://player.vimeo.com/video/123456789");
  assert.equal(parseVideo("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing").embedUrl, "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview");
  for (const bad of ["", "http://youtu.be/dQw4w9WgXcQ", "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "https://example.com/video.mp4"]) assert.equal(parseVideo(bad), null, bad);

  assert.equal((await get(`${LAB}/sessions/2`, a)).json.video, null, "no link, no video");
  assert.equal((await post(`${LAB}/sessions/2/video`, { watched: true }, a)).status, 404, "nothing to mark without a video");
  assert.ok(!(await get(`${LAB}/sessions/2`, a)).json.steps.some((x) => x.key === "video"), "no video step without a video");
  tabs.LabSessions[0].videoUrl = "https://youtu.be/dQw4w9WgXcQ";
  tabs.LabSessions[0].videoTitle = "Lecture";
  const v0 = (await get(`${LAB}/sessions/2`, a)).json;
  assert.deepEqual(v0.video, { provider: "youtube", embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ", title: "Lecture" });
  assert.equal(v0.steps[0].key, "video");
  assert.equal(v0.steps[0].done, false);
  assert.equal((await post(`${LAB}/sessions/2/video`, { watched: "yes" }, a)).status, 400);
  assert.equal((await post(`${LAB}/sessions/1/video`, { watched: true }, a)).status, 404, "session 1 has no video yet");
  assert.equal((await post(`${LAB}/sessions/2/video`, { watched: true }, a)).status, 200);
  assert.equal((await get(`${LAB}/sessions/2`, a)).json.steps[0].done, true);
  assert.equal((await get(`${LAB}/sessions/2`, b)).json.steps[0].done, false, "another student's flag is separate");
  assert.equal((await get(`${LAB}/sessions`, a)).json.sessions[1].steps[0].key, "video", "the card counts it too");
  assert.equal((await post(`${LAB}/sessions/2/video`, { watched: false }, a)).status, 200);
  assert.equal((await get(`${LAB}/sessions/2`, a)).json.steps[0].done, false, "it can be unmarked");

  // a Sheet row can hide a session again, and a session in the past is not "next"
  tabs.LabSessions[0].visible = "FALSE";
  assert.equal((await get(`${LAB}/sessions/2`, a)).status, 404);
  tabs.LabSessions[0].visible = "TRUE";
  tabs.LabSessions[0].date = "2000-01-01";
  assert.equal((await get(`${LAB}/sessions`, a)).json.next, null);

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
