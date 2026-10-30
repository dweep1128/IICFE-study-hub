// Overview + the "Coming soon" tabs. Sessions from content/founders-lab/manifest.json are the course's modules.
const CHECK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const DESC_CLAMP_LINES = 3;
const stepLink = (hub, session, item) => Founders.hash(hub.manifest, session.id, item.key);

// Status line under a step in the journey list: a real score once the Final Exam is submitted.
function stepStatus(item, isNext, gate) {
  if (item.key === "real-test" && gate.locked) return "Locked";
  if (item.score) return `Score ${item.score.score}/${item.score.total}`;
  if (item.done) return "Done";
  return isNext ? "Up next" : item.started ? "In progress" : "Not started";
}

function overviewHtml(hub, d, sum) {
  const { next } = sum;
  // When every session is finished the journey keeps showing the last one instead of going blank.
  const session = sum.current ?? sum.sessions.at(-1);
  const nextHref = next ? stepLink(hub, next.session, next.item) : stepLink(hub, session, session.items[0]);
  const action = next ? { label: "Continue learning", href: nextHref } : { label: "Review course", href: nextHref };
  const status = next ? `Session ${next.session.no} ${next.session.started ? "in progress" : "up next"}` : `All ${sum.sessionsTotal} sessions complete`;
  const nextItemKey = next?.item.key;

  return greetingBand({ name: hub.user.name, status, percent: sum.percent, action }) + `
    <section class="ov-grid">
      <article class="hub-card" aria-labelledby="jt">
        <p class="mono-label" id="jt">Your journey</p>
        <div class="journey-top"><p><strong>${sum.sessionsDone}</strong> of ${sum.sessionsTotal} sessions complete</p></div>
        <div class="journey-cur"><div><h3>Session ${session.no}: ${esc(session.title)}</h3><p>${session.doneCount} of ${session.total} steps complete</p></div>
          <a class="btn-pill" href="${esc(nextHref)}">Open module <span class="arrow" aria-hidden="true">→</span></a></div>
        <ol class="stepper" style="--cols:${session.items.length}" aria-label="Session ${session.no} steps">${session.items.map((it, i) => {
          const cls = it.done ? "complete" : it.key === nextItemKey && session === next?.session ? "in_progress" : "upcoming";
          return `<li class="${cls}">
            <span class="step-dot">${it.done ? CHECK : i + 1}</span>
            <span class="step-title">${esc(it.label)}</span>
            <span class="step-status">${esc(stepStatus(it, cls === "in_progress", session.gate))}</span>
          </li>`;
        }).join("")}</ol>
      </article>

      <article class="next-card" aria-labelledby="na">
        <p class="mono-label" id="na">Next action</p>
        ${next ? `
          <h2>${esc(next.item.label)}</h2>
          <p class="meta">Session ${next.session.no} · ${esc(next.session.title)}</p>
          ${next.hint ? `<p class="meta">${esc(next.hint)}</p>` : ""}
          <div class="next-foot"><span></span><a class="round-btn" href="${esc(nextHref)}" aria-label="Go to ${esc(next.item.label)}"><span aria-hidden="true">→</span></a></div>`
        : '<h2>All caught up</h2><p class="empty-note">Every session is complete.</p>'}
      </article>
    </section>

    <section class="ov-cards">
      <article class="hub-card"><h3>Course description</h3>
        <p class="desc" id="ov-desc">${esc(d.course.description || "No description yet.")}</p>
        <button class="read-more" type="button" aria-expanded="false" aria-controls="ov-desc" hidden>Read more</button>
      </article>
      <article class="hub-card"><h3>Modules completed</h3>
        <p class="big-num">${sum.sessionsDone}<small> / ${sum.sessionsTotal} sessions</small></p>
        <div class="bar" role="progressbar" aria-label="Sessions completed" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${sum.sessionsTotal ? Math.round((sum.sessionsDone / sum.sessionsTotal) * 100) : 0}"><i style="width:${sum.sessionsTotal ? (sum.sessionsDone / sum.sessionsTotal) * 100 : 0}%"></i></div>
      </article>
      <article class="hub-card"><h3>Steps completed</h3>
        <p class="big-num">${sum.doneSteps}<small> / ${sum.totalSteps} steps</small></p>
        <div class="bar" role="progressbar" aria-label="Steps completed" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${sum.percent}"><i style="width:${sum.percent}%"></i></div>
      </article>
      ${d.dues.length ? `<article class="hub-card"><h3>What's due</h3>
        <ul class="due-list">${d.dues.map((x) => `
          <li><span class="t">${esc(x.title)}</span><span class="row"><span class="chip">${esc(x.type)}</span><time datetime="${esc(x.dueDate)}">${esc(fmtDate(x.dueDate))}</time></span></li>`).join("")}</ul>
      </article>` : ""}
    </section>`;
}

Panels.overview = async (el, hub) => {
  const d = await hub.getHub();
  if (!hub.manifest) {
    el.innerHTML = head("Overview", d.course.title, d.course.description || "") + emptyState("Coming soon", "Sessions for this course will appear here.", icon("overview"));
    return;
  }
  const draw = () => {
    el.innerHTML = overviewHtml(hub, d, Founders.summary(hub.manifest));
    // "Read more" only when the description is actually cut off by the 3-line clamp.
    const desc = $("#ov-desc", el);
    const more = $(".read-more", el);
    if (desc.scrollHeight > desc.clientHeight + 1) more.hidden = false;
    more.addEventListener("click", () => {
      const open = more.getAttribute("aria-expanded") !== "true";
      more.setAttribute("aria-expanded", open);
      more.textContent = open ? "Show less" : "Read more";
      desc.classList.toggle("open", open);
    });
  };
  draw();
  return Founders.watch(() => { if (el.isConnected) draw(); });
};

// ---------- tabs with no content yet ----------
const head = (label, title, sub) => `<div class="panel-head"><p class="mono-label">${esc(label)}</p><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div>`;
// resources / mock / final only land here for a course without a content manifest (otherwise the native views handle them).
const COMING_SOON = {
  resources: { label: "Resources", sub: "Study notes and activities for this course.", icon: "resources" },
  mock: { label: "Mock Tests", sub: "Practice tests for this course.", icon: "mock" },
  final: { label: "Final Exam", sub: "Your final assessment for this course.", icon: "exam" },
  guide: { label: "Course Guide", sub: "How to get the most out of this course.", icon: "guide" },
  documents: { label: "Documents", sub: "Syllabus, guides and templates for this course.", icon: "documents" },
  certificate: { label: "Certificate", sub: "Your proof of completion for this course.", icon: "certificate" },
  amigo: { label: "Amigo", sub: "Your study buddy for Founder's Lab.", icon: "chatbot" },
};
for (const [id, c] of Object.entries(COMING_SOON)) {
  Panels[id] = async (el) => {
    el.innerHTML = head(c.label, c.label, c.sub) + emptyState("Coming soon", `${c.label} isn't available for this course yet.`, icon(c.icon));
  };
}
