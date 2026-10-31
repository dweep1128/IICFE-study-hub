// Timeout + one-retry behaviour of server/sheets.js against a fake Google client (no network).
// Usage: node server/sheets.test.js
const assert = require("node:assert/strict");

process.env.SHEETS_TIMEOUT_MS = "150";
process.env.SHEET_ID = "test-sheet";
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "t@example.com", private_key: "k" });

let behaviour; // what the next calls do: a list of "ok" | "hang" | an error to throw
const calls = { batchGet: 0, append: 0 };
const next = (kind) => {
  const step = behaviour[Math.min(calls[kind]++, behaviour.length - 1)];
  if (step === "hang") return new Promise(() => {});
  if (step === "ok") return Promise.resolve({ data: { valueRanges: [{ values: [["a"], ["1"]] }], values: [["a"]] } });
  return Promise.reject(step);
};
const updates = [];
const fakeApi = { spreadsheets: { values: {
  batchGet: () => next("batchGet"),
  get: () => Promise.resolve({ data: { values: [["k", "v"], ["1", "open"], ["2", "closed"]] } }),
  append: () => next("append"),
  update: (req) => { updates.push(req.requestBody.values[0]); return Promise.resolve({}); },
} } };
const gPath = require.resolve("googleapis");
require.cache[gPath] = { id: gPath, filename: gPath, loaded: true, exports: { google: { auth: { GoogleAuth: class {} }, sheets: () => fakeApi } } };
const sheets = require("./sheets");

const err = (code, message = code) => Object.assign(new Error(message), { code });
const reset = (...steps) => { behaviour = steps; calls.batchGet = 0; calls.append = 0; };
const quiet = console.error; // the module logs every failure; keep the test output readable
console.error = () => {};

(async () => {
  reset("ok");
  assert.deepEqual(await sheets.readTab("T"), [{ a: "1" }]);
  assert.equal(calls.batchGet, 1, "a healthy call is made once");

  reset(err("ETIMEDOUT"), "ok");
  assert.deepEqual(await sheets.readTab("T"), [{ a: "1" }]);
  assert.equal(calls.batchGet, 2, "a transient failure is retried once");

  reset(err(503), "ok");
  await sheets.readTab("T");
  assert.equal(calls.batchGet, 2, "HTTP 503 is retried");

  reset("hang", "ok");
  await sheets.readTab("T");
  assert.equal(calls.batchGet, 2, "a hung call times out, then is retried");

  reset("hang");
  await assert.rejects(sheets.readTab("T"), (e) => e.code === "ETIMEDOUT", "a call that hangs twice fails with ETIMEDOUT");
  assert.equal(calls.batchGet, 2, "...after exactly one retry");

  reset(err(403, "denied"), "ok");
  await assert.rejects(sheets.readTab("T"), /denied/);
  assert.equal(calls.batchGet, 1, "a permanent error (403) is not retried");

  reset("hang", "ok");
  await assert.rejects(sheets.appendRow("T", { k: "1" }), (e) => e.code === "ETIMEDOUT");
  assert.equal(calls.append, 1, "an append that timed out is NOT retried (the row may already exist)");

  reset(err("ENOTFOUND"), "ok");
  await sheets.appendRow("T", { k: "1" });
  assert.equal(calls.append, 2, "an append that never left this machine IS retried");

  // updateRow's guard sees the current row and can veto the write
  assert.equal(await sheets.updateRow("T", "k", "1", { v: "x" }, (row) => row.v === "open"), true);
  assert.deepEqual(updates, [["1", "x"]], "guard passed: written");
  assert.equal(await sheets.updateRow("T", "k", "2", { v: "x" }, (row) => row.v === "open"), false);
  assert.equal(updates.length, 1, "guard vetoed: nothing written");
  assert.equal(await sheets.updateRow("T", "k", "9", { v: "x" }, () => true), false, "no such row");

  console.error = quiet;
  console.log("sheets tests passed");
  process.exit(0);
})().catch((e) => { console.error = quiet; console.error(e); process.exit(1); });
