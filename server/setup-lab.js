// One-off setup for Founder's Lab: creates the two lab tabs (and their header rows) if they are missing. Safe to run twice.
// Tabs are never created while serving a request, so a page view can't fail or write to the Sheet because of a missing tab.
// Usage: npm run setup-lab
try { process.loadEnvFile(require("path").join(__dirname, "..", ".env")); } catch { /* env may come from the host */ }
const sheets = require("./sheets");
const { TABS, LAB_TABS } = require("./schema");

(async () => {
  for (const name of LAB_TABS) {
    const r = await sheets.ensureTab(name, TABS[name]);
    console.log(`${r.created ? "+ created" : "= exists "} ${name}${r.headersWritten ? " (headers written)" : ""}${r.headersExtended ? " (new columns added)" : ""}`);
  }
  console.log("Founder's Lab tabs are ready.");
})().catch((err) => {
  const d = sheets.diagnose(err);
  console.error(`\nSetup failed [${d.kind}]: ${d.problem}\nFix: ${d.fix}`);
  process.exit(1);
});
