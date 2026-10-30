// Course Guide, Documents, Certificate and Amigo panels.
// Documents and the Certificate (markup, states, wording) are the ORIGINAL code from js/hub/misc.js, restored unchanged where it
// was course-independent. The Certificate now reads Founder's Lab progress when the course has a content manifest; for any course
// without one it still uses the original server route. The Course Guide panel's old code no longer exists on disk (it was lost when
// core.js was rewritten), so it is rebuilt on the .accordion styles and the /guidance route that did survive.
const LOCK = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

// ---------- course guide ----------
Panels.guide = async (el, hub) => {
  const items = await api(hub.url("guidance"));
  el.innerHTML = head("Course Guide", "Course Guide", "How to get the most out of this course.") + (items.length
    ? `<div class="accordion">${items.map((g, i) => `
        <details${i === 0 ? " open" : ""}><summary>${esc(g.title)}</summary><div class="body">${paras(g.body)}</div></details>`).join("")}</div>`
    : emptyState("No guide yet", "Your course guide will appear here once it's added.", icon("guide")));
};

// ---------- documents (original) ----------
const fileKind = (url) => {
  const ext = (String(url).split(/[?#]/)[0].match(/\.(\w+)$/) ?? [])[1]?.toLowerCase() ?? "";
  if (ext === "pdf") return { cls: "pdf", label: "PDF" };
  if (["doc", "docx"].includes(ext)) return { cls: "doc", label: "DOC" };
  if (["xls", "xlsx", "csv"].includes(ext)) return { cls: "xls", label: "XLS" };
  if (["ppt", "pptx"].includes(ext)) return { cls: "ppt", label: "PPT" };
  return { cls: "", label: ext ? ext.slice(0, 4).toUpperCase() : "FILE" };
};

Panels.documents = async (el, hub) => {
  const docs = await api(hub.url("documents"));
  const groups = Map.groupBy(docs, (d) => d.category);
  el.innerHTML = head("Documents", "Documents", "Syllabus, guides and templates for this course.") + (docs.length
    ? [...groups].map(([cat, items]) => `
      <section class="doc-group" aria-label="${esc(cat)}"><h2>${esc(cat)}</h2><ul class="doc-list">${items.map((d) => {
        const k = fileKind(d.url);
        return `<li class="hub-card doc"><span class="ftype ${k.cls}" aria-hidden="true">${esc(k.label)}</span><span class="t">${esc(d.title)}</span>
          <span class="acts">${d.url
            ? `<a class="btn-pill" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Open</a><a class="btn-pill solid" href="${esc(d.url)}" download>Download</a>`
            : '<span class="chip">Unavailable</span>'}</span></li>`;
      }).join("")}</ul></section>`).join("")
    : emptyState("No documents yet", "Course documents will appear here once they're uploaded.", icon("documents")));
};

// ---------- certificate ----------
const CERT_ID_PREFIX = "FL";
const ISO_DAY_LEN = 10; // "2026-10-29" out of the exam slip's "2026-10-29 15:20"

const certHead = () => head("Certificate", "Certificate", "Your proof of completion for this course.");

// Original locked state: lock, title, note, progress bar, checklist of conditions.
const certLocked = ({ eligible, progress, caption, conditions }) => `
  <article class="hub-card cert-locked">
    <div class="lock">${LOCK}</div>
    <h2>Certificate locked</h2>
    <p class="note-line">${eligible ? "You've met every condition. Your certificate is being issued." : "Complete these steps to unlock your certificate."}</p>
    <div class="bar" role="progressbar" aria-label="Progress towards certificate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" style="margin-top:18px"><i style="width:${progress}%"></i></div>
    ${caption ? `<p class="cert-prog">${esc(caption)}</p>` : ""}
    <ul class="checklist">${conditions.map((x) => `<li class="${x.met ? "met" : ""}"><span class="ic" aria-hidden="true">${x.met ? "✓" : ""}</span><span>${esc(x.label)}<small>${esc(x.detail)}<span class="sr-only"> (${x.met ? "met" : "not met"})</span></small></span></li>`).join("")}</ul>
  </article>`;

// Original certificate card; the logo is the IICFE logo, the page stays light inside a themed frame.
const certCard = (k, { logo = true } = {}) => `
  <div class="cert-frame"><article class="cert" aria-label="Certificate of completion">
    ${logo ? '<img class="cert-logo" src="assets/logo.png" alt="IICFE Singapore">' : ""}
    <p class="mono-label" style="margin:0">IICFE Singapore</p>
    <h2>Certificate of Completion</h2>
    <p>This certifies that</p>
    <p class="who">${esc(k.studentName)}</p>
    <p>has successfully completed</p><p><b>${esc(k.courseTitle)}</b></p>
    <p style="margin-top:18px">Issued ${esc(fmtDate(k.issuedOn))} · ID ${esc(k.certId)}</p>
  </article></div>`;

// Founder's Lab: unlocked once every step of every session is done (the same rule as the progress ring reaching 100%).
function founderCertificate(el, hub) {
  const draw = () => {
    const sum = Founders.summary(hub.manifest);
    const steps = sum.sessions.flatMap((s) => s.items.map((it) => ({
      label: sum.sessions.length > 1 ? `Session ${s.no}: ${it.label}` : it.label, met: it.done, detail: it.done ? "Done" : "Not done yet" })));
    const unlocked = sum.totalSteps > 0 && sum.doneSteps === sum.totalSteps;
    if (!unlocked) {
      el.innerHTML = certHead() + certLocked({ eligible: false, progress: sum.percent, caption: `${sum.doneSteps} of ${sum.totalSteps} steps done`, conditions: steps });
      return;
    }
    // Completion date = when the last exam was submitted (the Final Exam saves its time); today if that is missing.
    const stamps = hub.manifest.sessions.map((s) => Founders.readKey(s.items.at(-1).storageKey)?.ts).filter(Boolean).sort();
    const issuedOn = stamps.length ? stamps.at(-1).slice(0, ISO_DAY_LEN) : new Date().toISOString().slice(0, ISO_DAY_LEN);
    el.innerHTML = certHead() + certCard({
      studentName: hub.user.name, courseTitle: hub.title, issuedOn, certId: `${CERT_ID_PREFIX}-${hub.courseId}-${hub.user.studentId ?? "STUDENT"}` })
      + `<p style="margin-top:20px"><button class="btn-pill solid" type="button" data-print>Download certificate</button>
         <span class="note-line"> Opens your browser's print dialog. Choose “Save as PDF” to keep a copy.</span></p>`;
    $("[data-print]", el).addEventListener("click", () => print());
  };
  draw();
  return Founders.watch(() => { if (el.isConnected) draw(); });
}

Panels.certificate = async (el, hub) => {
  if (hub.manifest) return founderCertificate(el, hub);
  const c = await api(hub.url("certificate")); // original server-driven flow for courses without a content manifest
  if (c.certificate) {
    const k = c.certificate;
    el.innerHTML = certHead() + certCard(k, { logo: false }) + `
      <p style="margin-top:20px">${k.certUrl
        ? `<a class="btn-pill solid" href="${esc(k.certUrl)}" target="_blank" rel="noopener noreferrer" download>Download certificate</a>`
        : '<button class="btn-pill solid" type="button" disabled>Download certificate</button><span class="note-line"> The download link will be available soon.</span>'}</p>`;
    return;
  }
  el.innerHTML = certHead() + certLocked({ eligible: c.eligible, progress: c.progress, conditions: c.conditions });
};

// ---------- Amigo ----------
// There is no chat backend wired up yet, so this is an honest "coming soon" page: no fake replies, no invented features.
// The example questions come from the Study Notes and are not clickable.
const AMIGO_EXAMPLES = [
  "Explain the R-E-U test in simple words",
  "Give me an example of the Three Why approach",
  "Quiz me on the six hats",
  "What should I do for the homework?",
];
const AMIGO_MARK = `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" focusable="false">
  <circle cx="32" cy="32" r="30" class="am-face"/>
  <path d="M14 22 L20 8 L30 17 Z" class="am-gold"/><path d="M50 22 L44 8 L34 17 Z" class="am-gold"/>
  <circle cx="23" cy="30" r="3.5" class="am-eye"/><circle cx="41" cy="30" r="3.5" class="am-eye"/>
  <path d="M22 41 Q32 51 42 41" class="am-smile"/></svg>`;

Panels.amigo = async (el) => {
  el.innerHTML = `<section class="am" aria-labelledby="am-t">
    <div class="am-avatar">${AMIGO_MARK}</div>
    <h1 id="am-t">Amigo</h1>
    <p class="am-sub">Your study buddy for Founder's Lab</p>
    <div class="am-input" aria-disabled="true">
      <label class="sr-only" for="am-in">Message Amigo</label>
      <input id="am-in" type="text" placeholder="Ask Amigo anything about the course" disabled aria-describedby="am-note">
      <button type="button" disabled aria-label="Send">${icon("send")}</button>
    </div>
    <p class="am-note" id="am-note">Amigo is coming soon</p>
    <h2 class="am-h">Things you'll be able to ask</h2>
    <ul class="am-chips">${AMIGO_EXAMPLES.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>
  </section>`;
};
