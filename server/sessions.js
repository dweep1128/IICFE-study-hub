// Sessions: the timeline and what a session page needs. Pure helpers (no Sheets, no Express).
// The staff keep sessions in the LabSessions tab; founders-lab-sessions.json supplies the names and the locked defaults, and the
// native Session 1 (content/founders-lab/s1) supplies its title, date and the names of its four games. A Sheet row wins field by field.
const defaults = require("./founders-lab-sessions.json").sessions;
const s1 = require("../content/founders-lab/s1/session.json");

const QUIZ_OPTIONS = 4;
const QUIZ_LENGTH = 10;
const PITCH_TIMER_SEED = /3-minute timer/i; // a session whose instructions mention it gets the pitch timer
const DESCRIPTION_ACTIVITIES = 3;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

const isTrue = (v) => /^(true|yes|y|1|x|open)$/i.test(String(v ?? "").trim());
const lines = (s) => String(s ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const safeHttp = (v) => (/^https?:\/\//i.test(String(v ?? "").trim()) ? String(v).trim() : "");
/**
 * The embeddable form of a lecture link: { provider, embedUrl } for YouTube, Vimeo or a Google Drive file, else null.
 * Only an id taken from the link is put into a fixed embed address, so nothing else from the Sheet reaches an iframe, and nothing autoplays.
 */
function parseVideo(raw) {
  let u;
  try { u = new URL(String(raw ?? "").trim()); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^(www|m)\./, "");
  const seg = u.pathname.split("/").filter(Boolean);
  const YT_ID = /^[\w-]{11}$/, NUM_ID = /^\d{6,12}$/, DRIVE_ID = /^[\w-]{10,80}$/;
  if (host === "youtu.be" && YT_ID.test(seg[0] ?? "")) return { provider: "youtube", embedUrl: `https://www.youtube.com/embed/${seg[0]}` };
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const id = seg[0] === "watch" ? u.searchParams.get("v") : ["embed", "shorts", "live", "v"].includes(seg[0]) ? seg[1] : null;
    return YT_ID.test(id ?? "") ? { provider: "youtube", embedUrl: `https://www.youtube.com/embed/${id}` } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = seg.find((x) => NUM_ID.test(x));
    const hash = host === "vimeo.com" ? seg[seg.indexOf(id) + 1] : u.searchParams.get("h"); // a private video's link carries a hash
    return id ? { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${id}${/^[\da-f]{6,}$/i.test(hash ?? "") ? `?h=${hash}` : ""}` } : null;
  }
  if (host === "drive.google.com") {
    const id = seg[0] === "file" && seg[1] === "d" ? seg[2] : u.searchParams.get("id");
    return DRIVE_ID.test(id ?? "") ? { provider: "drive", embedUrl: `https://drive.google.com/file/d/${id}/preview` } : null;
  }
  return null;
}

const idOf = (no) => `s${no}`; // the manifest's id for session `no`, used for lab progress rows

/** "YYYY-MM-DD" from an ISO date or any text Date can read ("1 Oct 2026"); "" for "TBD" and anything unreadable. */
function isoDay(v) {
  const s = String(v ?? "").trim();
  if (ISO_DAY.test(s)) return s.slice(0, 10);
  const t = Date.parse(`${s} UTC`);
  return s && Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : "";
}

function parseActivities(s) {
  return lines(s).map((l) => {
    const i = l.lastIndexOf("|");
    return i < 0 ? { text: l, time: "" } : { text: l.slice(0, i).trim(), time: l.slice(i + 1).trim() };
  });
}

/** Recap cell: plain lines are the recap, "- " lines are the key takeaways. */
function parseRecap(s) {
  const all = lines(s);
  return { recap: all.filter((l) => !l.startsWith("- ")).join(" "), takeaways: all.filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim()) };
}

const isQuestion = (o) => !!o && typeof o.q === "string" && Array.isArray(o.options) && o.options.length === QUIZ_OPTIONS && o.options.every((v) => typeof v === "string")
  && Number.isInteger(o.answer) && o.answer >= 0 && o.answer < QUIZ_OPTIONS && typeof o.explain === "string";
function parseQuiz(json) {
  try { const v = JSON.parse(json || "[]"); return Array.isArray(v) ? v.filter(isQuestion).slice(0, QUIZ_LENGTH) : []; } catch { return []; }
}

const describe = (activities) => {
  const titles = activities.slice(0, DESCRIPTION_ACTIVITIES).map((a) => a.text.split(" - ")[0].trim());
  return titles.join(" · ") + (activities.length > DESCRIPTION_ACTIVITIES ? " · …" : "");
};

/** The full session list: defaults overlaid with Sheet rows, sorted by number. A Sheet row for a number the defaults lack adds a session. */
function buildSessions(rows) {
  const byNo = new Map(defaults.map((d) => [d.no, { ...d }]));
  const base1 = byNo.get(1);
  Object.assign(base1, { name: s1.session.title, date: s1.session.date, time: s1.session.time, activities: s1.activities.games.map((g) => g.title).join("\n") });
  for (const r of rows) {
    const no = Number(r.sessionNo);
    if (!Number.isInteger(no) || no < 1) continue;
    const cur = byNo.get(no) ?? { no };
    for (const k of ["name", "phase", "date", "time", "duration", "readingUrl", "activities", "instructions", "output", "recap", "quizJson", "uploadSlots", "videoUrl", "videoTitle"]) {
      if (String(r[k] ?? "").trim() !== "") cur[k] = String(r[k]);
    }
    if (String(r.visible ?? "").trim() !== "") cur.visible = isTrue(r.visible);
    byNo.set(no, cur);
  }
  return [...byNo.values()].filter((s) => s.name).sort((a, b) => a.no - b.no).map((s) => ({
    no: s.no, name: s.name, phase: s.phase ?? "", date: s.date ?? "", time: s.time ?? "", duration: s.duration ?? "", visible: s.visible === true,
    readingUrl: safeHttp(s.readingUrl), activities: parseActivities(s.activities), instructions: String(s.instructions ?? "").trim(),
    outputs: lines(s.output), ...parseRecap(s.recap), slots: lines(s.uploadSlots), quiz: parseQuiz(s.quizJson),
    video: parseVideo(s.videoUrl) && { ...parseVideo(s.videoUrl), title: String(s.videoTitle ?? "").trim() },
  }));
}

/** The next visible session whose date is today or later. Locked sessions never count: their dates stay hidden from students. */
function nextSession(sessions, today) {
  return sessions
    .filter((s) => s.visible && isoDay(s.date) && isoDay(s.date) >= today)
    .sort((a, b) => isoDay(a.date).localeCompare(isoDay(b.date)) || a.no - b.no)
    .map((s) => ({ no: s.no, name: s.name, date: isoDay(s.date), time: s.time }))[0] ?? null;
}

/** The steps a student can finish in a session, only those the session actually has: [{ key, label, done }]. */
function stepsOf(s, state) {
  const steps = [];
  if (s.video) steps.push({ key: "video", label: "video", done: state.videoWatched === true });
  if (s.outputs.length) steps.push({ key: "outputs", label: "outputs", done: s.outputs.every((_, i) => state.ticked.includes(i)) });
  if (state.native || s.quiz.length) steps.push({ key: "quiz", label: state.native ? "final exam" : "quiz", done: state.native ? state.examDone : state.quizAttempts > 0 });
  if (s.slots.length) steps.push({ key: "uploads", label: "uploads", done: state.uploadCount === s.slots.length, count: state.uploadCount, total: s.slots.length });
  return steps;
}

/** Grades on the server so the answers never reach the browser before an attempt. `answers[i]` is an option index or -1. */
function gradeQuiz(quiz, answers) {
  if (!Array.isArray(answers) || answers.length !== quiz.length || !answers.every((a) => Number.isInteger(a) && a >= -1 && a < QUIZ_OPTIONS)) return null;
  const review = quiz.map((q, i) => ({ correct: q.answer, chosen: answers[i], explain: q.explain }));
  return { score: review.filter((r) => r.chosen === r.correct).length, total: quiz.length, review };
}

module.exports = { parseVideo, buildSessions, nextSession, stepsOf, gradeQuiz, isoDay, idOf, describe, PITCH_TIMER_SEED, QUIZ_LENGTH };
