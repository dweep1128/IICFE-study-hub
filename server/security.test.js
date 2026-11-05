// Security checks against the real Express app, with in-memory fakes of sheets.js and Google Drive (no Google, no network).
// Covers: forged / expired / unsigned sessions, a student deactivated mid-session, files that must never be served, the security
// headers (and that vercel.json sends the same ones), the CSP hashes of the inline scripts, per-account sign-in limits,
// and the signed-in video stream (ranges, chunk cap, no Drive id in any answer).
// Usage: node server/security.test.js
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const TEST_PORT = 3997;
const SECRET = "test-secret-".padEnd(40, "x");
process.env.PORT = TEST_PORT;
process.env.SESSION_SECRET = SECRET;
process.env.LOGIN_MAX_ATTEMPTS = "3";
const BASE = `http://localhost:${TEST_PORT}`;
const ROOT = path.join(__dirname, "..");
const PW = "Fixture#Pw-1234";
const LAB = "/api/courses/F001/lab";
const DRIVE_ID = "1DriveFixtureId0123456789";
const VIDEO_SIZE = 10 * 1024 * 1024 + 123; // a little over three chunks

// ---------- fakes ----------
const tabs = {
  Students: ["S001", "S002", "S003"].map((id) => ({ studentId: id, name: `Student ${id}`, email: `${id.toLowerCase()}@lab.test`, password: PW, status: "active" })),
  Courses: [{ courseId: "F001", title: "Founder's Lab", status: "live" }],
  Enrollments: ["S001", "S002", "S003"].map((id) => ({ enrollmentId: `E-${id}`, studentId: id, courseId: "F001", status: "active" })),
  LabSessions: [{ sessionNo: "1", videoUrl: `https://drive.google.com/file/d/${DRIVE_ID}/view`, videoTitle: "Lecture 1" }],
  LabProgress: [], LabExamAttempts: [], LabChecklist: [], LabSubmissions: [], LabProfiles: [],
};
const fakeSheets = {
  readTab: async (n) => tabs[n],
  readTabs: async (names) => Object.fromEntries(names.map((n) => [n, tabs[n]])),
  appendRow: async (n, row) => { tabs[n].push({ ...row }); },
  updateRow: async (n, col, val, patch) => { const r = tabs[n].find((x) => String(x[col]) === String(val)); if (r) Object.assign(r, patch); return !!r; },
  loadCredentials: () => ({ client_email: "t@example.com", private_key: "k" }),
};
const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
stub("./sheets.js", fakeSheets);
stub("google-auth-library", { GoogleAuth: class { async getAccessToken() { return "fake-token"; } } });

// Google Drive: metadata and ranged media for the one fixture file. Every other fetch goes to the real network stack (our test server).
const realFetch = globalThis.fetch;
const driveCalls = [];
const videoByte = (i) => i % 251;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith("https://www.googleapis.com/drive/v3/files/")) return realFetch(url, opts);
  driveCalls.push({ url: u, range: opts.headers?.Range, auth: opts.headers?.Authorization });
  if (!u.includes(DRIVE_ID)) return new Response("{}", { status: 404 });
  if (!u.includes("alt=media")) return Response.json({ size: String(VIDEO_SIZE), mimeType: "video/mp4" });
  const [, s, e] = /bytes=(\d+)-(\d+)/.exec(opts.headers.Range);
  const body = Uint8Array.from({ length: Number(e) - Number(s) + 1 }, (_, i) => videoByte(Number(s) + i));
  return new Response(body, { status: 206 });
};

require("./index.js").listen(TEST_PORT);
const { rangeOf, CHUNK_BYTES } = require("./drive");

// ---------- helpers ----------
const send = async (method, p, { body, cookie, headers } = {}) => {
  const res = await realFetch(BASE + p, { method, redirect: "manual",
    headers: { "Content-Type": "application/json", ...(cookie && { Cookie: cookie }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf, text: buf.toString("utf8") };
};
const get = (p, o) => send("GET", p, o);
const login = async (id) => {
  const r = await send("POST", "/api/login", { body: { email: `${id.toLowerCase()}@lab.test`, password: PW } });
  assert.equal(r.status, 200, `login ${id}`);
  return r.headers.get("set-cookie").split(";")[0];
};
const tokenCookie = (payload, secret = SECRET, opts = {}) => `iicfe_session=${jwt.sign(payload, secret, { algorithm: "HS256", ...opts })}`;

(async () => {
  // ---- 1. the session cookie: forged, expired and unsigned tokens are all refused ----
  const me = { sid: "S001", name: "Student S001", email: "s001@lab.test" };
  for (const [why, cookie] of [
    ["no cookie", undefined],
    ["wrong secret", tokenCookie(me, "another-secret-".padEnd(40, "y"))],
    ["expired", tokenCookie({ ...me, exp: Math.floor(Date.now() / 1000) - 60 })],
    ["alg none", `iicfe_session=${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify(me)).toString("base64url")}.`],
    ["garbage", "iicfe_session=not-a-token"],
  ]) {
    for (const p of ["/api/me", "/api/workspace", `${LAB}/progress`, `${LAB}/sessions/1`, `${LAB}/sessions/1/video/stream`, "/api/courses/F001/hub"]) {
      assert.equal((await get(p, { cookie })).status, 401, `${why}: ${p}`);
    }
  }
  assert.equal((await get("/api/me", { cookie: tokenCookie(me) })).status, 200, "a valid token works");

  // ---- 2. cookies: HttpOnly, SameSite, and Secure on Vercel ----
  const setCookie = (await send("POST", "/api/login", { body: { email: "s001@lab.test", password: PW } })).headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.doesNotMatch(setCookie, /Secure/i, "plain-http localhost has no Secure flag");
  process.env.VERCEL = "1";
  assert.match((await send("POST", "/api/login", { body: { email: "s001@lab.test", password: PW } })).headers.get("set-cookie"), /Secure/i, "Secure on Vercel");
  delete process.env.VERCEL;

  // ---- 3. a student deactivated in the Sheet loses the data routes at once; /api/me stays cookie-only ----
  const s2 = await login("S002");
  assert.equal((await get(`${LAB}/progress`, { cookie: s2 })).status, 200);
  tabs.Students[1].status = "inactive";
  const off = await get(`${LAB}/progress`, { cookie: s2 });
  assert.equal(off.status, 401, "inactive student is refused");
  assert.match(off.headers.get("set-cookie") ?? "", /iicfe_session=;/, "and the cookie is cleared");
  assert.equal((await get("/api/courses/F001/hub", { cookie: s2 })).status, 401, "course routes too");
  assert.equal((await get(`${LAB}/sessions/1/video/stream`, { cookie: s2 })).status, 401, "and the video");
  tabs.Students[1].status = "active";

  // ---- 4. nothing outside the public folders is ever served ----
  for (const p of ["/.env", "/.env.example", "/server/sheets.js", "/server/credentials/service-account.json", "/server/founders-lab-tests.json",
    "/package.json", "/README.md", "/vercel.json", "/api/index.js", "/scripts/extract-founders-lab-s1.js", "/content-src/", "/css/../server/index.js", "/no-such-page"]) {
    const r = await get(p);
    assert.equal(r.status, p.startsWith("/api/") ? 401 : 404, p); // /api/* is the API (needs a session); vercel.json also 404s the file itself
    assert.ok(!/SESSION_SECRET|private_key|require\(/.test(r.text), `${p} leaks nothing`);
  }
  const notFound = await get("/no-such-page");
  assert.match(notFound.headers.get("content-type"), /text\/html/, "a friendly 404 page");
  assert.match(notFound.text, /Page not found/);
  assert.equal((await get("/api/nope")).status, 401, "unknown API paths need a session first");
  const bad = await send("POST", "/api/login", { body: undefined, headers: { "Content-Type": "application/json" } });
  assert.ok(bad.status === 400, "an empty login body is a 400");
  const broken = await realFetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
  const brokenText = await broken.text();
  assert.equal(broken.status, 400);
  assert.ok(!/at .*\.js|SyntaxError|node_modules/.test(brokenText), "no stack trace in an error");

  // ---- 5. security headers: on pages and API answers, and vercel.json sends exactly the same set ----
  const SEC = require("./security-headers.json");
  for (const p of ["/", "/session.html", "/api/health", "/no-such-page"]) {
    const h = (await get(p)).headers;
    for (const [k, v] of Object.entries(SEC)) assert.equal(h.get(k), v, `${k} on ${p}`);
    assert.equal(h.get("access-control-allow-origin"), null, `no CORS on ${p}`);
    assert.equal(h.get("x-powered-by"), null);
  }
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  assert.deepEqual(vercel.routes[0].headers, SEC, "vercel.json and server/security-headers.json must match");
  // Every inline script and inline handler in the pages must be allowed by its hash (or the page silently breaks).
  const csp = SEC["Content-Security-Policy"];
  const sha = (s) => `'sha256-${crypto.createHash("sha256").update(s, "utf8").digest("base64")}'`;
  for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>|\son[a-z]+="([^"]*)"/g)) assert.ok(csp.includes(sha(m[1] ?? m[2])), `${f}: inline code not in the CSP: ${(m[1] ?? m[2]).slice(0, 40)}`);
    assert.ok(!/drive\.google|docs\.google\.com\/spreadsheets/.test(html), `${f}: no Drive or Sheet link`);
  }

  // ---- 6. sign-in limits: per account and address, so one student's typos don't lock out the rest of the school ----
  let limited = false;
  for (let i = 0; i < 6 && !limited; i++) limited = (await send("POST", "/api/login", { body: { email: "s003@lab.test", password: "wrong" } })).status === 429;
  assert.ok(limited, "repeated wrong passwords for one account are limited");
  assert.equal((await send("POST", "/api/login", { body: { email: "s003@lab.test", password: PW } })).status, 429, "that account waits out the window");
  assert.equal((await send("POST", "/api/login", { body: { email: "s002@lab.test", password: PW } })).status, 200, "another student on the same address still signs in");

  // ---- 7. the video: byte ranges, capped chunks, private caching, no Drive id anywhere ----
  assert.deepEqual(rangeOf("bytes=0-", VIDEO_SIZE), { start: 0, end: CHUNK_BYTES - 1 });
  assert.deepEqual(rangeOf(undefined, VIDEO_SIZE), { start: 0, end: CHUNK_BYTES - 1 }, "no header = from the start");
  assert.deepEqual(rangeOf("bytes=100-199", VIDEO_SIZE), { start: 100, end: 199 });
  assert.deepEqual(rangeOf("bytes=-500", VIDEO_SIZE), { start: VIDEO_SIZE - 500, end: VIDEO_SIZE - 1 }, "suffix range");
  assert.deepEqual(rangeOf(`bytes=${VIDEO_SIZE - 10}-${VIDEO_SIZE + 999}`, VIDEO_SIZE), { start: VIDEO_SIZE - 10, end: VIDEO_SIZE - 1 }, "clamped to the end");
  for (const h of ["bytes=-", `bytes=${VIDEO_SIZE}-`, "bytes=50-10", "bytes=0-1,5-9", "items=0-1", "bytes=abc-"]) assert.equal(rangeOf(h, VIDEO_SIZE), null, h);

  const s1 = await login("S001");
  const STREAM = `${LAB}/sessions/1/video/stream`;
  const first = await get(STREAM, { cookie: s1, headers: { Range: "bytes=0-" } });
  assert.equal(first.status, 206);
  assert.equal(first.headers.get("content-range"), `bytes 0-${CHUNK_BYTES - 1}/${VIDEO_SIZE}`);
  assert.equal(first.buf.length, CHUNK_BYTES, "one chunk, under Vercel's 4.5 MB response limit");
  assert.ok(CHUNK_BYTES < 4.5 * 1000 * 1000);
  assert.equal(first.headers.get("content-type"), "video/mp4");
  assert.equal(first.headers.get("accept-ranges"), "bytes");
  assert.match(first.headers.get("cache-control"), /private/, "never cached by the CDN");
  assert.ok(first.buf.every((b, i) => b === videoByte(i)), "the right bytes");
  const tail = await get(STREAM, { cookie: s1, headers: { Range: `bytes=${VIDEO_SIZE - 100}-` } });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get("content-range"), `bytes ${VIDEO_SIZE - 100}-${VIDEO_SIZE - 1}/${VIDEO_SIZE}`, "seeking to the end works");
  assert.ok(tail.buf.every((b, i) => b === videoByte(VIDEO_SIZE - 100 + i)));
  const nope = await get(STREAM, { cookie: s1, headers: { Range: `bytes=${VIDEO_SIZE}-` } });
  assert.equal(nope.status, 416);
  assert.equal(nope.headers.get("content-range"), `bytes */${VIDEO_SIZE}`);
  assert.ok(driveCalls.every((c) => c.auth === "Bearer fake-token"), "Drive is called with the service account's token");
  for (const r of [first, tail, nope]) for (const [k, v] of r.headers) assert.ok(!v.includes(DRIVE_ID), `no Drive id in header ${k}`);
  const detail = await get(`${LAB}/sessions/1`, { cookie: s1 });
  assert.equal(JSON.parse(detail.text).video.src, STREAM);
  assert.ok(!detail.text.includes(DRIVE_ID), "no Drive id in the session detail");
  // Drive refusing the file (unshared, deleted) is a plain 503 for the player, with nothing from Google in it.
  tabs.LabSessions[0].videoUrl = "https://drive.google.com/file/d/1MissingFile0123456789/view";
  const gone = await get(STREAM, { cookie: s1 });
  assert.equal(gone.status, 503);
  assert.ok(!gone.text.includes("1MissingFile"), "the error doesn't echo the id");

  console.log("security tests passed");
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
