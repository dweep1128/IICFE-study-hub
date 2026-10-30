// The ONLY file that talks to Google Sheets. To move to a real database later, reimplement
// readTab / readTabs / appendRow / updateRow here and nothing else changes.
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const KEY_FILE = path.resolve(process.env.GOOGLE_KEY_FILE || path.join(__dirname, "credentials", "service-account.json"));
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

// Credentials come from GOOGLE_SERVICE_ACCOUNT_JSON (hosting dashboards) or the local key file.
function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? (fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, "utf8") : null);
  if (raw == null) return null;
  const creds = JSON.parse(raw);
  // Pasted env vars often carry a literal backslash-n instead of real newlines in the private key.
  if (typeof creds.private_key === "string") creds.private_key = creds.private_key.replace(/\\n/g, "\n");
  return creds;
}

let api;
const client = () => {
  if (api) return api;
  const credentials = loadCredentials();
  if (!credentials) throw Object.assign(new Error("No service account credentials found"), { kind: "NO_KEY" });
  api = google.sheets({ version: "v4", auth: new google.auth.GoogleAuth({ credentials, scopes: SCOPES }) });
  return api;
};

const spreadsheetId = () => {
  if (!process.env.SHEET_ID) throw new Error("SHEET_ID is not set (see .env)");
  return process.env.SHEET_ID;
};
const range = (tab) => `'${tab.replace(/'/g, "''")}'`;

// ---------- timeout + one retry for every runtime Google call ----------
// A hung or flaky Google call must not hang a page: each call gets SHEETS_TIMEOUT_MS and, if it fails for a transient reason,
// one more try after RETRY_DELAY_MS. The real error is always logged server-side (message only: Google errors can carry request details).
// Calls that add a row (`appendsRow`) are retried only when the failure happened BEFORE Google could have received the request;
// after a timeout the row may already exist, and a blind retry would duplicate it.
const SHEETS_TIMEOUT_MS = Number(process.env.SHEETS_TIMEOUT_MS) || 8000; // env override exists for the test suite
const RETRY_DELAY_MS = 400;
const HTTP_TRANSIENT = new Set([429, 500, 502, 503, 504]);
const NEVER_SENT = /ENOTFOUND|ECONNREFUSED|EAI_AGAIN/;
const timeoutError = (label) => Object.assign(new Error(`Google Sheets did not answer within ${SHEETS_TIMEOUT_MS / 1000}s (${label})`), { code: "ETIMEDOUT" });

function withTimeout(label, work) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError(label)), SHEETS_TIMEOUT_MS); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const isTransient = (err) =>
  HTTP_TRANSIENT.has(Number(err.code ?? err.response?.status)) || /ETIMEDOUT|ECONNRESET|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up/i.test(`${err.code ?? ""} ${err.message}`);

async function guarded(label, call, { appendsRow = false } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTimeout(label, call());
    } catch (err) {
      const retry = attempt === 1 && isTransient(err) && (!appendsRow || NEVER_SENT.test(`${err.code ?? ""} ${err.message}`));
      console.error(`[sheets] ${label} failed (attempt ${attempt}${retry ? ", retrying" : ""}):`, err.code ?? "", err.message);
      if (!retry) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}

// Rows -> objects keyed by the header row. Blank rows are dropped; missing cells become "".
function toObjects(values = []) {
  const [headers = [], ...rows] = values;
  return rows
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

// One API call for several tabs: Sheets allows ~60 reads/min per user, so batch where possible.
async function readTabs(names) {
  const res = await guarded(`read ${names.join(",")}`, () => client().spreadsheets.values.batchGet({ spreadsheetId: spreadsheetId(), ranges: names.map(range) }));
  return Object.fromEntries(res.data.valueRanges.map((vr, i) => [names[i], toObjects(vr.values)]));
}

const readTab = async (name) => (await readTabs([name]))[name];

async function headersOf(name) {
  const res = await guarded(`headers ${name}`, () => client().spreadsheets.values.get({ spreadsheetId: spreadsheetId(), range: `${range(name)}!1:1` }));
  const headers = res.data.values?.[0] ?? [];
  if (!headers.length) throw new Error(`Tab "${name}" has no header row. Run: npm run seed`);
  return headers;
}

function assertKnownColumns(headers, obj, name) {
  const unknown = Object.keys(obj).filter((k) => !headers.includes(k));
  if (unknown.length) throw new Error(`Unknown column(s) for "${name}": ${unknown.join(", ")}`);
}

// RAW input: values are stored as typed, so "=SUM(...)" from user input can never run as a formula.
async function appendRows(name, objs) {
  if (!objs.length) return;
  const headers = await headersOf(name);
  objs.forEach((o) => assertKnownColumns(headers, o, name));
  await guarded(`append ${name}`, () => client().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${range(name)}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: objs.map((o) => headers.map((h) => o[h] ?? "")) },
  }), { appendsRow: true });
}

const appendRow = (name, obj) => appendRows(name, [obj]);

// Returns true if a row matched keyColumn === keyValue and was patched, false otherwise.
async function updateRow(name, keyColumn, keyValue, patch) {
  const res = await guarded(`read ${name}`, () => client().spreadsheets.values.get({ spreadsheetId: spreadsheetId(), range: range(name) }));
  const [headers = [], ...rows] = res.data.values ?? [];
  const keyIdx = headers.indexOf(keyColumn);
  if (keyIdx < 0) throw new Error(`Tab "${name}" has no column "${keyColumn}"`);
  assertKnownColumns(headers, patch, name);
  const idx = rows.findIndex((r) => String(r[keyIdx] ?? "") === String(keyValue));
  if (idx < 0) return false;
  const row = headers.map((h, i) => (h in patch ? patch[h] : rows[idx][i] ?? ""));
  await guarded(`update ${name}`, () => client().spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${range(name)}!A${idx + 2}`, // +1 for the header row, +1 for 1-based rows
    valueInputOption: "RAW",
    requestBody: { values: [row] },
  }));
  return true;
}

// Seed support: create the tab if missing and write headers if row 1 is empty.
async function ensureTab(name, headers) {
  const id = spreadsheetId();
  const meta = await client().spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
  const exists = meta.data.sheets.some((s) => s.properties.title === name);
  if (!exists) {
    await client().spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ addSheet: { properties: { title: name } } }] } });
  }
  const current = await client().spreadsheets.values.get({ spreadsheetId: id, range: `${range(name)}!1:1` });
  const existing = current.data.values?.[0] ?? [];
  // Empty row 1, or an older header row that is a prefix of the new one (columns were appended): (re)write it.
  const extend = existing.length < headers.length && existing.every((h, i) => h === headers[i]);
  if (extend) {
    await client().spreadsheets.values.update({
      spreadsheetId: id, range: `${range(name)}!A1`, valueInputOption: "RAW", requestBody: { values: [headers] },
    });
  }
  return { created: !exists, headersWritten: extend && existing.length === 0, headersExtended: extend && existing.length > 0 };
}

// Renames a header cell in place (data below it is untouched). Returns false when there is nothing to rename.
async function renameColumn(name, from, to) {
  const headers = await headersOf(name);
  const i = headers.indexOf(from);
  if (i < 0 || headers.includes(to)) return false;
  headers[i] = to;
  await client().spreadsheets.values.update({
    spreadsheetId: spreadsheetId(), range: `${range(name)}!A1`, valueInputOption: "RAW", requestBody: { values: [headers] },
  });
  return true;
}

// Deletes the first row where keyColumn === keyValue. Returns false when nothing matched.
async function deleteRow(name, keyColumn, keyValue) {
  const id = spreadsheetId();
  const res = await client().spreadsheets.values.get({ spreadsheetId: id, range: range(name) });
  const [headers = [], ...rows] = res.data.values ?? [];
  const keyIdx = headers.indexOf(keyColumn);
  if (keyIdx < 0) throw new Error(`Tab "${name}" has no column "${keyColumn}"`);
  const idx = rows.findIndex((r) => String(r[keyIdx] ?? "") === String(keyValue));
  if (idx < 0) return false;
  const meta = await client().spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties(sheetId,title)" });
  const sheetId = meta.data.sheets.find((x) => x.properties.title === name)?.properties.sheetId;
  await client().spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: idx + 1, endIndex: idx + 2 } } }] }, // row 0 is the header
  });
  return true;
}

// Only the public address, so errors can tell the user which account to share the sheet with.
function serviceAccountEmail() {
  try { return loadCredentials()?.client_email ?? null; } catch { return null; }
}

const hasCredentials = () => process.env.GOOGLE_SERVICE_ACCOUNT_JSON != null || fs.existsSync(KEY_FILE);

// Tab titles currently in the spreadsheet (also proves auth, API access, sharing and sheet ID).
async function listTabs() {
  const res = await client().spreadsheets.get({ spreadsheetId: spreadsheetId(), fields: "properties.title,sheets.properties.title" });
  return { title: res.data.properties.title, tabs: res.data.sheets.map((s) => s.properties.title) };
}

async function readHeaders(names) {
  const res = await client().spreadsheets.values.batchGet({ spreadsheetId: spreadsheetId(), ranges: names.map((n) => `${range(n)}!1:1`) });
  return Object.fromEntries(res.data.valueRanges.map((vr, i) => [names[i], vr.values?.[0] ?? []]));
}

// Turns a Google/Node error into { kind, problem, fix }. Never includes the key or request details.
function diagnose(err) {
  const status = Number(err.code ?? err.response?.status) || 0;
  const msg = String(err.response?.data?.error?.message ?? err.message ?? "");
  const email = serviceAccountEmail() ?? "the service account's client_email";

  if (err.kind === "NO_KEY") return { kind: "NO_KEY", problem: "No service account key found.",
    fix: "Save the JSON key at server/credentials/service-account.json (local) or set GOOGLE_SERVICE_ACCOUNT_JSON (hosting)." };
  if (err instanceof SyntaxError) return { kind: "BAD_KEY", problem: "The key is not valid JSON.",
    fix: "Re-download the key from Google Cloud (IAM > Service Accounts > Keys > Add key > JSON) and save it unchanged." };
  if (/SHEET_ID is not set/.test(msg)) return { kind: "NO_SHEET_ID", problem: "SHEET_ID is missing.", fix: "Set SHEET_ID in .env (the long id in the sheet's URL between /d/ and /edit)." };
  if (/not supported for this document/i.test(msg)) return { kind: "NOT_NATIVE_SHEET", problem: "That ID is an Excel/other file, not a native Google Sheet.",
    fix: "Open the file in Drive and use File > Save as Google Sheets, then use the new sheet's ID." };
  if (status === 403 && /has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(msg + JSON.stringify(err.response?.data?.error?.details ?? ""))) {
    const project = (msg.match(/project[ =](\d+)/i) ?? [])[1];
    return { kind: "API_DISABLED", problem: "The Google Sheets API is disabled for the service account's Google Cloud project.",
      fix: "Enable \"Google Sheets API\" for the project that owns the key: " +
        (project ? `https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=${project}` : "Google Cloud Console > APIs & Services > Library > Google Sheets API > Enable") + ". Wait a minute, then retry." };
  }
  if (status === 403) return { kind: "NOT_SHARED", problem: "Permission denied: the service account can't access this sheet.",
    fix: `Open the Google Sheet > Share > add ${email} as Editor (not Viewer).` };
  if (status === 404) return { kind: "WRONG_SHEET_ID", problem: "Sheet not found: SHEET_ID is wrong (or the sheet was deleted).",
    fix: "Copy the id from the sheet's URL (between /d/ and /edit) into SHEET_ID in .env." };
  if (status === 401 || /invalid_grant|invalid_client|invalid_rapt|unauthorized_client|DECODER|PEM|private key/i.test(msg)) {
    return { kind: "AUTH_FAILED", problem: "Google rejected the service account credentials.",
      fix: "The key may be deleted/disabled, corrupted, or the PC clock is wrong. Create a fresh JSON key for the service account and replace the file. Check your system time is correct." };
  }
  if (status === 429) return { kind: "QUOTA", problem: "Google Sheets rate limit hit.", fix: "Wait a minute and retry." };
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|fetch failed/i.test(msg + (err.code ?? ""))) {
    return { kind: "NETWORK", problem: "Can't reach Google.", fix: "Check your internet connection / proxy / firewall." };
  }
  return { kind: "UNKNOWN", problem: msg || "Unknown error", fix: "See the message above." };
}

module.exports = { readTab, readTabs, appendRow, appendRows, updateRow, deleteRow, renameColumn, ensureTab, listTabs, readHeaders, diagnose, serviceAccountEmail, hasCredentials, KEY_FILE };
