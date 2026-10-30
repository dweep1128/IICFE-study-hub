// Small pure helpers shared by the server files.
const lower = (v) => String(v ?? "").trim().toLowerCase();
const clampPct = (v) => Math.min(100, Math.max(0, Number(v) || 0));
const toTime = (d) => Date.parse(d) || 0;
// Sheet content is editable by staff, so never hand a javascript: (or other) URL to the browser.
const safeUrl = (u) => (/^https?:\/\//i.test(String(u ?? "").trim()) ? String(u).trim() : "");
// Retired demo rows. They stay in the Google Sheet but are never read or served (and the seed no longer creates them).
const HIDDEN_COURSE_IDS = new Set(["C001"]);
const HIDDEN_WEBINAR_IDS = new Set(["W001"]);
const HIDDEN_PAYMENT_IDS = new Set(["P001"]);
const isHiddenCourse = (id) => HIDDEN_COURSE_IDS.has(String(id));
const isHiddenWebinar = (id) => HIDDEN_WEBINAR_IDS.has(String(id));
const isHiddenPayment = (id) => HIDDEN_PAYMENT_IDS.has(String(id));
const ID_RE = /^[\w-]{1,40}$/;
const isId = (v) => typeof v === "string" && ID_RE.test(v);

// Error whose message is safe to show the client (the error handler in index.js returns it as-is).
const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });

const parseJson = (str, fallback) => { try { return JSON.parse(str); } catch { return fallback; } };

// Study text is stored as plain paragraphs separated by blank lines. Whitespace is normalised so the
// browser's text selection offsets and the server's validation always agree on the same string.
const paragraphsOf = (content) =>
  String(content ?? "").split(/\r?\n\s*\r?\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);

// Course progress is derived ONLY from ModuleProgress: completed modules / total modules.
// (Enrollments.progressPct is no longer used for display, so every page shows the same number.)
function progressFor(modules, myProgress) {
  const byId = new Map(myProgress.map((p) => [p.moduleId, p]));
  const list = [...modules].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)).map((m) => ({
    moduleId: m.moduleId, title: m.title, order: Number(m.order) || 0, hours: Number(m.hours) || 0, summary: m.summary,
    status: lower(byId.get(m.moduleId)?.status) || "upcoming", completedOn: byId.get(m.moduleId)?.completedOn ?? "",
  }));
  const completed = list.filter((m) => m.status === "complete").length;
  return {
    modules: list, completed, total: list.length,
    percent: list.length ? Math.round((completed / list.length) * 100) : 0,
    current: list.find((m) => m.status === "in_progress") ?? list.find((m) => m.status === "upcoming") ?? null,
  };
}

module.exports = { isHiddenCourse, isHiddenWebinar, isHiddenPayment, progressFor, lower, clampPct, toTime, safeUrl, isId, httpError, parseJson, paragraphsOf };
