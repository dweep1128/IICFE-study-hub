try { process.loadEnvFile(require("path").join(__dirname, "..", ".env")); } catch { /* env may come from the host */ }
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const sheets = require("./sheets");
const createCourseRouter = require("./course");
const { lower, toTime, safeUrl, progressFor, isHiddenCourse, isHiddenWebinar, isHiddenPayment } = require("./util");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 3000;
const SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("SESSION_SECRET missing or too short (need 32+ chars). See .env.example.");
  process.exit(1);
}

const COOKIE = "iicfe_session";
const SESSION_TTL_S = 8 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS) || 10; // env override exists for the test suite
const API_WINDOW_MS = 60 * 1000;
const API_MAX_REQUESTS = 120;
const BODY_LIMIT = "10kb";
const MAX_EMAIL_LEN = 254;
const MAX_PASSWORD_LEN = 128;
const NEWS_LIMIT = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Passwords are plain text in the sheet (founder decision), so login is a trimmed, constant-time string compare.
// The length check leaks only the length; timingSafeEqual needs equal-length buffers.
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a).trim());
  const y = Buffer.from(String(b).trim());
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const cookieOpts = () => ({ httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
const isActive = (student) => lower(student.status) === "active";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // behind Vercel's proxy: secure cookies and per-client rate limits need the forwarded IP/proto
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "same-origin" });
  next();
});
app.use("/api", express.json({ limit: BODY_LIMIT }), cookieParser(), (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use("/api", rateLimit({ windowMs: API_WINDOW_MS, limit: API_MAX_REQUESTS, standardHeaders: true, legacyHeaders: false }));

app.get("/api/health", (req, res) => res.json({ ok: true }));

function requireLogin(req, res, next) {
  try {
    const p = jwt.verify(req.cookies[COOKIE], SECRET, { algorithms: ["HS256"] });
    req.user = { studentId: p.sid, name: p.name, email: p.email };
    next();
  } catch {
    res.status(401).json({ error: "Not signed in" });
  }
}

// ---------- auth ----------
const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS, limit: LOGIN_MAX_ATTEMPTS, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please try again later." },
});

app.post("/api/login", loginLimiter, async (req, res) => {
  const email = lower(req.body?.email);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LEN || !password || password.length > MAX_PASSWORD_LEN) {
    return res.status(400).json({ error: "Enter a valid email and password." });
  }
  // Read fresh from the sheet on every login (no cache), so edits there apply on the very next sign-in.
  const student = (await sheets.readTab("Students")).find((s) => lower(s.email) === email);
  // A blank password cell must never match, whatever was submitted.
  const stored = String(student?.password ?? "").trim();
  const matches = stored !== "" && safeEqual(password, stored);
  if (!student || !matches || !isActive(student)) return res.status(401).json({ error: "Invalid email or password." });

  const token = jwt.sign({ sid: student.studentId, name: student.name, email: student.email }, SECRET, { algorithm: "HS256", expiresIn: SESSION_TTL_S });
  res.cookie(COOKIE, token, { ...cookieOpts(), maxAge: SESSION_TTL_S * 1000 });
  res.json({ name: student.name });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie(COOKIE, cookieOpts());
  res.json({ ok: true });
});

// Answered from the signed cookie (no Sheets call) so every page view stays cheap.
app.get("/api/me", requireLogin, (req, res) => res.json({ name: req.user.name, email: req.user.email, studentId: req.user.studentId }));

// ---------- data ----------
app.get("/api/courses", async (req, res) => {
  const courses = await sheets.readTab("Courses");
  res.json(courses.filter((c) => lower(c.status) === "live" && !isHiddenCourse(c.courseId)).map((c) => ({
    courseId: c.courseId, title: c.title, description: c.description, totalLessons: Number(c.totalLessons) || 0,
  })));
});

app.get("/api/workspace", requireLogin, async (req, res) => {
  const sid = req.user.studentId;
  const t = await sheets.readTabs(["Students", "Enrollments", "Courses", "Payments", "Certificates", "Webinars", "News", "Modules", "ModuleProgress", "Dues"]);

  const student = t.Students.find((s) => s.studentId === sid);
  if (!student || !isActive(student)) {
    res.clearCookie(COOKIE, cookieOpts());
    return res.status(401).json({ error: "Not signed in" });
  }

  const courseById = new Map(t.Courses.map((c) => [c.courseId, c]));
  const myProgress = t.ModuleProgress.filter((p) => p.studentId === sid);
  const startOfToday = new Date().setUTCHours(0, 0, 0, 0);
  const myDues = t.Dues.filter((d) => d.studentId === sid && !isHiddenCourse(d.courseId) && toTime(d.dueDate) >= startOfToday)
    .sort((a, b) => toTime(a.dueDate) - toTime(b.dueDate))
    .map((d) => ({ dueId: d.dueId, courseId: d.courseId, courseTitle: courseById.get(d.courseId)?.title || d.courseId, title: d.title, type: d.type, dueDate: d.dueDate, priority: d.priority }));
  const enrollments = t.Enrollments.filter((e) => e.studentId === sid && !isHiddenCourse(e.courseId)).map((e) => {
    const course = courseById.get(e.courseId) ?? {};
    const status = lower(e.status);
    const prog = progressFor(t.Modules.filter((m) => m.courseId === e.courseId), myProgress);
    const next = myDues.find((d) => d.courseId === e.courseId);
    return {
      enrollmentId: e.enrollmentId, courseId: e.courseId, status,
      title: course.title || e.courseId, description: course.description || "", totalLessons: Number(course.totalLessons) || 0,
      // One source of truth: modules completed / total (same number the course hub shows).
      progressPct: status === "completed" ? 100 : prog.percent,
      modulesCompleted: prog.completed, modulesTotal: prog.total, currentModule: prog.current?.title ?? "",
      nextDue: next ? { title: next.title, type: next.type, dueDate: next.dueDate } : null,
      enrolledOn: e.enrolledOn, completedOn: e.completedOn,
    };
  });
  const activeCourses = enrollments.filter((e) => e.status === "active");
  const completedCourses = enrollments.filter((e) => e.status === "completed");

  const certificates = t.Certificates.filter((c) => c.studentId === sid && !isHiddenCourse(c.courseId)).map((c) => ({
    certId: c.certId, courseId: c.courseId, courseTitle: courseById.get(c.courseId)?.title || c.courseId,
    issuedOn: c.issuedOn, certUrl: safeUrl(c.certUrl),
  }));

  const timeline = [
    ...enrollments.filter((e) => e.enrolledOn).map((e) => ({ title: `Enrolled in ${e.title}`, date: e.enrolledOn })),
    ...completedCourses.filter((e) => e.completedOn).map((e) => ({ title: `Completed ${e.title}`, date: e.completedOn })),
    ...certificates.filter((c) => c.issuedOn).map((c) => ({ title: `Certificate issued: ${c.courseTitle}`, date: c.issuedOn })),
  ].sort((a, b) => toTime(a.date) - toTime(b.date));

  res.json({
    student: { name: student.name, email: student.email },
    activeCourses,
    completedCourses,
    dues: myDues,
    journey: {
      activeCount: activeCourses.length,
      completedCount: completedCourses.length,
      averageProgress: enrollments.length ? Math.round(enrollments.reduce((sum, e) => sum + e.progressPct, 0) / enrollments.length) : 0,
      timeline,
    },
    payments: t.Payments.filter((p) => p.studentId === sid && !isHiddenPayment(p.paymentId)).map((p) => ({
      paymentId: p.paymentId, date: p.date, description: p.description, amount: p.amount, status: p.status, receiptUrl: safeUrl(p.receiptUrl),
    })),
    certificates,
    webinars: t.Webinars.filter((w) => !isHiddenWebinar(w.webinarId) && toTime(w.date) >= startOfToday && lower(w.status) !== "cancelled")
      .sort((a, b) => toTime(a.date) - toTime(b.date))
      .map((w) => ({ webinarId: w.webinarId, title: w.title, date: w.date, time: w.time, joinUrl: safeUrl(w.joinUrl) })),
    news: t.News.sort((a, b) => toTime(b.date) - toTime(a.date)).slice(0, NEWS_LIMIT)
      .map((n) => ({ newsId: n.newsId, title: n.title, body: n.body, date: n.date })),
  });
});

// Mounted after the public routes above: everything in here requires a login.
app.use("/api", createCourseRouter({ requireLogin, secret: SECRET }));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// ---------- static site ----------
// Whitelist only: the project root also holds server/, .env and credentials, which must never be served.
const PAGES = ["index", "courses", "course", "signin", "workspace"];
app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
for (const p of PAGES) app.get([`/${p}`, `/${p}.html`], (req, res) => res.sendFile(path.join(ROOT, `${p}.html`)));
// Partner-branded Founder's Lab pages: self-contained (inline CSS/JS, data: logos, Google Fonts) and framed by our own
// course viewer. These relaxed headers apply to this folder ONLY; the rest of the site keeps the defaults.
app.use("/content/founders-lab", (req, res, next) => {
  res.set({
    "Content-Security-Policy": [
      "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data:", "frame-ancestors 'self'",
    ].join("; "),
    "X-Frame-Options": "SAMEORIGIN",
  });
  next();
});
for (const dir of ["css", "js", "assets", "content"]) app.use(`/${dir}`, express.static(path.join(ROOT, dir), { dotfiles: "ignore" }));

// ---------- errors ----------
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // httpError()s and body-parser errors carry a client-safe 4xx; everything else becomes a generic 500.
  if (err.expose && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err.status === 400) return res.status(400).json({ error: "Bad request." });
  // Log the message only: Google errors can carry request details, never the key.
  console.error(`[${req.method} ${req.path}]`, err.code ?? "", err.message);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

// Vercel imports the app (api/index.js); only `npm start` / `node server/index.js` opens a port.
module.exports = app;
if (require.main === module) app.listen(PORT, () => console.log(`IICFE Study Hub running at http://localhost:${PORT}`));
