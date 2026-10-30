// Documents, Final Exam, Certificate and Chatbot panels.
const MS_PER_SEC = 1000;
const SECS = { d: 86400, h: 3600, m: 60 };
const LOCK = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const head = (label, title, sub) => `<div class="panel-head"><p class="mono-label">${esc(label)}</p><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>`;

// ---------- documents ----------
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

// ---------- final exam ----------
// The Exams tab in the Sheet may still say "Main Exam" in its titles: show the new name without editing the Sheet.
const finalExamName = (t) => String(t).replace(/main exam/gi, (m) => (m[0] === "M" ? "Final Exam" : "final exam"));
const STATUS_PILL = { scheduled: "pill-soft", passed: "pill-gold", failed: "pill-soft", completed: "pill-gold" };

Panels.exam = async (el, hub) => {
  const x = await api(hub.url("exam"));
  if (!x) { el.innerHTML = head("Final exam", "Final exam", "Your final assessment for this course.") + emptyState("No exam scheduled", "Your exam date will appear here once it's set.", icon("exam")); return; }
  const when = x.startsAt ? new Date(x.startsAt) : null;
  el.innerHTML = head("Final exam", "Final exam", "Your final assessment for this course.") + `
    <article class="hub-card exam-grid">
      <div><span class="${STATUS_PILL[x.status] ?? "pill-soft"}">${esc(x.status)}</span>
        <h2 style="margin-top:14px;font-size:clamp(1.5rem,3vw,2.1rem)">${esc(finalExamName(x.title))}</h2>
        <dl class="exam-meta"><div><dt>Date</dt><dd>${esc(fmtDate(x.date))}</dd></div><div><dt>Time</dt><dd>${esc(x.time)}</dd></div><div><dt>Mode</dt><dd>${esc(x.mode)}</dd></div></dl>
        ${when ? `<div class="count" role="timer" aria-label="Time until the exam" data-count></div>` : '<p class="note-line">Exact start time to be confirmed.</p>'}
        <h3 class="sec" style="margin:22px 0 10px">Instructions</h3>
        <div class="instr">${paras(x.instructions)}</div>
        <button class="btn-pill solid" type="button" ${x.canStart ? "" : 'disabled aria-describedby="exam-note"'} data-start>Start exam</button>
        <p class="note-line" id="exam-note">${x.canStart ? "The exam window is open." : `The exam can only be started during its window${when ? `, which opens on ${esc(fmtDate(x.date))} at ${esc(x.time)}` : ""}. This demo doesn't launch the exam itself.`}</p>
      </div>
    </article>`;
  $("[data-start]", el).addEventListener("click", () => toast("Launching the exam isn't part of this demo."));
  if (!when) return;

  const box = $("[data-count]", el);
  const tick = () => {
    let left = Math.max(0, Math.floor((when - Date.now()) / MS_PER_SEC));
    const parts = Object.entries(SECS).map(([k, size]) => { const v = Math.floor(left / size); left -= v * size; return [k, v]; });
    parts.push(["s", left]);
    const names = { d: "Days", h: "Hours", m: "Mins", s: "Secs" };
    box.innerHTML = parts.map(([k, v]) => `<div><strong>${String(v).padStart(2, "0")}</strong><span>${names[k]}</span></div>`).join("");
  };
  tick();
  const timer = setInterval(tick, MS_PER_SEC);
  return () => clearInterval(timer);
};

// ---------- certificate ----------
Panels.certificate = async (el, hub) => {
  const c = await api(hub.url("certificate"));
  const sub = "Your proof of completion for this course.";
  if (c.certificate) {
    const k = c.certificate;
    el.innerHTML = head("Certificate", "Certificate", sub) + `
      <article class="cert" aria-label="Certificate of completion">
        <p class="mono-label" style="margin:0">IICFE Singapore</p>
        <h2>Certificate of Completion</h2>
        <p>This certifies that</p>
        <p class="who">${esc(k.studentName)}</p>
        <p>has successfully completed</p><p><b>${esc(k.courseTitle)}</b></p>
        <p style="margin-top:18px">Issued ${esc(fmtDate(k.issuedOn))} · ID ${esc(k.certId)}</p>
      </article>
      <p style="margin-top:20px">${k.certUrl
        ? `<a class="btn-pill solid" href="${esc(k.certUrl)}" target="_blank" rel="noopener noreferrer" download>Download certificate</a>`
        : '<button class="btn-pill solid" type="button" disabled>Download certificate</button><span class="note-line"> The download link will be available soon.</span>'}</p>`;
    return;
  }
  el.innerHTML = head("Certificate", "Certificate", sub) + `
    <article class="hub-card cert-locked">
      <div class="lock">${LOCK}</div>
      <h2>Certificate locked</h2>
      <p class="note-line">${c.eligible ? "You've met every condition. Your certificate is being issued." : "Complete these steps to unlock your certificate."}</p>
      <div class="bar" role="progressbar" aria-label="Progress towards certificate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${c.progress}" style="margin-top:18px"><i style="width:${c.progress}%"></i></div>
      <ul class="checklist">${c.conditions.map((x) => `<li class="${x.met ? "met" : ""}"><span class="ic" aria-hidden="true">${x.met ? "✓" : ""}</span><span>${esc(x.label)}<small>${esc(x.detail)}<span class="sr-only"> (${x.met ? "met" : "not met"})</span></small></span></li>`).join("")}</ul>
    </article>`;
};

// ---------- chatbot ----------
Panels.chatbot = async (el, hub) => {
  el.innerHTML = head("Chatbot", "Course assistant", "Ask about this course's guide, modules and resources.") + `
    <section class="hub-card chat" aria-label="Chat">
      <div class="chat-log" role="log" aria-live="polite" data-log></div>
      <div class="chips" data-chips>${DATA.hub.chatChips.slice(0, 3).map((c) => `<button type="button">${esc(c)}</button>`).join("")}</div>
      <form class="chat-form" data-form>
        <label class="sr-only" for="chat-in">Your question</label>
        <input id="chat-in" type="text" maxlength="500" placeholder="Ask a question…" autocomplete="off" required>
        <button class="btn-pill solid" type="submit">Send</button>
      </form>
    </section>`;
  const log = $("[data-log]", el);
  const input = $("#chat-in", el);
  const send = $("button[type=submit]", el);
  let busy = false;

  const bubble = (cls, content) => {
    const d = document.createElement("div");
    d.className = `msg ${cls}`;
    d.innerHTML = content;
    log.append(d);
    log.scrollTop = log.scrollHeight;
    return d;
  };
  const botHtml = (r) => `${esc(r.answer)}${r.sources?.length ? `<div class="srcs">${r.sources.map((s) => `<span class="src">Source: ${esc(s)}</span>`).join("")}</div>` : ""}`;

  async function ask(text) {
    if (busy || !text.trim()) return;
    busy = true;
    send.disabled = true;
    $("[data-chips]", el)?.remove(); // chips are only a starting point
    bubble("me", esc(text));
    const typing = bubble("bot", '<span class="typing" role="status" aria-label="Assistant is typing"><i></i><i></i><i></i></span>');
    try {
      const r = await api("/api/chat", { method: "POST", body: { courseId: hub.courseId, message: text.trim() } });
      typing.innerHTML = botHtml(r);
    } catch (e) {
      typing.className = "msg bot err";
      typing.innerHTML = `${esc(e.message)} <button class="btn-pill" type="button" style="padding:6px 12px;margin-top:8px">Try again</button>`;
      $("button", typing).addEventListener("click", () => { typing.remove(); busy = false; send.disabled = false; ask(text); });
    }
    busy = false;
    send.disabled = false;
    log.scrollTop = log.scrollHeight;
  }

  bubble("bot", esc("Hi! Ask me anything about this course and I'll look through its guide, modules and resources."));
  $("[data-form]", el).addEventListener("submit", (e) => { e.preventDefault(); const t = input.value; input.value = ""; ask(t); });
  $("[data-chips]", el).addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) ask(b.textContent); });
};
