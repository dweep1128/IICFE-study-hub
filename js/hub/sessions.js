// Sessions: the timeline (#sessions) and each session's page (#sessions/<no>/<tab>).
// Session 1 is the native one: js/hub/session.js lays it out (Study Notes, Activities, Practice Test, Final Exam, then the tabs below).
// Every other visible session uses the old portal's page: header, step bar, a sticky tab row, then Reading, Activities and uploads, Quiz,
// Output, Recap. The server decides what is visible, grades quizzes and keeps the answer keys; this file only draws what it returns.
const PITCH_SECONDS = 3 * 60;
const PITCH_WARN_SECONDS = 30;
const QUIZ_SKIPPED = -1;
const LETTERS = ["A", "B", "C", "D"];
const TBD = "TBD";
const sessionsApi = (path = "") => `/api/courses/${Founders.COURSE_ID}/lab/sessions${path}`;

// ---------- small pieces ----------
const stepText = (s) => `${s.label} ${s.key === "uploads" ? `${s.count}/${s.total}` : s.done ? "✓" : "–"}`;
function stepBarHtml(steps, lab) {
  if (!steps.length && !lab) return "";
  const done = steps.filter((s) => s.done).length;
  return `<div class="ss-prog">${steps.length ? `<div class="ss-bar" role="progressbar" aria-label="${done} of ${steps.length} steps complete" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${done}"><i style="width:${(done / steps.length) * 100}%"></i></div>
    <p class="ss-steps">${done}/${steps.length} · ${steps.map(stepText).join(" · ")}</p>` : ""}
    ${lab ? `<p class="ss-steps">notes ${Math.min(lab.notes.have, lab.notes.need)}/${lab.notes.need} · games ${lab.games.have}/${lab.games.need} · practice ${lab.practice ? "✓" : "–"} · final exam ${lab.exam === "submitted" ? "✓" : lab.exam === "in_progress" ? "in progress" : "–"}</p>` : ""}</div>`;
}
// The Sheet may hold an ISO day or free text ("TBD", "1 Oct 2026"); only an ISO day is reformatted.
const dayText = (d) => (/^d{4}-d{2}-d{2}$/.test(d) ? fmtDate(d) : d);
const metaLine = (d) => [dayText(d.date), d.time, d.duration].filter(Boolean).join(" · ");

// ---------- the timeline ----------
function markerHtml(s) {
  const open = s.visible;
  return `<div class="sl-mark"><span class="sl-dot${open ? " is-open" : ""}">${String(s.no).padStart(2, "0")}</span>
    <div class="sl-when"><b>${esc(open ? dayText(s.date) || TBD : TBD)}</b><small>${esc(open ? s.duration || s.time || TBD : TBD)}</small></div></div>`;
}
function timelineHtml(sessions) {
  return `<ol class="sl">${sessions.map((s) => `<li>${markerHtml(s)}${s.visible
    ? `<div class="sl-card">${s.phase ? `<span class="pt-tag is-active">${esc(s.phase)}</span>` : ""}<h2>${esc(s.name)}</h2>${s.description ? `<p>${esc(s.description)}</p>` : ""}
        <div class="sl-foot">${stepBarHtml(s.steps, s.lab)}<a class="btn-pill solid" href="#sessions/${s.no}">Open session <span aria-hidden="true">→</span></a></div></div>`
    : `<div class="sl-card is-locked">${icon("lock")}<p>${esc(s.name)}</p><span class="pt-tag is-neutral">Coming soon</span></div>`}</li>`).join("")}</ol>`;
}
async function mountTimeline(el) {
  const { sessions } = await api(sessionsApi());
  el.className = "pt-page pt-stagger";
  el.innerHTML = `<header class="tk-head"><p class="pt-eyebrow is-gold">Sessions</p><h1 class="pt-h2">Your session plan.</h1>
    <p class="tk-sub">Open a session for its activities, uploads, quiz and recap. Locked sessions unlock as the program moves on.</p></header>${timelineHtml(sessions)}`;
}

// ---------- the video lecture ----------
// The server sends an embed address only for YouTube, Vimeo or Google Drive links (server/sessions.js), with no autoplay. Without one: a calm placeholder.
const PLAY = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>';
function playerHtml(video, title) {
  if (video) {
    return `<div class="sd-frame"><iframe src="${esc(video.embedUrl)}" title="${esc(video.title || `Video lecture: ${title}`)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"
      allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
  }
  return `<div class="sd-frame is-empty" role="img" aria-label="Video lecture coming soon"><div class="sd-ph"><span class="sd-ph-ic">${PLAY}</span>
    <p class="sd-ph-t">Video lecture coming soon</p><p class="sd-ph-s">${esc(title)}</p></div></div>`;
}
// "Mark video as watched": a toggle saved on the server with the rest of the lab progress. Progress only; it is not part of the Final Exam gate.
function mountVideoControl(host, st) {
  if (!st.video) { host.innerHTML = ""; return noop; }
  host.innerHTML = '<button type="button" class="sd-watch" aria-pressed="false"><span class="sd-watch-box" aria-hidden="true"></span><span data-t></span></button><span class="ss-err" role="alert" data-err></span>';
  const btn = $(".sd-watch", host), err = $("[data-err]", host);
  const draw = () => { btn.setAttribute("aria-pressed", String(st.videoWatched === true)); $("[data-t]", btn).textContent = st.videoWatched ? "Watched" : "Mark video as watched"; };
  draw();
  btn.addEventListener("click", async () => {
    const next = !st.videoWatched;
    btn.disabled = true; err.textContent = "";
    st.videoWatched = next; draw(); // shown at once; put back if the server refuses
    try { await api(sessionsApi(`/${st.no}/video`), { method: "POST", body: { watched: next } }); await st.reload().catch(() => {}); }
    catch (ex) { st.videoWatched = !next; err.textContent = ex.message || "Could not save. Try again."; }
    btn.disabled = false; draw(); st.changed();
  });
  const unwatch = st.watch(draw);
  return { destroy: unwatch };
}

// ---------- state shared by one open session ----------
// The server is the source of truth: after a tick, an upload or a quiz the steps are re-read from it.
function makeSessionState(detail) {
  const watchers = new Set();
  const state = {
    ...detail,
    watch: (fn) => { watchers.add(fn); return () => watchers.delete(fn); },
    changed: () => watchers.forEach((fn) => fn()),
    async reload() {
      const fresh = await api(sessionsApi(`/${detail.no}`));
      Object.assign(state, { steps: fresh.steps, ticked: fresh.ticked, submissions: fresh.submissions, quizResult: fresh.quizResult, videoWatched: fresh.videoWatched });
      state.changed();
    },
  };
  return state;
}

// ---------- tab contents: each mounts into `host` and returns { destroy } ----------
const noop = { destroy() {} };
const dashed = (title, sub) => `<div class="ss-card is-dashed"><p class="ss-card-t">${esc(title)}</p>${sub ? `<p class="ss-card-s">${esc(sub)}</p>` : ""}</div>`;

function mountReading(host, st) {
  host.innerHTML = st.readingUrl
    ? `<a class="ss-card is-link" href="${esc(st.readingUrl)}" target="_blank" rel="noopener noreferrer"><p class="ss-card-t">Open the reading material</p><p class="ss-card-s">Opens in a new tab.</p></a>`
    : dashed("Reading material will be added soon", "Check back before the session.");
  return noop;
}

function mountPitchTimer(host) {
  host.innerHTML = `<div class="ss-timer" role="timer"><p class="pt-eyebrow">Pitch timer · 3 minutes</p><p class="ss-clock" data-clock></p>
    <p class="ss-up" data-up role="status" hidden>Time’s up. Q&amp;A starts now.</p>
    <div class="ss-row"><button type="button" class="btn-pill solid" data-go></button><button type="button" class="btn-pill" data-reset>Reset</button></div></div>`;
  const clock = $("[data-clock]", host), go = $("[data-go]", host), up = $("[data-up]", host);
  let left = PITCH_SECONDS, id = null;
  const draw = () => {
    clock.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    clock.className = `ss-clock${left === 0 ? " is-over" : left <= PITCH_WARN_SECONDS ? " is-warn" : ""}`;
    go.textContent = id ? "Pause" : left === PITCH_SECONDS ? "Start" : "Resume";
    go.disabled = left === 0;
    up.hidden = left !== 0;
  };
  const stop = () => { clearInterval(id); id = null; };
  go.addEventListener("click", () => { if (id) stop(); else id = setInterval(() => { left = Math.max(0, left - 1); if (!left) stop(); draw(); }, 1000); draw(); });
  $("[data-reset]", host).addEventListener("click", () => { stop(); left = PITCH_SECONDS; draw(); });
  draw();
  return { destroy: stop };
}

// Activities, the instruction box, the pitch timer and the upload slots (a pasted https link each, kept in the Sheet).
function mountPlan(host, st) {
  const uploaders = [];
  const slotHtml = (slot) => {
    const sub = st.submissions[slot];
    return `<li class="ss-slot" data-slot="${esc(slot)}"><p class="ss-slot-t">${esc(slot)}</p><div class="ss-slot-s">${submissionStatusHtml(sub)}</div>${sub?.status === "approved" ? "" : '<div data-up></div>'}</li>`;
  };
  host.innerHTML = `${st.activities.length ? `<ol class="ss-acts">${st.activities.map((a, i) => `<li><span class="n">${i + 1}.</span><p>${esc(a.text)}</p>${a.time ? `<span class="t">${esc(a.time)}</span>` : ""}</li>`).join("")}</ol>` : '<p class="pt-empty">Activities will be added soon.</p>'}
    ${st.instructions ? `<div class="ss-instr"><p class="pt-eyebrow is-gold">Instruction / Template</p><p>${esc(st.instructions)}</p></div>` : ""}
    ${st.hasPitchTimer ? '<div data-timer></div>' : ""}
    <h3 class="pt-eyebrow is-gold ss-up-h">Upload</h3>
    ${st.uploadSlots.length ? `<ul class="ss-slots">${st.uploadSlots.map(slotHtml).join("")}</ul>` : '<p class="pt-empty">No uploads are needed for this session.</p>'}`;
  const timer = st.hasPitchTimer ? mountPitchTimer($("[data-timer]", host)) : noop;

  function mountSlot(li) {
    const slot = li.dataset.slot;
    const up = $("[data-up]", li);
    if (!up) return;
    const has = !!st.submissions[slot];
    uploaders.push(mountUploader(up, {
      uploadType: "activity", itemId: `s${st.no}|${slot}`, sessionNo: st.no, label: slot, cta: has ? "Re-submit link" : "Submit link", ghost: has,
      onSubmitted: async (answer) => {
        st.submissions[slot] = answer.submission;
        uploaders.forEach((u) => u.destroy());
        uploaders.length = 0;
        $$(".ss-slot", host).forEach((x) => { x.outerHTML = slotHtml(x.dataset.slot); }); // redraw every slot, then re-mount the controls
        $$(".ss-slot", host).forEach(mountSlot);
        st.reload().catch(() => {}); // the step bar; a failure here only leaves the bar a moment behind
      },
    }));
  }
  $$(".ss-slot", host).forEach(mountSlot);
  return { destroy() { timer.destroy(); uploaders.forEach((u) => u.destroy()); } };
}

function mountOutput(host, st) {
  if (!st.outputs.length) { host.innerHTML = '<p class="pt-empty">Expected outputs will be added soon.</p>'; return noop; }
  host.innerHTML = `<ul class="ss-outs">${st.outputs.map((o, i) => `<li><label><input type="checkbox" data-i="${i}"${st.ticked.includes(i) ? " checked" : ""}><span>${esc(o)}</span></label></li>`).join("")}</ul><p class="ss-err" role="alert" data-err></p>`;
  const err = $("[data-err]", host);
  const paint = () => $$("input", host).forEach((b) => { b.closest("label").classList.toggle("is-done", b.checked); });
  paint();
  host.addEventListener("change", async (e) => {
    const box = e.target.closest("input[data-i]");
    if (!box) return;
    const before = st.ticked;
    const i = Number(box.dataset.i);
    st.ticked = box.checked ? [...before, i] : before.filter((n) => n !== i);
    err.textContent = "";
    paint();
    try { await api(sessionsApi(`/${st.no}/ticks`), { method: "POST", body: { ticked: st.ticked } }); st.reload().catch(() => {}); }
    catch (ex) { st.ticked = before; box.checked = !box.checked; paint(); err.textContent = ex.message || "Could not save your tick. Try again."; }
  });
  return noop;
}

function mountRecap(host, st) {
  host.innerHTML = st.recap
    ? `<div class="ss-card"><p class="ss-recap">${esc(st.recap)}</p>${st.takeaways.length ? `<p class="pt-eyebrow is-gold ss-take-h">Key takeaways</p><ol class="ss-take">${st.takeaways.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""}</div>`
    : '<p class="pt-empty">The recap will be added after the session.</p>';
  return noop;
}

// One question at a time; the server grades, so the answers are shown only after the last one is sent.
function mountQuiz(host, st) {
  const qs = st.quiz;
  if (!qs.length) { host.innerHTML = '<p class="pt-empty">The quiz for this session has not been added yet.</p>'; return noop; }
  let i = 0, answers = [], busy = false;
  const drawQuestion = (error = "") => {
    const chosen = answers[i] ?? QUIZ_SKIPPED, last = i === qs.length - 1;
    host.innerHTML = `<p class="pt-eyebrow">Question ${i + 1} of ${qs.length}</p>
      <div class="ss-bar is-lg" role="progressbar" aria-valuemin="0" aria-valuemax="${qs.length}" aria-valuenow="${i + 1}"><i style="width:${((i + 1) / qs.length) * 100}%"></i></div>
      <fieldset class="ss-q"><legend>${esc(qs[i].q)}</legend>${qs[i].options.map((o, n) => `<label class="${chosen === n ? "is-on" : ""}"><input type="radio" name="q" value="${n}"${chosen === n ? " checked" : ""}><span><b>${LETTERS[n]}.</b> ${esc(o)}</span></label>`).join("")}</fieldset>
      <p class="ss-err" role="alert">${esc(error)}</p>
      <div class="ss-row is-between"><button type="button" class="btn-pill" data-back${i === 0 ? " disabled" : ""}>Back</button>
        <button type="button" class="btn-pill solid" data-next${chosen === QUIZ_SKIPPED ? " disabled" : ""}>${last ? "Finish &amp; see score" : "Next"}</button></div>`;
  };
  const drawResult = (g) => {
    host.innerHTML = `<div class="ss-score"><p class="pt-eyebrow">Your score</p><p class="ss-big">${g.score}<span> / ${g.total}</span></p><p>Best: ${g.bestScore}/${g.total} · Attempts: ${g.attempts}</p>
      <button type="button" class="btn-pill solid" data-retake>Retake quiz</button></div>
      <ol class="ss-review">${qs.map((q, n) => { const r = g.review[n], right = r.chosen === r.correct; return `<li class="ss-card"><p class="ss-card-t">${n + 1}. ${esc(q.q)}</p>
        <p class="${right ? "is-ok" : "is-bad"}">${right ? "Correct" : r.chosen === QUIZ_SKIPPED ? "Skipped" : `Your answer: ${esc(q.options[r.chosen])}`}</p>
        ${right ? "" : `<p>Correct answer: ${esc(q.options[r.correct])}</p>`}<p class="ss-card-s">${esc(r.explain)}</p></li>`; }).join("")}</ol>`;
  };
  async function finish() {
    busy = true;
    try {
      const { grade } = await api(sessionsApi(`/${st.no}/quiz`), { method: "POST", body: { answers: qs.map((_, n) => answers[n] ?? QUIZ_SKIPPED) } });
      st.reload().catch(() => {});
      drawResult(grade);
    } catch (ex) { drawQuestion(ex.message || "Could not submit your quiz. Try again."); }
    busy = false;
  }
  host.addEventListener("click", (e) => {
    if (busy) return;
    if (e.target.closest("[data-back]")) { i -= 1; drawQuestion(); }
    else if (e.target.closest("[data-next]")) { if (i === qs.length - 1) finish(); else { i += 1; drawQuestion(); } }
    else if (e.target.closest("[data-retake]")) { i = 0; answers = []; drawQuestion(); }
  });
  host.addEventListener("change", (e) => { const r = e.target.closest('input[name="q"]'); if (r) { answers[i] = Number(r.value); drawQuestion(); $('input[name="q"]:checked', host)?.focus(); } });
  drawQuestion();
  return noop;
}

const mountTest = (host) => { host.innerHTML = '<p class="pt-empty ss-soon">Coming Soon</p>'; return noop; };

// ---------- a session that is not native ----------
const GENERIC_TABS = [
  { id: "reading", label: "Reading Material", mount: mountReading }, { id: "plan", label: "Activities", mount: mountPlan }, { id: "quiz", label: "Quiz", mount: mountQuiz },
  { id: "output", label: "Session Output", mount: mountOutput }, { id: "recap", label: "Recap", mount: mountRecap }, { id: "test", label: "Test", mount: mountTest },
];
let activeGeneric = null; // { no, select(tab) } so a tab switch keeps a quiz in progress

function mountGeneric(el, st, tab) {
  el.className = "pt-page";
  el.innerHTML = `<a class="tk-back" href="#sessions"><span aria-hidden="true">←</span> All sessions</a>
    <div class="ss-head"><div class="tk-badges"><p class="pt-eyebrow is-gold">Session ${st.no}</p>${st.phase ? `<span class="pt-tag is-active">${esc(st.phase)}</span>` : ""}</div>
      <h1 class="pt-h2">${esc(st.name)}</h1>${metaLine(st) ? `<p class="tk-sub">${esc(metaLine(st))}</p>` : ""}<div data-steps></div></div>
    ${st.video ? `<div class="ss-video">${playerHtml(st.video, st.name)}<div class="sd-watch-row" data-video></div></div>` : ""}
    <nav class="ss-tabs" aria-label="Session sections"><ul role="tablist">${GENERIC_TABS.map((t) => `<li role="presentation"><a role="tab" href="#sessions/${st.no}/${t.id}" data-tab="${t.id}">${esc(t.label)}</a></li>`).join("")}</ul></nav>
    <div class="ss-panes">${GENERIC_TABS.map((t) => `<section role="tabpanel" data-pane="${t.id}" aria-label="${esc(t.label)}" hidden></section>`).join("")}</div>`;
  const drawSteps = () => { $("[data-steps]", el).innerHTML = stepBarHtml(st.steps); };
  drawSteps();
  const unwatch = st.watch(drawSteps);
  const video = mountVideoControl($("[data-video]", el) ?? document.createElement("div"), st);
  const mounted = GENERIC_TABS.map((t) => t.mount($(`[data-pane="${t.id}"]`, el), st));
  const select = (id) => {
    const key = GENERIC_TABS.some((t) => t.id === id) ? id : GENERIC_TABS[0].id;
    $$("[data-tab]", el).forEach((a) => { const on = a.dataset.tab === key; a.setAttribute("aria-selected", on); if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    $$("[data-pane]", el).forEach((p) => { p.hidden = p.dataset.pane !== key; });
  };
  select(tab);
  activeGeneric = { no: st.no, select };
  return () => { unwatch(); video.destroy(); mounted.forEach((m) => m.destroy()); activeGeneric = null; };
}

// ---------- the panel ----------
const Sessions = {
  // True while Session 1 (the native one) is open: it uses the full-width reading layout with the app's icon rail.
  wantsRail: () => !!Hub.manifest && Number(hashParts()[1]) === 1,
  // A tab change inside an open session: switch in place so a quiz or a game in progress survives.
  go(parts) {
    const no = Number(parts[0]);
    if (activeGeneric?.no === no) { activeGeneric.select(parts[1]); return true; }
    return Resources.go(parts);
  },
};

Panels.sessions = async (el, hub) => {
  const parts = hashParts().slice(1);
  if (!parts[0]) return mountTimeline(el);
  const no = Number(parts[0]);
  if (!Number.isInteger(no) || no < 1) return notAvailableYet(el);
  if (parts[1] === "mentor-desk" && hub.manifest?.sessions[no - 1] && TestsView.canUseDesk(hub.user)) return TestsView.mountDesk(el, { session: hub.manifest.sessions[no - 1] });
  let detail;
  try { detail = await api(sessionsApi(`/${no}`)); } catch (e) { if (e.status === 404) return notAvailableYet(el); throw e; } // locked and unknown sessions are both a 404
  const st = makeSessionState(detail);
  if (hub.manifest?.sessions[no - 1]?.data) return Resources.mount(el, hub, parts, st);
  return mountGeneric(el, st, parts[1]);
};
