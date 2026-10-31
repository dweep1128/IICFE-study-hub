// Course hub API. Every route needs a login and only ever returns the signed-in student's own rows.
const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const sheets = require("./sheets");
const { answerQuestion } = require("./chat");
const { lower, toTime, safeUrl, isId, httpError, parseJson, paragraphsOf, progressFor, isHiddenCourse } = require("./util");

const EXAM_WINDOW_MIN = 180; // how long after the start time the exam can still be opened
const EXAM_UTC_OFFSET = "+08:00"; // exam times in the sheet are Singapore time
const WEAK_TOPIC_PCT = 60;
const MOCK_GRACE_S = 60; // slack for network delay on the auto-submit at time-up
const MS_PER_MIN = 60_000;
const HIGHLIGHT_COLORS = ["yellow", "green", "pink"];
const MAX_HIGHLIGHTS_PER_RESOURCE = 200;
const MAX_NOTE_LEN = 300;
const MAX_CHAT_LEN = 500;
const CHAT_PER_MINUTE = 20;

const today = () => new Date().toISOString().slice(0, 10);
const round1 = (n) => Math.round(n * 10) / 10;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const byNumber = (key) => (a, b) => (Number(a[key]) || 0) - (Number(b[key]) || 0); // used by guidance
const isEnrolled = (t, sid, courseId) => !isHiddenCourse(courseId) && t.Enrollments.some((e) => e.studentId === sid && e.courseId === courseId);

// "10:00 SGT" on 2026-11-18 -> epoch ms, or null when the sheet value isn't in a form we understand.
function examStart(exam) {
  const hm = String(exam.time).match(/(\d{1,2}):(\d{2})/);
  if (!hm || !/^\d{4}-\d{2}-\d{2}$/.test(exam.date)) return null;
  const t = Date.parse(`${exam.date}T${hm[1].padStart(2, "0")}:${hm[2]}:00${EXAM_UTC_OFFSET}`);
  return Number.isNaN(t) ? null : t;
}

module.exports = function courseRouter({ requireLogin, secret }) {
  const r = express.Router();
  r.use(requireLogin); // mounted after the public routes in index.js

  // Loads tabs in ONE Sheets call and confirms the student is enrolled in the course (404 otherwise, so
  // course ids can't be probed).
  async function loadCourse(req, courseId, extra = []) {
    if (!isId(courseId) || isHiddenCourse(courseId)) throw httpError(404, "Course not found");
    const t = await sheets.readTabs(["Enrollments", "Courses", ...extra]);
    const course = t.Courses.find((c) => c.courseId === courseId);
    if (!course || !isEnrolled(t, req.user.studentId, courseId)) throw httpError(404, "Course not found");
    return { t, course };
  }

  const progressOf = (t, sid, courseId) =>
    progressFor(t.Modules.filter((m) => m.courseId === courseId), t.ModuleProgress.filter((p) => p.studentId === sid));

  // ---------- overview ----------
  r.get("/courses/:id/hub", async (req, res) => {
    const sid = req.user.studentId;
    const { t, course } = await loadCourse(req, req.params.id, ["Modules", "ModuleProgress", "Dues"]);
    const prog = progressOf(t, sid, course.courseId);
    const { modules } = prog;
    const dues = t.Dues.filter((d) => d.studentId === sid && d.courseId === course.courseId)
      .sort((a, b) => toTime(a.dueDate) - toTime(b.dueDate))
      .map((d) => ({ dueId: d.dueId, title: d.title, type: d.type, dueDate: d.dueDate, priority: d.priority }));
    res.json({
      course: { courseId: course.courseId, title: course.title, description: course.description, bannerQuote: course.bannerQuote, hoursTotal: Number(course.hoursTotal) || 0 },
      modules,
      modulesCompleted: prog.completed,
      modulesTotal: prog.total,
      percent: prog.percent,
      hoursCompleted: modules.filter((m) => m.status === "complete").reduce((s, m) => s + m.hours, 0),
      hoursTotal: Number(course.hoursTotal) || 0,
      currentModule: prog.current,
      dues,
      nextAction: dues.find((d) => lower(d.priority) === "priority") ?? dues[0] ?? null,
    });
  });

  r.get("/courses/:id/guidance", async (req, res) => {
    const { t, course } = await loadCourse(req, req.params.id, ["Guidance"]);
    res.json(t.Guidance.filter((g) => g.courseId === course.courseId).sort(byNumber("order"))
      .map((g) => ({ guideId: g.guideId, title: g.title, body: g.body, order: Number(g.order) || 0 })));
  });

  r.get("/courses/:id/resources", async (req, res) => {
    const { t, course } = await loadCourse(req, req.params.id, ["Resources", "Modules"]);
    const moduleTitle = new Map(t.Modules.map((m) => [m.moduleId, m.title]));
    res.json(t.Resources.filter((x) => x.courseId === course.courseId).map((x) => {
      const type = lower(x.type);
      return {
        resourceId: x.resourceId, moduleId: x.moduleId, moduleTitle: moduleTitle.get(x.moduleId) ?? "", type, title: x.title,
        url: safeUrl(x.url), durationMin: Number(x.durationMin) || 0,
        paragraphs: type === "study_text" ? paragraphsOf(x.content) : [],
      };
    }));
  });

  r.get("/courses/:id/exam", async (req, res) => {
    const { t, course } = await loadCourse(req, req.params.id, ["Exams"]);
    const exam = t.Exams.filter((e) => e.courseId === course.courseId && lower(e.status) !== "cancelled")
      .sort((a, b) => toTime(a.date) - toTime(b.date))[0];
    if (!exam) return res.json(null);
    const startsAt = examStart(exam);
    const now = Date.now();
    res.json({
      examId: exam.examId, title: exam.title, date: exam.date, time: exam.time, mode: exam.mode, instructions: exam.instructions,
      status: lower(exam.status), startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      canStart: lower(exam.status) === "scheduled" && startsAt != null && now >= startsAt && now <= startsAt + EXAM_WINDOW_MIN * MS_PER_MIN,
    });
  });

  // ---------- highlights ----------
  // Resolves a study-text resource the student is allowed to see.
  async function loadStudyText(req, resourceId, extra = []) {
    if (!isId(resourceId)) throw httpError(400, "Invalid resource");
    const t = await sheets.readTabs(["Enrollments", "Resources", ...extra]);
    const resource = t.Resources.find((x) => x.resourceId === resourceId);
    if (!resource || lower(resource.type) !== "study_text" || !isEnrolled(t, req.user.studentId, resource.courseId)) throw httpError(404, "Resource not found");
    return { t, resource };
  }
  const highlightOut = (h) => ({
    highlightId: h.highlightId, resourceId: h.resourceId, paragraphIndex: Number(h.paragraphIndex), startOffset: Number(h.startOffset),
    endOffset: Number(h.endOffset), text: h.text, color: h.color, note: h.note ?? "", createdOn: h.createdOn,
  });

  r.get("/highlights", async (req, res) => {
    const { t, resource } = await loadStudyText(req, req.query.resourceId, ["Highlights"]);
    res.json(t.Highlights.filter((h) => h.studentId === req.user.studentId && h.resourceId === resource.resourceId).map(highlightOut));
  });

  r.post("/highlights", async (req, res) => {
    const sid = req.user.studentId;
    const b = req.body ?? {};
    const { t, resource } = await loadStudyText(req, b.resourceId, ["Highlights"]);
    const paragraphs = paragraphsOf(resource.content);
    const { paragraphIndex: pi, startOffset: start, endOffset: end } = b;
    const paragraph = Number.isInteger(pi) ? paragraphs[pi] : undefined;
    // The text must be exactly the selected slice, so clients can't store arbitrary content.
    if (paragraph === undefined || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > paragraph.length
        || b.text !== paragraph.slice(start, end)) throw httpError(400, "That selection isn't valid.");
    if (!HIGHLIGHT_COLORS.includes(b.color)) throw httpError(400, "Pick a highlight colour.");
    const note = typeof b.note === "string" ? b.note.trim() : "";
    if (note.length > MAX_NOTE_LEN) throw httpError(400, `Notes can be up to ${MAX_NOTE_LEN} characters.`);
    if (t.Highlights.filter((h) => h.studentId === sid && h.resourceId === resource.resourceId).length >= MAX_HIGHLIGHTS_PER_RESOURCE) {
      throw httpError(400, "You've reached the highlight limit for this text.");
    }
    const row = {
      highlightId: `H-${crypto.randomUUID().slice(0, 8)}`, studentId: sid, resourceId: resource.resourceId, paragraphIndex: pi,
      startOffset: start, endOffset: end, text: b.text, color: b.color, createdOn: today(), note,
    };
    await sheets.appendRow("Highlights", row);
    res.status(201).json(highlightOut(row));
  });

  r.delete("/highlights/:id", async (req, res) => {
    if (!isId(req.params.id)) throw httpError(404, "Highlight not found");
    const rows = await sheets.readTab("Highlights");
    const own = rows.find((h) => h.highlightId === req.params.id && h.studentId === req.user.studentId);
    if (!own) throw httpError(404, "Highlight not found");
    await sheets.deleteRow("Highlights", "highlightId", own.highlightId);
    res.json({ ok: true });
  });

  // ---------- mock tests ----------
  const topicBreakdown = (questions, correctById) => {
    const out = {};
    for (const q of questions) {
      const topic = q.topic || "General";
      out[topic] ??= { correct: 0, total: 0 };
      out[topic].total += 1;
      if (correctById.get(q.questionId)) out[topic].correct += 1;
    }
    return out;
  };
  const topicList = (breakdown) => Object.entries(breakdown).map(([topic, v]) => {
    const p = pct(v.correct, v.total);
    return { topic, correct: v.correct, total: v.total, pct: p, weak: p < WEAK_TOPIC_PCT };
  });

  r.get("/mocktests/:courseId", async (req, res) => {
    const sid = req.user.studentId;
    const { t, course } = await loadCourse(req, req.params.courseId, ["MockTests", "MockQuestions", "MockAttempts"]);
    res.json(t.MockTests.filter((x) => x.courseId === course.courseId).map((x) => {
      const attempts = t.MockAttempts.filter((a) => a.studentId === sid && a.testId === x.testId);
      const last = attempts[attempts.length - 1];
      return {
        testId: x.testId, title: x.title, durationMin: Number(x.durationMin) || 0,
        questionCount: t.MockQuestions.filter((q) => q.testId === x.testId).length,
        attempts: attempts.length, lastScore: last ? { score: Number(last.score), total: Number(last.total) } : null,
      };
    }));
  });

  // Questions go out WITHOUT correctIndex or explanation: grading only ever happens in /submit.
  r.get("/mocktests/:testId/start", async (req, res) => {
    const { testId } = req.params;
    if (!isId(testId)) throw httpError(404, "Test not found");
    const t = await sheets.readTabs(["Enrollments", "MockTests", "MockQuestions"]);
    const test = t.MockTests.find((x) => x.testId === testId);
    if (!test || !isEnrolled(t, req.user.studentId, test.courseId)) throw httpError(404, "Test not found");
    const questions = t.MockQuestions.filter((q) => q.testId === testId);
    if (!questions.length) throw httpError(404, "This test has no questions yet.");
    const durationMin = Number(test.durationMin) || 30;
    // The token records the server-side start time, so the time limit can't be dodged from the browser.
    const startToken = jwt.sign({ sid: req.user.studentId, testId, jti: crypto.randomUUID(), st: Date.now() }, secret,
      { algorithm: "HS256", expiresIn: durationMin * 60 + MOCK_GRACE_S });
    res.json({
      testId, title: test.title, durationMin, startToken,
      questions: questions.map((q) => ({ questionId: q.questionId, question: q.question, options: parseJson(q.optionsJson, []), topic: q.topic })),
    });
  });

  r.post("/mocktests/:testId/submit", async (req, res) => {
    const sid = req.user.studentId;
    const { testId } = req.params;
    if (!isId(testId)) throw httpError(404, "Test not found");
    let token;
    try { token = jwt.verify(String(req.body?.startToken ?? ""), secret, { algorithms: ["HS256"] }); }
    catch { throw httpError(400, "This attempt has expired. Please start the test again."); }
    if (token.sid !== sid || token.testId !== testId) throw httpError(400, "This attempt doesn't belong to you.");
    const answers = req.body?.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw httpError(400, "Answers are missing.");

    const t = await sheets.readTabs(["Enrollments", "MockTests", "MockQuestions", "MockAttempts"]);
    const test = t.MockTests.find((x) => x.testId === testId);
    if (!test || !isEnrolled(t, sid, test.courseId)) throw httpError(404, "Test not found");
    const attemptId = `A-${token.jti.slice(0, 8)}`;
    if (t.MockAttempts.some((a) => a.attemptId === attemptId)) throw httpError(409, "This attempt was already submitted.");

    const questions = t.MockQuestions.filter((q) => q.testId === testId);
    const review = questions.map((q) => {
      const options = parseJson(q.optionsJson, []);
      const picked = answers[q.questionId];
      const yourIndex = Number.isInteger(picked) && picked >= 0 && picked < options.length ? picked : null;
      const correctIndex = Number(q.correctIndex);
      return { questionId: q.questionId, topic: q.topic || "General", question: q.question, options, yourIndex, correctIndex, correct: yourIndex === correctIndex, explanation: q.explanation };
    });
    const score = review.filter((x) => x.correct).length;
    const total = review.length;
    const timeTakenMin = round1(Math.min(Number(test.durationMin) || 30, (Date.now() - token.st) / MS_PER_MIN));
    const breakdown = topicBreakdown(questions, new Map(review.map((x) => [x.questionId, x.correct])));

    await sheets.appendRow("MockAttempts", {
      attemptId, studentId: sid, testId, score, total, timeTakenMin, topicBreakdownJson: JSON.stringify(breakdown), date: today(),
    });
    res.json({ attemptId, testId, title: test.title, score, total, accuracy: pct(score, total), timeTakenMin, topics: topicList(breakdown), review });
  });

  r.get("/mocktests/:courseId/analysis", async (req, res) => {
    const sid = req.user.studentId;
    const { t, course } = await loadCourse(req, req.params.courseId, ["MockTests", "MockAttempts"]);
    const titleOf = new Map(t.MockTests.filter((x) => x.courseId === course.courseId).map((x) => [x.testId, x.title]));
    const attempts = t.MockAttempts.filter((a) => a.studentId === sid && titleOf.has(a.testId))
      .map((a, i) => ({ a, i })).sort((x, y) => toTime(x.a.date) - toTime(y.a.date) || x.i - y.i).map(({ a }) => ({
        attemptId: a.attemptId, testId: a.testId, testTitle: titleOf.get(a.testId), score: Number(a.score), total: Number(a.total),
        accuracy: pct(Number(a.score), Number(a.total)), timeTakenMin: Number(a.timeTakenMin), date: a.date,
        topics: topicList(parseJson(a.topicBreakdownJson, {})),
      }));
    const all = {};
    for (const a of attempts) for (const tp of a.topics) {
      all[tp.topic] ??= { correct: 0, total: 0 };
      all[tp.topic].correct += tp.correct;
      all[tp.topic].total += tp.total;
    }
    res.json({ attempts, topics: topicList(all) });
  });

  // ---------- chatbot ----------
  const chatLimiter = rateLimit({
    windowMs: MS_PER_MIN, limit: CHAT_PER_MINUTE, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => req.user.studentId, message: { error: "You're sending messages too quickly. Please wait a moment." },
  });

  r.post("/chat", chatLimiter, async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message || message.length > MAX_CHAT_LEN) throw httpError(400, `Ask a question up to ${MAX_CHAT_LEN} characters long.`);
    const { t, course } = await loadCourse(req, req.body?.courseId, ["Guidance", "Modules", "Resources"]);
    const cid = course.courseId;
    const docs = [
      ...t.Guidance.filter((g) => g.courseId === cid).map((g) => ({ title: g.title, text: g.body })),
      ...t.Modules.filter((m) => m.courseId === cid).map((m) => ({ title: m.title, text: m.summary })),
      ...t.Resources.filter((x) => x.courseId === cid).map((x) => ({ title: x.title, text: paragraphsOf(x.content).join(" ") || x.title })),
    ];
    const { answer, sources } = await answerQuestion(message, docs);
    try {
      await sheets.appendRow("ChatLogs", { logId: `L-${crypto.randomUUID().slice(0, 8)}`, studentId: req.user.studentId, courseId: cid, question: message, answer, date: new Date().toISOString() });
    } catch (err) { console.error("[chat] could not log:", err.message); } // the student still gets their answer
    res.json({ answer, sources });
  });

  return r;
};
