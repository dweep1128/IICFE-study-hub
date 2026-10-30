// Verifies the whole Google Sheets chain and says plainly what to fix. Exit 0 = ready.
try { process.loadEnvFile(require("path").join(__dirname, "..", ".env")); } catch { /* env may come from the host */ }
const sheets = require("./sheets");
const { TABS } = require("./schema");

const ok = (m) => console.log(`  OK    ${m}`);
const bad = (m) => console.log(`  FAIL  ${m}`);

async function main() {
  console.log("1. Credentials");
  if (!sheets.hasCredentials()) throw Object.assign(new Error("none"), { kind: "NO_KEY" });
  const email = sheets.serviceAccountEmail();
  ok(`key loaded, service account: ${email ?? "(no client_email in key)"}`);

  console.log("2. Connect to the sheet (auth + API enabled + sharing + sheet ID)");
  const { title, tabs } = await sheets.listTabs();
  ok(`opened "${title}"`);
  console.log(`  tabs now: ${tabs.join(", ") || "(none)"}`);

  console.log("3. Expected tabs and headers");
  const expected = Object.keys(TABS);
  const missing = expected.filter((t) => !tabs.includes(t));
  const present = expected.filter((t) => tabs.includes(t));
  const headers = present.length ? await sheets.readHeaders(present) : {};
  let allGood = missing.length === 0;
  for (const t of expected) {
    if (missing.includes(t)) { bad(`${t}: tab missing`); continue; }
    const same = TABS[t].every((h, i) => headers[t][i] === h);
    same ? ok(`${t}`) : bad(`${t}: headers differ (expected ${TABS[t].join(", ")})`);
    allGood &&= same;
  }
  if (!allGood) { console.log("\nAccess works, but the sheet isn't set up. Run: npm run seed"); process.exit(1); }
  console.log("\nAll good. The database is ready.");
}

main().catch((err) => {
  const d = sheets.diagnose(err);
  console.log(`\n  FAIL  [${d.kind}] ${d.problem}`);
  console.log(`  FIX   ${d.fix}`);
  if (d.kind === "UNKNOWN") console.log(`  (raw: ${err.message})`);
  process.exit(1);
});
