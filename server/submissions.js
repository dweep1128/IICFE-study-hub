// A student's submissions (proof for a journey item, a required document, a session upload slot). Pure helpers, no Sheets and no Express.
//
// Today a submission is a pasted https link, stored as one row per submission in the LabSubmissions tab. Every row carries a status
// (submitted / approved / changes_requested) plus reviewer fields, so a mentor review page can be added later WITHOUT changing the data:
// it would only write those columns. A link counts as soon as it is submitted; only "changes_requested" takes it back.
// To store real files later (for example Google Drive), only the "where does the file live" part changes: `url` would point at the stored file.

const STATUSES = ["submitted", "approved", "changes_requested"];
const UPLOAD_TYPES = ["checkpoint", "document", "activity"];
const MAX_URL_LENGTH = 500;
const MAX_NAME_LENGTH = 120;

/** Returns { url, error }. Accepts any https link; refuses anything else, links with a login in them, and over-long ones. */
function checkLink(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { error: "Paste a link to your file." };
  if (text.length > MAX_URL_LENGTH) return { error: `That link is too long (up to ${MAX_URL_LENGTH} characters).` };
  let u;
  try { u = new URL(text); } catch { return { error: "Use a full link starting with https://" }; }
  if (u.protocol !== "https:" || !u.hostname.includes(".")) return { error: "Use a full link starting with https://" };
  if (u.username || u.password) return { error: "Remove the username or password from the link." };
  return { url: u.href };
}

/** A readable name for a link: its last path segment (decoded), else the host. */
function nameFromLink(href) {
  const u = new URL(href);
  const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
  let name = last;
  try { name = decodeURIComponent(last); } catch { /* keep the raw segment */ }
  // Drive/Docs share links end in an id or "view"/"edit": not a useful name, so show the host instead.
  const useful = name && !/^(view|edit|preview|open|sharing|d)$/i.test(name) && !/^[\w-]{25,}$/.test(name);
  return (useful ? name : u.hostname.replace(/^www\./, "")).slice(0, MAX_NAME_LENGTH);
}

/** Latest submission (highest version) per `type:itemId`, from a student's rows. */
function latestByItem(rows) {
  const out = new Map();
  for (const r of rows) {
    const key = `${r.uploadType}:${r.itemId}`;
    const prev = out.get(key);
    if (!prev || Number(r.version) > Number(prev.version)) out.set(key, r);
  }
  return out;
}

const statusOf = (row) => (STATUSES.includes(row.status) ? row.status : "submitted");

/** What the browser needs to draw a submission (name, time, status, note). */
const toView = (r) => ({
  id: r.subId,
  uploadType: r.uploadType,
  itemId: r.itemId,
  itemLabel: r.itemLabel,
  sessionNo: r.sessionNo === "" || r.sessionNo == null ? null : Number(r.sessionNo),
  url: r.url,
  fileName: r.fileName,
  version: Number(r.version) || 1,
  status: statusOf(r),
  reviewNote: r.reviewNote ?? "",
  submittedAt: r.submittedAt,
  reviewedAt: r.reviewedAt ?? "",
});

/** A submission counts (completes its item) unless a reviewer asked for changes. */
const counts = (row) => statusOf(row) !== "changes_requested";

module.exports = { STATUSES, UPLOAD_TYPES, checkLink, nameFromLink, latestByItem, toView, counts, statusOf };
