// Runs the real Express app against an in-memory fake of sheets.js (no Google, no network).
// Usage: node server/smoke.test.js
const assert = require("node:assert/strict");

const TEST_PORT = 3999;
process.env.PORT = TEST_PORT;
const LOGIN_LIMIT = 40; // the real default is 10; raised so this suite can try many passwords before testing the limit itself
process.env.LOGIN_MAX_ATTEMPTS = LOGIN_LIMIT;
process.env.SESSION_SECRET = "test-secret-".padEnd(40, "x");
delete process.env.ANTHROPIC_API_KEY; // keyword chat mode
const BASE = `http://localhost:${TEST_PORT}`;

const PW = "Demo@1234"; // plain text in the sheet, by founder decision
const OTHER_PW = "Other#5678";
const iso = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const PARAS = "First paragraph about assets and liabilities.\n\nSecond paragraph about the going concern basis.";
const tabs = {
  Students: [
    { studentId: "S001", name: "Demo Student", email: "demo@iicfe-demo.com", password: PW, status: "active" },
    { studentId: "S002", name: "Other Student", email: "other@iicfe-demo.com", password: OTHER_PW, status: "active" },
    { studentId: "S003", name: "Inactive", email: "off@iicfe-demo.com", password: PW, status: "inactive" },
    { studentId: "S004", name: "Blank Pw", email: "blank@iicfe-demo.com", password: "", status: "active" },
  ],
  Courses: [
    { courseId: "C100", title: "Fixture Course", description: "d", status: "live", totalLessons: "12", hoursTotal: "30", bannerQuote: "q" },
    { courseId: "C001", title: "Retired demo", description: "d", status: "live", totalLessons: "12", hoursTotal: "30", bannerQuote: "" },
    { courseId: "C002", title: "Hidden Course", description: "d", status: "draft", totalLessons: "5", hoursTotal: "10", bannerQuote: "" },
  ],
  Enrollments: [
    { enrollmentId: "E001", studentId: "S001", courseId: "C100", status: "active", progressPct: "35", enrolledOn: "2026-10-01", completedOn: "" },
    { enrollmentId: "E003", studentId: "S001", courseId: "C001", status: "active", progressPct: "10", enrolledOn: "2026-10-01", completedOn: "" },
    { enrollmentId: "E002", studentId: "S002", courseId: "C002", status: "completed", progressPct: "100", enrolledOn: "2026-09-01", completedOn: "2026-10-01" },
  ],
  Payments: [
    { paymentId: "P001", studentId: "S001", date: "2026-10-01", description: "Retired demo fee", amount: "S$9", status: "Paid", receiptUrl: "" },
    { paymentId: "P101", studentId: "S001", date: "2026-10-01", description: "Fee", amount: "S$150", status: "Paid", receiptUrl: "https://example.com/r" },
    { paymentId: "P002", studentId: "S002", date: "2026-10-01", description: "Secret", amount: "S$1", status: "Paid", receiptUrl: "javascript:alert(1)" },
  ],
  Certificates: [],
  Webinars: [
    { webinarId: "W001", title: "Retired webinar", date: "2999-01-01", time: "19:00", joinUrl: "", status: "scheduled" },
    { webinarId: "W1", title: "Future", date: "2999-01-01", time: "19:00", joinUrl: "javascript:alert(1)", status: "scheduled" },
    { webinarId: "W2", title: "Past", date: "2000-01-01", time: "19:00", joinUrl: "", status: "scheduled" },
  ],
  News: [{ newsId: "N1", title: "Hi", body: "b", date: "2026-10-01" }],
  Modules: [
    { moduleId: "M1", courseId: "C100", title: "Conceptual framework", order: "1", hours: "4", summary: "Qualitative characteristics explained." },
    { moduleId: "M2", courseId: "C100", title: "Leases", order: "2", hours: "6", summary: "Lessee accounting." },
    { moduleId: "M9", courseId: "C002", title: "Hidden module", order: "1", hours: "1", summary: "x" },
  ],
  ModuleProgress: [
    { studentId: "S001", moduleId: "M1", status: "complete", completedOn: "2026-10-05" },
    { studentId: "S002", moduleId: "M9", status: "complete", completedOn: "2026-10-05" },
  ],
  Dues: [
    { dueId: "D1", studentId: "S001", courseId: "C100", title: "Normal later", type: "Assignment", dueDate: iso(12), priority: "Normal" },
    { dueId: "D2", studentId: "S001", courseId: "C100", title: "Priority soon", type: "Quiz", dueDate: iso(5), priority: "Priority" },
    { dueId: "D4", studentId: "S001", courseId: "C001", title: "Retired due", type: "Quiz", dueDate: iso(2), priority: "Priority" },
    { dueId: "D3", studentId: "S002", courseId: "C002", title: "Secret due", type: "Quiz", dueDate: iso(1), priority: "Priority" },
  ],
  Guidance: [{ guideId: "G1", courseId: "C100", title: "Exam technique tips", body: "Read the requirement first. Allocate time by marks.", order: "1" }],
  Resources: [
    { resourceId: "R1", courseId: "C100", moduleId: "M1", type: "study_text", title: "Study text: Framework", url: "", durationMin: "15", content: PARAS },
    { resourceId: "R2", courseId: "C002", moduleId: "M9", type: "study_text", title: "Hidden text", url: "", durationMin: "5", content: "Hidden paragraph here." },
    { resourceId: "R3", courseId: "C100", moduleId: "M1", type: "video", title: "Lecture", url: "javascript:alert(1)", durationMin: "10", content: "" },
  ],
  Highlights: [{ highlightId: "H-other", studentId: "S002", resourceId: "R2", paragraphIndex: "0", startOffset: "0", endOffset: "6", text: "Hidden", color: "pink", createdOn: "2026-10-01", note: "secret note" }],
  MockTests: [
    { testId: "T1", courseId: "C100", title: "Mock 1", durationMin: "30", totalMarks: "2" },
    { testId: "T2", courseId: "C002", title: "Hidden mock", durationMin: "30", totalMarks: "1" },
  ],
  MockQuestions: [
    { questionId: "Q1", testId: "T1", question: "Pick B", optionsJson: JSON.stringify(["A", "B", "C"]), correctIndex: "1", topic: "Topic X", explanation: "SECRET-EXPLANATION-1" },
    { questionId: "Q2", testId: "T1", question: "Pick A", optionsJson: JSON.stringify(["A", "B"]), correctIndex: "0", topic: "Topic Y", explanation: "SECRET-EXPLANATION-2" },
    { questionId: "Q9", testId: "T2", question: "Hidden", optionsJson: JSON.stringify(["A"]), correctIndex: "0", topic: "Z", explanation: "x" },
  ],
  MockAttempts: [
    { attemptId: "A001", studentId: "S001", testId: "T1", score: "1", total: "2", timeTakenMin: "10", topicBreakdownJson: JSON.stringify({ "Topic X": { correct: 1, total: 1 }, "Topic Y": { correct: 0, total: 1 } }), date: iso(-7) },
    { attemptId: "A002", studentId: "S002", testId: "T2", score: "1", total: "1", timeTakenMin: "1", topicBreakdownJson: "{}", date: iso(-1) },
  ],
  Documents: [{ docId: "DOC1", courseId: "C100", title: "Syllabus", category: "Course material", url: "https://example.com/s.pdf" }],
  Exams: [{ examId: "X1", courseId: "C100", title: "Final Exam", date: iso(21), time: "10:00 SGT", mode: "Online", instructions: "Be early", status: "scheduled" }],
  ChatLogs: [],
};
const fake = {
  readTab: async (n) => tabs[n],
  readTabs: async (names) => Object.fromEntries(names.map((n) => [n, tabs[n]])),
  appendRow: async (n, row) => { tabs[n].push(row); },
  appendRows: async (n, rows) => { tabs[n].push(...rows); },
  deleteRow: async (n, col, val) => { const i = tabs[n].findIndex((r) => r[col] === val); if (i < 0) return false; tabs[n].splice(i, 1); return true; },
};
const sheetsPath = require.resolve("./sheets.js");
require.cache[sheetsPath] = { id: sheetsPath, filename: sheetsPath, loaded: true, exports: fake };

require("./index.js");

const seen = []; // every response body, scanned at the end for leaked passwords
const call = async (p, opts = {}) => {
  const res = await fetch(BASE + p, { redirect: "manual", ...opts });
  if (p.startsWith("/api")) seen.push(await res.clone().text());
  return res;
};
const send = (method, p, body, cookie) => call(p, { method, headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const post = (p, body, cookie) => send("POST", p, body, cookie);
const get = (p, cookie) => call(p, { headers: { Cookie: cookie } });
const login = async (email, password = email.startsWith("other") ? OTHER_PW : PW) => (await post("/api/login", { email, password })).headers.get("set-cookie").split(";")[0];

(async () => {
  await new Promise((r) => setTimeout(r, 300));

  // static whitelist: pages yes; server code, env, credentials, package.json no
  assert.equal((await call("/signin.html")).status, 200);
  assert.equal((await call("/courses")).status, 200);
  assert.equal((await call("/course.html")).status, 200);
  for (const p of ["/.env", "/server/index.js", "/server/credentials/service-account.json", "/package.json", "/js/../.env"]) {
    assert.notEqual((await call(p)).status, 200, `${p} must not be served`);
  }

  // public courses: live only
  assert.deepEqual((await (await call("/api/courses")).json()).map((c) => c.courseId), ["C100"]);

  // C001 is retired: still in the fake sheet (live), never listed or served
  assert.ok(!(await (await call("/api/courses")).json()).some((c) => c.courseId === "C001"), "retired course is not public");

  // blocked when signed out
  for (const p of ["/api/me", "/api/workspace", "/api/courses/C100/hub", "/api/mocktests/T1/start", "/api/highlights?resourceId=R1"]) {
    assert.equal((await call(p)).status, 401, p);
  }

  // validation + bad credentials
  assert.equal((await post("/api/login", { email: "nope", password: "x" })).status, 400);
  assert.equal((await post("/api/login", { email: "demo@iicfe-demo.com", password: "wrong" })).status, 401);
  assert.equal((await post("/api/login", { email: "ghost@iicfe-demo.com", password: "Demo@1234" })).status, 401);
  assert.equal((await post("/api/login", { email: "off@iicfe-demo.com", password: PW })).status, 401);
  assert.equal((await post("/api/login", { email: "demo@iicfe-demo.com", password: PW.toLowerCase() })).status, 401, "comparison is case-sensitive");
  assert.equal((await post("/api/login", { email: "demo@iicfe-demo.com", password: PW + "x" })).status, 401, "longer password rejected");
  assert.equal((await post("/api/login", { email: "demo@iicfe-demo.com", password: PW.slice(0, -1) })).status, 401, "shorter password rejected");
  assert.equal((await post("/api/login", { email: "blank@iicfe-demo.com", password: " " })).status, 401, "blank password cell never matches");
  assert.equal((await post("/api/login", { email: "blank@iicfe-demo.com", password: "anything" })).status, 401);
  assert.equal((await post("/api/login", { email: "demo@iicfe-demo.com", password: OTHER_PW })).status, 401, "another student's password doesn't work");
  assert.equal((await post("/api/login", { email: "demo@iicfe-demo.com", password: `  ${PW}  ` })).status, 200, "surrounding spaces are trimmed");
  // the sheet is the source of truth: an edit there applies on the very next login (no cache, no restart)
  tabs.Students[0].password = "Changed#999";
  assert.equal((await post("/api/login", { email: "demo@iicfe-demo.com", password: PW })).status, 401, "old password stops working immediately");
  assert.equal((await post("/api/login", { email: "demo@iicfe-demo.com", password: "Changed#999" })).status, 200, "new password works immediately");
  tabs.Students[0].password = PW;

  // good login: httpOnly + SameSite=Lax cookie
  const ok = await post("/api/login", { email: "Demo@iicfe-demo.com", password: PW });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).name, "Demo Student");
  const setCookie = ok.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookie = setCookie.split(";")[0];
  const other = await login("other@iicfe-demo.com");

  assert.equal((await (await get("/api/me", cookie)).json()).name, "Demo Student");

  // workspace: own rows only, no hashes, unsafe URLs stripped, past webinars hidden
  const raw = await (await get("/api/workspace", cookie)).text();
  const ws = JSON.parse(raw);
  assert.ok(!/password/i.test(raw), "no password field in the workspace response");
  assert.ok(!raw.includes("Secret") && !raw.includes("S002"), "no other student's rows");
  assert.equal(ws.activeCourses.length, 1);
  // one source of truth: workspace progress == hub progress == completed modules / total modules (1 of 2)
  assert.equal(ws.activeCourses[0].progressPct, 50, "workspace progress comes from ModuleProgress, not Enrollments.progressPct (35)");
  assert.equal(ws.journey.averageProgress, 50);
  assert.equal(ws.activeCourses[0].currentModule, "Leases");
  assert.equal(ws.activeCourses[0].nextDue.title, "Priority soon");
  assert.deepEqual(ws.dues.map((d) => d.dueId), ["D2", "D1"], "own upcoming dues only");
  assert.ok(!raw.includes("C001") && !raw.includes("Retired"), "retired course never reaches the workspace");
  assert.equal((await get("/api/courses/C001/hub", cookie)).status, 404, "retired course 404s even when enrolled");
  assert.deepEqual(ws.webinars.map((w) => w.title), ["Future"], "retired W001 is not served");
  assert.ok(!ws.payments.some((p) => p.paymentId === "P001"), "retired P001 is not served");
  assert.equal(ws.webinars[0].joinUrl, "");

  // ---- hub: own data, derived numbers ----
  const hubRaw = await (await get("/api/courses/C100/hub", cookie)).text();
  const hub = JSON.parse(hubRaw);
  assert.ok(!hubRaw.includes("Secret due") && !hubRaw.includes("Hidden") && !hubRaw.includes("S002"), "hub leaks nothing from other courses/students");
  assert.equal(hub.modulesCompleted, 1);
  assert.equal(hub.modulesTotal, 2);
  assert.equal(hub.percent, 50);
  assert.equal(hub.percent, ws.activeCourses[0].progressPct, "hub and workspace show the same number");
  assert.equal(hub.hoursCompleted, 4);
  assert.equal(hub.hoursTotal, 30);
  assert.equal(hub.currentModule.moduleId, "M2"); // first non-complete
  assert.deepEqual(hub.dues.map((d) => d.dueId), ["D2", "D1"]); // sorted by date
  assert.equal(hub.nextAction.dueId, "D2"); // the Priority one
  assert.equal((await get("/api/courses/C002/hub", cookie)).status, 404, "not enrolled -> 404");
  assert.equal((await get("/api/courses/C002/guidance", cookie)).status, 404);
  assert.equal((await get("/api/courses/..%2F..%2Fx/hub", cookie)).status, 404);
  assert.equal((await get("/api/courses/C100/hub", other)).status, 404, "other student not enrolled in C100");

  // ---- resources / documents / exam / guidance ----
  const res = await (await get("/api/courses/C100/resources", cookie)).json();
  assert.deepEqual(res.find((x) => x.resourceId === "R1").paragraphs.length, 2);
  assert.equal(res.find((x) => x.resourceId === "R3").url, "", "unsafe video url stripped");
  assert.ok(!res.some((x) => x.resourceId === "R2"));
  assert.equal((await (await get("/api/courses/C100/documents", cookie)).json()).length, 1);
  assert.equal((await (await get("/api/courses/C100/guidance", cookie)).json()).length, 1);
  const exam = await (await get("/api/courses/C100/exam", cookie)).json();
  assert.equal(exam.canStart, false);
  assert.ok(exam.startsAt);

  // ---- certificate: locked ----
  const cert = await (await get("/api/courses/C100/certificate", cookie)).json();
  assert.equal(cert.eligible, false);
  assert.equal(cert.certificate, null);
  assert.deepEqual(cert.conditions.map((c) => c.met), [false, false]);
  assert.equal(cert.progress, 25);

  // ---- highlights ----
  const goodHl = { resourceId: "R1", paragraphIndex: 0, startOffset: 0, endOffset: 5, text: "First", color: "yellow", note: "remember" };
  assert.equal((await post("/api/highlights", { ...goodHl, text: "Wrong" }, cookie)).status, 400, "text must match the slice");
  assert.equal((await post("/api/highlights", { ...goodHl, color: "red" }, cookie)).status, 400);
  assert.equal((await post("/api/highlights", { ...goodHl, endOffset: 9999 }, cookie)).status, 400);
  assert.equal((await post("/api/highlights", { ...goodHl, resourceId: "R3" }, cookie)).status, 404, "only study texts");
  assert.equal((await post("/api/highlights", goodHl, other)).status, 404, "other student can't highlight a course they're not in");
  const created = await post("/api/highlights", goodHl, cookie);
  assert.equal(created.status, 201);
  const hl = await created.json();
  const listed = await (await get("/api/highlights?resourceId=R1", cookie)).json();
  assert.deepEqual(listed.map((h) => h.highlightId), [hl.highlightId]);
  assert.equal(tabs.Highlights.find((h) => h.highlightId === hl.highlightId).studentId, "S001");
  assert.equal((await get("/api/highlights?resourceId=R1", other)).status, 404);
  assert.equal((await send("DELETE", `/api/highlights/${hl.highlightId}`, undefined, other)).status, 404, "can't delete someone else's highlight");
  assert.equal((await send("DELETE", "/api/highlights/H-other", undefined, cookie)).status, 404);
  assert.ok(tabs.Highlights.some((h) => h.highlightId === "H-other"));
  assert.equal((await send("DELETE", `/api/highlights/${hl.highlightId}`, undefined, cookie)).status, 200);
  assert.equal((await (await get("/api/highlights?resourceId=R1", cookie)).json()).length, 0);

  // ---- mock tests: list, start (no answers leaked), submit (server grading) ----
  const list = await (await get("/api/mocktests/C100", cookie)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].questionCount, 2);
  const startRaw = await (await get("/api/mocktests/T1/start", cookie)).text();
  assert.ok(!/correctIndex|SECRET-EXPLANATION|explanation/i.test(startRaw), "start response must not contain answers");
  const start = JSON.parse(startRaw);
  assert.equal(start.questions.length, 2);
  assert.equal((await get("/api/mocktests/T2/start", cookie)).status, 404, "not enrolled in that test's course");
  assert.equal((await post("/api/mocktests/T1/submit", { startToken: "garbage", answers: {} }, cookie)).status, 400);
  assert.equal((await post("/api/mocktests/T1/submit", { startToken: start.startToken, answers: { Q1: 1, Q2: 1 } }, other)).status, 400, "token is bound to the student");
  const before = tabs.MockAttempts.length;
  const sub = await post("/api/mocktests/T1/submit", { startToken: start.startToken, answers: { Q1: 1, Q2: 1 } }, cookie);
  assert.equal(sub.status, 200);
  const result = await sub.json();
  assert.equal(result.score, 1); // Q1 right, Q2 wrong
  assert.equal(result.total, 2);
  assert.equal(result.accuracy, 50);
  assert.deepEqual(result.topics.map((t) => [t.topic, t.pct, t.weak]), [["Topic X", 100, false], ["Topic Y", 0, true]]);
  assert.equal(result.review.find((q) => q.questionId === "Q2").explanation, "SECRET-EXPLANATION-2");
  assert.equal(tabs.MockAttempts.length, before + 1, "attempt saved");
  assert.equal(tabs.MockAttempts.at(-1).studentId, "S001");
  assert.equal((await post("/api/mocktests/T1/submit", { startToken: start.startToken, answers: {} }, cookie)).status, 409, "no double submit");

  const analysis = await (await get("/api/mocktests/C100/analysis", cookie)).json();
  assert.equal(analysis.attempts.length, 2);
  assert.ok(!JSON.stringify(analysis).includes("A002"), "other student's attempt not returned");
  assert.equal(analysis.topics.find((t) => t.topic === "Topic Y").weak, true);

  // ---- chat ----
  assert.equal((await post("/api/chat", { courseId: "C100", message: "" }, cookie)).status, 400);
  assert.equal((await post("/api/chat", { courseId: "C002", message: "hello" }, cookie)).status, 404);
  const chat = await (await post("/api/chat", { courseId: "C100", message: "Any exam technique tips?" }, cookie)).json();
  assert.deepEqual(chat.sources.slice(0, 1), ["Exam technique tips"]);
  assert.match(chat.answer, /requirement/i);
  const none = await (await post("/api/chat", { courseId: "C100", message: "zxqv blorp" }, cookie)).json();
  assert.deepEqual(none.sources, []);
  assert.equal(tabs.ChatLogs.length, 2);
  assert.equal(tabs.ChatLogs[0].studentId, "S001");

  // logout clears the cookie; tampered token rejected
  const out = await post("/api/logout", {}, cookie);
  assert.match(out.headers.get("set-cookie"), /iicfe_session=;/);
  assert.equal((await get("/api/me", cookie + "x")).status, 401);

  // chat rate limit (20/min per student)
  const again = await login("demo@iicfe-demo.com");
  let chatLimited = false;
  for (let i = 0; i < 25 && !chatLimited; i++) chatLimited = (await post("/api/chat", { courseId: "C100", message: "study plan" }, again)).status === 429;
  assert.ok(chatLimited, "chat should be rate limited");

  // the password column and its values never appear in ANY /api response (login, me, workspace, errors, ...)
  const everything = seen.join("\n");
  assert.ok(seen.length > 40, "scanned a meaningful number of responses");
  for (const secret of [PW, OTHER_PW, "Changed#999"]) assert.ok(!everything.includes(secret), `a response leaked ${secret}`);
  assert.ok(!/"password"\s*:/i.test(everything), "no password key in any response");
  assert.ok(!/passwordHash/.test(everything), "no passwordHash key either");

  // login rate limit (default 10 per window; raised to LOGIN_LIMIT for this suite)
  let limited = false;
  for (let i = 0; i < LOGIN_LIMIT + 5 && !limited; i++) limited = (await post("/api/login", { email: "demo@iicfe-demo.com", password: "bad" })).status === 429;
  assert.ok(limited, "login should be rate limited");

  console.log("smoke tests passed");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
