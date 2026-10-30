// Idempotent: creates missing tabs/headers, then inserts demo rows only when their key is absent.
try { process.loadEnvFile(require("path").join(__dirname, "..", ".env")); } catch { /* env may come from the host */ }
const sheets = require("./sheets");
const { TABS } = require("./schema");

const DEMO_PASSWORD = process.env.DEMO_PASSWORD; // set in .env; never committed
const DAY_MS = 86_400_000;
const FOUNDERS_LAB = "F001";
const FOUNDERS_LAB_SUBTITLE = "Build your first startup";
const STUDENT = "S001";

const isoDate = (offsetDays = 0) => new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);

// Reads happen once up front and writes are flushed once per tab: Sheets allows only ~60 requests a minute.
const existing = {};
const queue = {};

// keyCols: one column name, or several for composite keys.
function insertIfAbsent(tab, keyCols, row) {
  const keys = [].concat(keyCols);
  const label = keys.map((k) => row[k]).join("/");
  const rows = [...(existing[tab] ?? []), ...(queue[tab] ?? [])];
  if (rows.some((r) => keys.every((k) => String(r[k]) === String(row[k])))) return console.log(`  = ${tab}: ${label} already there`);
  (queue[tab] ??= []).push(row);
  console.log(`  + ${tab}: ${label}`);
}

async function main() {
  if (!DEMO_PASSWORD) throw new Error("DEMO_PASSWORD is not set (see .env.example)");
  if (!sheets.hasCredentials()) throw Object.assign(new Error("No service account credentials found"), { kind: "NO_KEY" });

  console.log("Tabs:");
  for (const [name, headers] of Object.entries(TABS)) {
    const r = await sheets.ensureTab(name, headers);
    console.log(`  ${r.created ? "+ created" : "= exists "} ${name}${r.headersWritten ? " (headers written)" : ""}${r.headersExtended ? " (new columns added)" : ""}`);
  }

  // Older sheets stored a bcrypt hash in "passwordHash"; the column is now a plain-text "password" (same position, no rows lost).
  if (await sheets.renameColumn("Students", "passwordHash", "password")) console.log("  ~ Students: column passwordHash renamed to password");
  Object.assign(existing, await sheets.readTabs(Object.keys(TABS)));
  console.log("Demo rows:");
  const today = isoDate();
  // Founder's Lab is the only course. Its sessions live in content/founders-lab/manifest.json, progress is front-end only for now.
  insertIfAbsent("Courses", "courseId", {
    courseId: FOUNDERS_LAB, title: "Founder's Lab", description: FOUNDERS_LAB_SUBTITLE, status: "live", totalLessons: 0,
  });
  // The first seed wrote a placeholder description; bring it in line with the subtitle the course page shows.
  const lab = existing.Courses.find((c) => c.courseId === FOUNDERS_LAB);
  if (lab && lab.description === "Turn an idea into a business, step by step.") {
    await sheets.updateRow("Courses", "courseId", FOUNDERS_LAB, { description: FOUNDERS_LAB_SUBTITLE });
    console.log("  ~ Courses: F001 description updated");
  }

  insertIfAbsent("Students", "studentId", {
    studentId: STUDENT, name: "Demo Student", email: "demo@iicfe-demo.com",
    password: DEMO_PASSWORD, status: "active", joinedOn: today,
  });
  // The demo row may still hold an old bcrypt hash (or nothing): set the plain password. A password the founder chose is left alone.
  const demo = existing.Students.find((x) => x.studentId === STUDENT);
  if (demo && (demo.password === "" || demo.password.startsWith("$2"))) {
    await sheets.updateRow("Students", "studentId", STUDENT, { password: DEMO_PASSWORD });
    console.log("  ~ Students: S001 password set");
  }
  insertIfAbsent("Enrollments", ["studentId", "courseId"], {
    enrollmentId: "E001", studentId: STUDENT, courseId: FOUNDERS_LAB, status: "active", progressPct: 0, enrolledOn: today, completedOn: "",
  });
  insertIfAbsent("News", "newsId", { newsId: "N001", title: "Welcome to the IICFE Study Hub", body: "Your workspace is live. Explore your courses and track your progress here.", date: today });

  console.log("Writing:");
  for (const [tab, rows] of Object.entries(queue)) {
    await sheets.appendRows(tab, rows);
    console.log(`  wrote ${rows.length} row(s) to ${tab}`);
  }
  console.log("Done. Demo login: demo@iicfe-demo.com / (see README)");
}

main().catch((err) => {
  const d = sheets.diagnose(err);
  console.error(`\nSeed failed [${d.kind}]: ${d.problem}`);
  console.error(`Fix: ${d.fix}`);
  if (d.kind === "UNKNOWN") console.error(`(raw: ${err.message})`);
  process.exit(1);
});
