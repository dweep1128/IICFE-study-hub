const LOW_TIME_S = 60;
const ANNOUNCE_AT_S = [300, 60];
const MS_PER_S = 1000;
const TREND_W = 300;
const TREND_H = 100;
const TREND_PAD = 14;

const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function topicBars(topics) {
  if (!topics.length) return '<p class="note-line">No topic data yet.</p>';
  return `<div class="tbars">${topics.map((t) => `
    <div class="tbar${t.weak ? " weak" : ""}">
      <div class="top"><span>${esc(t.topic)}${t.weak ? '<span class="weak-chip">Weak</span>' : ""}</span><span>${t.correct}/${t.total} · ${t.pct}%</span></div>
      <div class="track" role="progressbar" aria-label="${esc(t.topic)} accuracy" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${t.pct}"><span class="fill" style="width:${t.pct}%"></span></div>
    </div>`).join("")}</div>`;
}

function trendSvg(attempts) {
  if (!attempts.length) return "";
  const x = (i) => (attempts.length === 1 ? TREND_W / 2 : TREND_PAD + (i * (TREND_W - 2 * TREND_PAD)) / (attempts.length - 1));
  const y = (acc) => TREND_PAD + ((100 - acc) * (TREND_H - 2 * TREND_PAD)) / 100;
  const pts = attempts.map((a, i) => `${x(i)},${y(a.accuracy)}`).join(" ");
  return `<svg class="trend" viewBox="0 0 ${TREND_W} ${TREND_H}" role="img" aria-label="Accuracy trend across ${attempts.length} attempt${attempts.length > 1 ? "s" : ""}: ${attempts.map((a) => a.accuracy + "%").join(", ")}">
    ${[0, 50, 100].map((g) => `<line x1="${TREND_PAD}" x2="${TREND_W - TREND_PAD}" y1="${y(g)}" y2="${y(g)}" stroke="#E3EAE8" stroke-dasharray="3 3"/><text x="0" y="${y(g) + 3}">${g}</text>`).join("")}
    ${attempts.length > 1 ? `<polyline points="${pts}" fill="none" stroke="#A8793A" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ""}
    ${attempts.map((a, i) => `<circle cx="${x(i)}" cy="${y(a.accuracy)}" r="4" fill="#2C7A6E"><title>${esc(a.date)}: ${a.accuracy}%</title></circle>`).join("")}
  </svg>`;
}

function reviewList(review) {
  return `<div class="review">${review.map((q, i) => `
    <details><summary><span class="mark${q.correct ? "" : " no"}" aria-hidden="true">${q.correct ? "✓" : "✕"}</span>
      <span><span class="sr-only">${q.correct ? "Correct. " : "Incorrect. "}</span>Q${i + 1}. ${esc(q.question)}</span></summary>
      <ul class="ans">${q.options.map((o, oi) => {
        const cls = oi === q.correctIndex ? "right" : oi === q.yourIndex ? "wrong" : "";
        const tag = oi === q.correctIndex ? " (correct answer)" : oi === q.yourIndex ? " (your answer)" : "";
        return `<li class="${cls}">${esc(o)}${tag}</li>`;
      }).join("")}</ul>
      ${q.yourIndex === null ? '<p class="note-line">You didn\'t answer this question.</p>' : ""}
      ${q.explanation ? `<p class="why"><b>Why:</b> ${esc(q.explanation)}</p>` : ""}
    </details>`).join("")}</div>`;
}

Panels.mock = async (el, hub) => {
  const courseId = hub.courseId;
  let timer = null;
  let guard = null;

  const stopRun = () => {
    clearInterval(timer);
    timer = null;
    if (guard) { removeEventListener("beforeunload", guard); guard = null; }
  };

  const head = (active) => `
    <div class="panel-head"><p class="mono-label">Mock tests</p><h1>Mock tests</h1><p>Timed practice with instant, server-graded feedback.</p></div>
    <div class="tabs" role="tablist" aria-label="Mock test views">
      <button type="button" role="tab" aria-selected="${active === "tests"}" data-go="tests">Tests</button>
      <button type="button" role="tab" aria-selected="${active === "analysis"}" data-go="analysis">Analysis</button>
    </div>`;
  const wireTabs = () => $$("[data-go]", el).forEach((b) => b.addEventListener("click", () => (b.dataset.go === "tests" ? showTests() : showAnalysis())));

  async function showTests() {
    stopRun();
    el.innerHTML = head("tests") + skeleton();
    wireTabs();
    let tests;
    try { tests = await api(`/api/mocktests/${encodeURIComponent(courseId)}`); }
    catch (e) { el.innerHTML = head("tests"); wireTabs(); return el.append(errorBox(e.message, showTests)); }
    el.innerHTML = head("tests") + (tests.length ? `<div class="mt-list">${tests.map((t) => `
      <article class="hub-card"><span class="chip">${t.questionCount} questions · ${t.durationMin} min</span>
        <h3>${esc(t.title)}</h3>
        <p>${t.attempts ? `${t.attempts} attempt${t.attempts > 1 ? "s" : ""}. Last score ${t.lastScore.score}/${t.lastScore.total}.` : "You haven't attempted this test yet."}</p>
        <button class="btn-pill solid" type="button" data-start="${esc(t.testId)}">${t.attempts ? "Retake" : "Start"} <span aria-hidden="true">→</span></button>
      </article>`).join("")}</div>` : emptyState("No mock tests yet", "Practice tests will appear here once they're added.", icon("mock")));
    wireTabs();
    $$("[data-start]", el).forEach((b) => b.addEventListener("click", () => startTest(b.dataset.start, b)));
  }

  async function startTest(testId, btn) {
    if (btn) btn.disabled = true;
    let test;
    try { test = await api(`/api/mocktests/${encodeURIComponent(testId)}/start`); }
    catch (e) { if (btn) btn.disabled = false; return toast(e.message); }
    runTest(test);
  }

  function runTest(test) {
    const qs = test.questions;
    const answers = {}; // questionId -> chosen index
    let idx = 0;
    let submitting = false;
    const endsAt = Date.now() + test.durationMin * 60 * MS_PER_S;
    let announced = new Set();

    el.innerHTML = `
      <div class="run-head"><div><p class="mono-label">Mock test</p><h2>${esc(test.title)}</h2></div>
        <div class="timer" role="timer" aria-label="Time remaining" data-timer>${fmtClock(test.durationMin * 60)}</div></div>
      <div class="sr-only" role="status" aria-live="polite" data-announce></div>
      <div class="run-body">
        <section class="hub-card q-card" aria-live="off" data-q></section>
        <aside class="hub-card palette" aria-label="Question palette"><h3>Questions</h3><div class="pal-grid" data-pal></div>
          <div class="pal-key"><span>Teal = answered</span></div></aside>
      </div>`;
    const qEl = $("[data-q]", el);
    const pal = $("[data-pal]", el);

    guard = (e) => { e.preventDefault(); e.returnValue = ""; };
    addEventListener("beforeunload", guard);

    const answered = () => qs.filter((q) => answers[q.questionId] !== undefined).length;

    function drawPalette() {
      pal.innerHTML = qs.map((q, i) => `<button type="button" data-i="${i}" class="${answers[q.questionId] !== undefined ? "answered" : ""}" ${i === idx ? 'aria-current="step"' : ""} aria-label="Question ${i + 1}${answers[q.questionId] !== undefined ? ", answered" : ", unanswered"}">${i + 1}</button>`).join("");
    }

    function drawQuestion(focus) {
      const q = qs[idx];
      const last = idx === qs.length - 1;
      qEl.innerHTML = `
        <p class="mono-label">Question ${idx + 1} of ${qs.length}${q.topic ? ` · ${esc(q.topic)}` : ""}</p>
        <h3 id="qt">${esc(q.question)}</h3>
        <fieldset class="opts" aria-labelledby="qt"><legend class="sr-only">Choose one answer</legend>
          ${q.options.map((o, i) => `<label class="opt"><input type="radio" name="ans" value="${i}" ${answers[q.questionId] === i ? "checked" : ""}><span>${esc(o)}</span></label>`).join("")}
        </fieldset>
        <div class="run-nav"><div class="grp">
          <button class="btn-pill" type="button" data-prev ${idx === 0 ? "disabled" : ""}>← Previous</button>
          ${last ? "" : '<button class="btn-pill" type="button" data-next>Next →</button>'}</div>
          <button class="btn-pill solid" type="button" data-submit>Submit test</button></div>
        <div data-confirm></div>`;
      $$("input[name=ans]", qEl).forEach((r) => r.addEventListener("change", () => { answers[q.questionId] = Number(r.value); drawPalette(); }));
      $("[data-prev]", qEl)?.addEventListener("click", () => go(idx - 1));
      $("[data-next]", qEl)?.addEventListener("click", () => go(idx + 1));
      $("[data-submit]", qEl).addEventListener("click", askConfirm);
      drawPalette();
      if (focus) $("h3", qEl).setAttribute("tabindex", "-1"), $("h3", qEl).focus({ preventScroll: true });
    }
    const go = (i) => { idx = Math.max(0, Math.min(qs.length - 1, i)); drawQuestion(true); };
    pal.addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (b) go(Number(b.dataset.i)); });

    function askConfirm() {
      const left = qs.length - answered();
      const box = $("[data-confirm]", qEl);
      box.innerHTML = `<div class="confirm-bar" role="alertdialog" aria-label="Confirm submit"><p>${left ? `${left} question${left > 1 ? "s are" : " is"} unanswered. ` : ""}Submit your test now?</p>
        <button class="btn-pill solid" type="button" data-yes>Yes, submit</button><button class="btn-pill" type="button" data-no>Keep going</button></div>`;
      $("[data-yes]", box).addEventListener("click", () => submit());
      $("[data-no]", box).addEventListener("click", () => (box.innerHTML = ""));
      $("[data-yes]", box).focus();
    }

    async function submit(auto = false) {
      if (submitting) return;
      submitting = true;
      stopRun();
      el.innerHTML = skeleton();
      try {
        const result = await api(`/api/mocktests/${encodeURIComponent(test.testId)}/submit`, { method: "POST", body: { startToken: test.startToken, answers } });
        showResult(result);
      } catch (e) {
        el.replaceChildren(errorBox(`${auto ? "Time's up, but we " : "We "}couldn't submit your answers: ${e.message}`, () => { submitting = false; if (e.status === 400 || e.status === 409) showTests(); else submit(auto); }));
      }
    }

    const timerEl = $("[data-timer]", el);
    const announce = $("[data-announce]", el);
    const tick = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / MS_PER_S));
      timerEl.textContent = fmtClock(left);
      timerEl.classList.toggle("low", left <= LOW_TIME_S);
      for (const s of ANNOUNCE_AT_S) if (left <= s && !announced.has(s)) { announced.add(s); announce.textContent = `${s / 60} minute${s > 60 ? "s" : ""} remaining.`; }
      if (left <= 0) submit(true);
    };
    timer = setInterval(tick, MS_PER_S);
    drawQuestion(false);
  }

  function showResult(r) {
    el.innerHTML = `
      <div class="panel-head"><p class="mono-label">Results</p><h1>${esc(r.title)}</h1><p>Graded on the server. Your attempt has been saved.</p></div>
      <div class="stat-row">
        <div class="hub-card"><strong>${r.score}/${r.total}</strong><span>Score</span></div>
        <div class="hub-card"><strong>${r.accuracy}%</strong><span>Accuracy</span></div>
        <div class="hub-card"><strong>${r.timeTakenMin} min</strong><span>Time taken</span></div>
      </div>
      <div class="hub-card" style="margin-bottom:20px"><h3 class="sec">Topic performance</h3>${topicBars(r.topics)}</div>
      <h2 style="margin:28px 0 14px;font-size:1.3rem">Review your answers</h2>${reviewList(r.review)}
      <div class="run-nav" style="margin-top:24px"><div class="grp"><button class="btn-pill" type="button" data-back>← Back to tests</button><button class="btn-pill solid" type="button" data-analysis>View analysis</button></div></div>`;
    $("[data-back]", el).addEventListener("click", showTests);
    $("[data-analysis]", el).addEventListener("click", showAnalysis);
    scrollTo({ top: 0 });
  }

  async function showAnalysis() {
    stopRun();
    el.innerHTML = head("analysis") + skeleton();
    wireTabs();
    let a;
    try { a = await api(`/api/mocktests/${encodeURIComponent(courseId)}/analysis`); }
    catch (e) { el.innerHTML = head("analysis"); wireTabs(); return el.append(errorBox(e.message, showAnalysis)); }
    if (!a.attempts.length) {
      el.innerHTML = head("analysis") + emptyState("No attempts yet", "Take a mock test and your analysis will appear here.", icon("mock"));
      return wireTabs();
    }
    const latest = a.attempts[a.attempts.length - 1];
    const best = Math.max(...a.attempts.map((x) => x.accuracy));
    const weak = a.topics.filter((t) => t.weak);
    el.innerHTML = head("analysis") + `
      <div class="stat-row">
        <div class="hub-card"><strong>${latest.score}/${latest.total}</strong><span>Latest score</span></div>
        <div class="hub-card"><strong>${latest.accuracy}%</strong><span>Latest accuracy</span></div>
        <div class="hub-card"><strong>${latest.timeTakenMin} min</strong><span>Time taken</span></div>
        <div class="hub-card"><strong>${best}%</strong><span>Best accuracy</span></div>
      </div>
      <div class="two-col">
        <div class="hub-card"><h3 class="sec">Topic performance (all attempts)</h3>${topicBars(a.topics)}
          ${weak.length ? `<p class="note-line">Focus on: <b>${weak.map((t) => esc(t.topic)).join(", ")}</b>.</p>` : '<p class="note-line">No weak topics. Great work.</p>'}</div>
        <div class="hub-card"><h3 class="sec">Accuracy trend</h3>${trendSvg(a.attempts)}</div>
      </div>
      <div class="hub-card"><h3 class="sec">Attempts history</h3><div class="scroll-x" tabindex="0" role="region" aria-label="Attempts history">
        <table class="hist"><thead><tr><th scope="col">Date</th><th scope="col">Test</th><th scope="col">Score</th><th scope="col">Accuracy</th><th scope="col">Time</th></tr></thead>
        <tbody>${[...a.attempts].reverse().map((x) => `<tr><td>${esc(fmtDate(x.date))}</td><td>${esc(x.testTitle)}</td><td>${x.score}/${x.total}</td><td>${x.accuracy}%</td><td>${x.timeTakenMin} min</td></tr>`).join("")}</tbody></table></div></div>`;
    wireTabs();
  }

  await showTests();
  return stopRun;
};
