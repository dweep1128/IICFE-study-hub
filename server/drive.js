// Streams a Google Drive file to a signed-in student, so the browser never sees a Drive link or file id.
// The file stays restricted in Drive (shared with the service account only); the caller has already checked the session and enrolment.
//
// Vercel caps a function's response body at 4.5 MB, so every answer is one HTTP range of at most CHUNK_BYTES. A <video> element asks for
// ranges anyway and simply asks again for the next part, so playback and seeking work with no client code.
const { Readable } = require("stream");
const { loadCredentials } = require("./sheets");

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
const FILES_API = "https://www.googleapis.com/drive/v3/files";
const CHUNK_BYTES = 3 * 1024 * 1024; // under Vercel's 4.5 MB response limit, small enough to start fast and seek quickly
const META_CACHE_MS = 10 * 60 * 1000; // size and type rarely change; a replaced file shows within this time
const DRIVE_TIMEOUT_MS = Number(process.env.DRIVE_TIMEOUT_MS) || 15_000;
const PLAYABLE = /^(video|audio)\//;

let auth;
const client = () => {
  if (auth) return auth;
  const credentials = loadCredentials();
  if (!credentials) throw Object.assign(new Error("No service account credentials found"), { kind: "NO_KEY" });
  const { GoogleAuth } = require("google-auth-library");
  auth = new GoogleAuth({ credentials, scopes: SCOPES }); // one client per instance: the token is reused until it expires
  return auth;
};
const authHeaders = async () => ({ Authorization: `Bearer ${await client().getAccessToken()}` });

// fileId -> { at, size, mimeType }
const metaCache = new Map();
async function metaOf(fileId) {
  const hit = metaCache.get(fileId);
  if (hit && Date.now() - hit.at < META_CACHE_MS) return hit;
  const res = await fetch(`${FILES_API}/${encodeURIComponent(fileId)}?fields=size,mimeType&supportsAllDrives=true`,
    { headers: await authHeaders(), signal: AbortSignal.timeout(DRIVE_TIMEOUT_MS) });
  if (!res.ok) throw Object.assign(new Error(`Drive metadata ${res.status}`), { status: res.status });
  const m = await res.json();
  const meta = { at: Date.now(), size: Number(m.size), mimeType: String(m.mimeType ?? "") };
  if (!Number.isSafeInteger(meta.size) || meta.size <= 0 || !PLAYABLE.test(meta.mimeType)) throw new Error("Drive file is not a playable media file");
  metaCache.set(fileId, meta);
  return meta;
}

/**
 * The byte range to send for a Range header ("bytes=0-", "bytes=500-999", "bytes=-500"), capped at CHUNK_BYTES.
 * No header means "from the start". Returns null when the range can't be satisfied. Only a single range is supported.
 */
function rangeOf(header, size) {
  let start = 0, end = size - 1;
  if (header) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
    if (!m || (m[1] === "" && m[2] === "")) return null;
    if (m[1] === "") { start = Math.max(0, size - Number(m[2])); } // suffix: the last N bytes
    else { start = Number(m[1]); if (m[2] !== "") end = Math.min(end, Number(m[2])); }
  }
  if (!Number.isSafeInteger(start) || start >= size || end < start) return null;
  return { start, end: Math.min(end, start + CHUNK_BYTES - 1) };
}

/** Answers one range of the file as a 206. Errors before any byte is sent are thrown; after that the stream is simply cut. */
async function streamFile(fileId, req, res) {
  const { size, mimeType } = await metaOf(fileId);
  const range = rangeOf(req.headers.range, size);
  if (!range) {
    res.set("Content-Range", `bytes */${size}`);
    return res.status(416).end();
  }
  // One deadline for the whole chunk (headers and body), so a stalled Google read can't hold the function open.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DRIVE_TIMEOUT_MS);
  res.on("close", () => { clearTimeout(timer); ctrl.abort(); }); // also when the player moves on (a seek): stop reading from Google
  const upstream = await fetch(`${FILES_API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers: { ...(await authHeaders()), Range: `bytes=${range.start}-${range.end}` }, signal: ctrl.signal });
  const whole = range.start === 0 && range.end === size - 1;
  if (upstream.status !== 206 && !(upstream.status === 200 && whole)) {
    clearTimeout(timer);
    throw Object.assign(new Error(`Drive media ${upstream.status}`), { status: upstream.status });
  }
  res.status(206).set({
    "Content-Type": mimeType,
    "Content-Length": String(range.end - range.start + 1),
    "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store", // a signed-in student's copy only: never kept by the CDN or a shared cache
    "Content-Disposition": "inline",
  });
  Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
}

module.exports = { streamFile, rangeOf, CHUNK_BYTES };
