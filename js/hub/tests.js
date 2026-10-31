// Practice Test and Final Exam, built natively. The questions, the scoring, the explanations, the Final Exam's shuffle, clock and draft all
// come from the server (/api/courses/F001/lab/*): the answer keys never reach the browser, and a refresh or a second browser continues the
// same exam. This file only draws the screens and holds the answers the student has picked so far.
// (The Final Exam was once called the "real" test; the step key "real-test" in the manifest keeps that old name, students only see "Final Exam".)
const TestsView = (() => {
  const AUTO_ADVANCE_MS = 380;
  const OPTION_LETTERS = "ABCD";
  const TICK_MS = 250;
  const WARN_BELOW_S = 120;
  const CRIT_BELOW_S = 30;
  const SECS_PER_MIN = 60;
  const MIN_NAME_CHARS = 3;
  const NAME_MAX = 40;
  const TEAM_MAX = 30;
  const GRADES = [9, 10, 11];
  const SAVE_DEBOUNCE_MS = 2000; // draft autosave: one save after the student stops picking answers
  const SAVE_RETRY_MS = 4000;
  const SUBMIT_TRIES = 5;
  const SUBMIT_RETRY_MS = 3000;
  const MS_PER_S = 1000;
  const CONFETTI_MIN_SCORE = 8;
  const CONFETTI_COUNT = { normal: 72, great: 120 };
  const MENTOR_ROLES = ["mentor", "admin"];
  const RING_R = 52;
  const RING_C = 2 * Math.PI * RING_R;
  const PASS_PCT = { great: 0.8, ok: 0.5 };
  // Internal slip-verification salt (the server signs slips with the same one). Do not change. Only the Mentor desk uses it in the browser.
  const SALT = "FoundersLab|MSBSS|GCEC|2026";

  // ---------- small helpers ----------
  const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
  const pad2 = (n) => String(n).padStart(2, "0");
  const clockText = (s) => { s = Math.max(0, Math.ceil(s)); return `${pad2(Math.floor(s / SECS_PER_MIN))}:${pad2(s % SECS_PER_MIN)}`; };
  const motionOk = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const copyText = (text) => (navigator.clipboard?.writeText(text).then(() => toast("Copied"), () => toast("Copy failed. Select the text instead.")))
    ?? toast("Copy failed. Select the text instead.");

  // Same hashing as the partner page: slips issued there still verify here.
  const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
  const code6 = (s) => { const h = fnv(s) ^ fnv(s.split("").reverse().join("") + "#"); return ("000000" + (h >>> 0).toString(36).toUpperCase()).slice(-6); };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // The Final Exam arrives already shuffled by the server, so the runner just shows the questions in the order given.
  const fixedOrder = (n) => Array.from({ length: n }, (_, qi) => ({ qi, o: [0, 1, 2, 3] }));
  const dense = (st) => st.order.map((_, i) => (st.ans[i] ?? null));
  const buildOrder = (test) => shuffle(test.qs.map((_, i) => i)).map((qi) => ({ qi, o: shuffle([0, 1, 2, 3]) }));
  const answeredOf = (st) => st.order.reduce((n, _, i) => n + (st.ans[i] != null ? 1 : 0), 0);
  const verdict = (sc, n) => {
    const p = sc / n;
    return p === 1 ? "Perfect score! Founder-level thinking." : p >= 0.8 ? "Excellent work!" : p >= 0.6 ? "Good job. Review the ones you missed."
      : p >= 0.4 ? "Not bad. Go back through the Study Notes once more." : "Keep going. Read the Study Notes again and retry.";
  };

  function scoreRing(sc, n) {
    const p = sc / n;
    const colour = p >= PASS_PCT.great ? "var(--teal)" : p >= PASS_PCT.ok ? "var(--gold)" : "var(--danger)";
    return `<div class="ts-ring" role="img" aria-label="${sc} out of ${n}">
      <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${RING_R}" fill="none" stroke="var(--track)" stroke-width="12"/>
        <circle class="rfill" cx="60" cy="60" r="${RING_R}" fill="none" stroke="${colour}" stroke-width="12" stroke-linecap="round"
          stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}" data-to="${RING_C * (1 - p)}" transform="rotate(-90 60 60)"/></svg>
      <div class="ts-ring-t" aria-hidden="true"><b>${sc}</b><span>out of ${n}</span></div></div>`;
  }
  function animateRing(root) {
    const r = $(".rfill", root);
    if (!r) return;
    requestAnimationFrame(() => r.setAttribute("stroke-dashoffset", r.dataset.to));
  }
  const celebrate = (sc, n) => { if (sc >= CONFETTI_MIN_SCORE) confetti(sc === n ? CONFETTI_COUNT.great : CONFETTI_COUNT.normal); };

  // ---------- page scaffold: panel (left) + reading area, with the narrow-screen bar ----------
  function scaffold(el, { title, sub }) {
    el.innerHTML = `<div class="rs ts"><div class="rs-layout">
      <aside class="rs-side" aria-label="${esc(title)} progress" data-side></aside>
      <div class="rs-read">
        <header class="rs-head"><div class="rs-row"><h1>${esc(title)}</h1><p class="ts-who" data-who></p></div><p class="rs-sub">${esc(sub)}</p></header>
        <details class="nt-toc-m ts-bar" data-bar hidden><summary></summary><div class="ts-bar-body" data-bar-body></div></details>
        <p class="sr-only" role="status" aria-live="polite" data-say></p>
        <div class="ts-main" data-main></div>
      </div></div></div>`;
    const side = $("[data-side]", el);
    const bar = $("[data-bar]", el);
    const barSummary = $("summary", bar);
    const barBody = $("[data-bar-body]", el);
    const main = $("[data-main]", el);
    const sayEl = $("[data-say]", el);
    const hosts = [side, barBody];
    let settled = false; // the first render is page load, not a state change: don't pull focus then

    return {
      main,
      say: (msg) => { sayEl.textContent = msg; },
      who: (text) => { $("[data-who]", el).textContent = text; },
      // Orientation panel for the states that are not a running test (intro, keys, details, results).
      stages({ status, stages, stage }) {
        bar.hidden = true;
        side.innerHTML = `<nav aria-label="${esc(title)} steps"><p class="rs-ph-t">${esc(title)}</p><p class="rs-ph-s">${esc(status)}</p>
          <ol class="toc-list ts-stages">${stages.map((s, i) => `
            <li><div class="toc-item${i < stage ? " is-done" : ""}"${i === stage ? ' aria-current="step"' : ""}>
              <span class="toc-n" aria-hidden="true">${i < stage ? CHECK : i + 1}</span><span class="toc-t">${esc(s)}</span>${i < stage ? '<span class="sr-only">(done)</span>' : ""}</div></li>`).join("")}</ol></nav>`;
      },
      // Panel for a running test: progress bar, question grid and (Final Exam) the timer.
      testPanel(total, timed) {
        const clock = timed ? `<div class="ts-clock" role="timer" aria-label="Time left" data-level="ok"><span data-clock></span><small data-clock-note></small></div>` : "";
        side.innerHTML = `<nav aria-label="Questions"><p class="rs-ph-t">${esc(title)}</p><p class="rs-ph-s" data-count></p>
          <div class="nt-track" role="progressbar" aria-label="Questions answered" aria-valuemin="0" aria-valuemax="${total}"><i data-fill></i></div>
          ${clock}<ol class="ts-grid" data-grid></ol></nav>`;
        barSummary.innerHTML = `<span>${esc(title)}</span><small data-count></small>${timed ? '<span class="ts-bar-clock" data-clock data-level="ok"></span>' : ""}`;
        barBody.innerHTML = '<ol class="ts-grid" data-grid></ol>';
        bar.hidden = false;
      },
      updateTest({ st, cur }) {
        const total = st.order.length;
        const n = answeredOf(st);
        const text = `${n} of ${total} answered`;
        $$("[data-count]", el).forEach((c) => { c.textContent = text; });
        const track = $(".nt-track", side);
        track.setAttribute("aria-valuenow", n);
        $("[data-fill]", track).style.width = `${(n / total) * 100}%`;
        const grid = st.order.map((_, i) => {
          const a = st.ans[i] != null;
          return `<li><button type="button" class="ts-g${a ? " is-ans" : ""}" data-i="${i}"${i === cur ? ' aria-current="step"' : ""} aria-label="Question ${i + 1}, ${a ? "answered" : "not answered"}">${i + 1}</button></li>`;
        }).join("");
        hosts.forEach((h) => { const g = $("[data-grid]", h); if (g) g.innerHTML = grid; });
      },
      setClock(left) {
        const level = left < CRIT_BELOW_S ? "crit" : left < WARN_BELOW_S ? "warn" : "ok";
        const note = level === "crit" ? "Under 30 seconds" : level === "warn" ? "Under 2 minutes" : "";
        $$("[data-clock]", el).forEach((c) => { c.textContent = clockText(left); c.dataset.level = level; });
        $$(".ts-clock", el).forEach((c) => { c.dataset.level = level; });
        $$("[data-clock-note]", el).forEach((c) => { c.textContent = note; });
        return level;
      },
      settle() { settled = true; },
      focusHeading() { if (!settled) return; $("h2[tabindex]", main)?.focus({ preventScroll: true }); scrollTo({ top: 0 }); },
      // assigned, not added: a new runner (new shuffle) replaces the old one's handler instead of stacking on it
      onGrid(fn) { hosts.forEach((h) => { h.onclick = (e) => { const b = e.target.closest("[data-i]"); if (b) fn(Number(b.dataset.i)); }; }); },
    };
  }

  // ---------- the question runner shared by both tests ----------
  function runner(ui, { test, st, onSave, onSubmit }) {
    const total = st.order.length;
    let cur = Math.max(0, st.order.findIndex((_, i) => st.ans[i] == null));
    let advance = null;
    let armed = false;

    function refresh() { ui.updateTest({ st, cur }); }
    function disarm() {
      armed = false;
      const b = $("[data-submit]", ui.main);
      if (b) b.textContent = "Submit test";
    }

    function draw() {
      const o = st.order[cur];
      const q = test.qs[o.qi];
      const last = cur === total - 1;
      ui.main.innerHTML = `<div class="ts-col">
        <p class="ts-qn">Question ${cur + 1} of ${total}</p>
        <h2 class="ts-q" id="ts-q" tabindex="-1">${esc(q.q)}</h2>
        <div class="ts-opts" role="group" aria-labelledby="ts-q">${o.o.map((oi, k) => `
          <button type="button" class="ts-opt" data-k="${k}" aria-pressed="${st.ans[cur] === oi}"><span class="ts-ol" aria-hidden="true">${OPTION_LETTERS[k]}</span><span class="ts-ot">${esc(q.o[oi])}</span></button>`).join("")}</div>
        <div class="ts-nav">
          <button type="button" class="btn-pill" data-prev${cur === 0 ? " disabled" : ""}><span aria-hidden="true">←</span> Back</button>
          <button type="button" class="btn-pill" data-next${last ? " disabled" : ""}>Next <span aria-hidden="true">→</span></button>
          <button type="button" class="btn-pill solid push" data-submit>Submit test</button>
        </div>
        <p class="ts-keys">Tip: press 1–4 or A–D to answer, and the arrow keys to go back or forward.</p></div>`;
      armed = false;
      refresh();
    }

    function go(i, announce = true) {
      clearTimeout(advance);
      cur = Math.max(0, Math.min(total - 1, i));
      draw();
      ui.focusHeading();
      if (announce) ui.say(`Question ${cur + 1} of ${total}`);
    }

    function choose(k) {
      const o = st.order[cur];
      if (k < 0 || k >= o.o.length) return;
      clearTimeout(advance);
      st.ans[cur] = o.o[k];
      onSave?.();
      $$(".ts-opt", ui.main).forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.k) === k)));
      disarm();
      refresh();
      ui.say(`Answer ${OPTION_LETTERS[k]} selected. ${answeredOf(st)} of ${total} answered.`);
      if (cur < total - 1) {
        const at = cur;
        advance = setTimeout(() => { if (cur === at && st.ans[at] != null) go(at + 1); }, AUTO_ADVANCE_MS);
      }
    }

    function submitPressed() {
      const n = answeredOf(st);
      if (!armed) {
        armed = true;
        const msg = n < total ? `Only ${n} answered. Tap again to submit` : "Tap again to confirm";
        $("[data-submit]", ui.main).textContent = msg;
        ui.say(msg);
        return;
      }
      onSubmit();
    }

    ui.main.onclick = (e) => {
      const opt = e.target.closest(".ts-opt");
      if (opt) return choose(Number(opt.dataset.k));
      if (e.target.closest("[data-prev]")) return go(cur - 1);
      if (e.target.closest("[data-next]")) return go(cur + 1);
      if (e.target.closest("[data-submit]")) submitPressed();
    };
    ui.onGrid((i) => go(i));

    // 1-4 / A-D choose, arrows move. Ignored while typing in a field or with a modifier held.
    function onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const k = OPTION_LETTERS.indexOf(key) >= 0 ? OPTION_LETTERS.indexOf(key) : "1234".indexOf(key);
      if (k >= 0 && key.length === 1) { e.preventDefault(); return choose(k); }
      if (key === "ArrowLeft" && cur > 0) { e.preventDefault(); go(cur - 1); }
      if (key === "ArrowRight" && cur < total - 1) { e.preventDefault(); go(cur + 1); }
    }
    document.addEventListener("keydown", onKey);

    draw();
    return {
      destroy() { clearTimeout(advance); document.removeEventListener("keydown", onKey); ui.main.onclick = null; },
      // While a server call is out: no second submit. If it fails, the questions and answers stay and the student can try again.
      lock(msg) { const b = $("[data-submit]", ui.main); if (b) { b.disabled = true; b.textContent = msg; } ui.say(msg); },
      fail(msg) {
        const b = $("[data-submit]", ui.main);
        if (b) { b.disabled = false; b.textContent = "Try submitting again"; }
        armed = false;
        let e = $(".ts-err", ui.main);
        if (!e) { e = document.createElement("p"); e.className = "ts-err"; e.setAttribute("role", "alert"); ui.main.firstElementChild.append(e); }
        e.textContent = msg;
        ui.say(msg);
      },
    };
  }

  // ---------- Practice Test ----------
  // Questions come from the server without answers; the score and every explanation come back only from the submit.
  async function mountPractice(el, { session }) {
    const { questions, total: n } = await Founders.lab(session.id, "practice");
    const test = { qs: questions };
    const ui = scaffold(el, { title: "Practice Test", sub: `Warm up with ${n} questions before the Final Exam.` });
    const STAGES = ["Start", "Answer", "Review"];
    let active = null;
    const stop = () => { active?.destroy(); active = null; };

    function intro() {
      stop();
      ui.stages({ status: "Not started", stages: STAGES, stage: 0 });
      ui.main.innerHTML = `<div class="ts-col"><h2 class="ts-h2" tabindex="-1">Practice test</h2>
        <p class="ts-lead">${n} questions, no timer. You'll see your score with an explanation for every answer. Finishing it is one of the requirements for the Final Exam, and you can retake it as often as you like.</p>
        <button type="button" class="btn-pill solid ts-big" data-start>Start practice</button></div>`;
      $("[data-start]", ui.main).addEventListener("click", begin);
    }

    function begin() {
      stop();
      const st = { order: buildOrder(test), ans: [] };
      ui.stages({ status: "", stages: STAGES, stage: 1 });
      ui.testPanel(n, false);
      active = runner(ui, { test, st, onSubmit: () => check(st) });
      ui.focusHeading();
      ui.say(`Question 1 of ${n}`);
    }

    async function check(st) {
      active.lock("Checking your answers…");
      // The server wants the answers in the questions' original order.
      const answers = test.qs.map((_, qi) => st.ans[st.order.findIndex((o) => o.qi === qi)] ?? null);
      let result;
      try {
        result = await Founders.lab(session.id, "practice", { method: "POST", body: { answers } });
      } catch (e) {
        return active.fail(e.message || "Couldn't check your answers. Please try again.");
      }
      Founders.recordPractice(session.id);
      finish(st, result);
    }

    function finish(st, result) {
      stop();
      const sc = result.score;
      const ready = Founders.summary(Hub.manifest).sessions.find((x) => x.id === session.id).gate.unlocked;
      ui.stages({ status: `Score ${sc} of ${n}`, stages: STAGES, stage: 2 });
      const review = st.order.map((o, i) => {
        const q = test.qs[o.qi];
        const key = result.review[o.qi];
        const me = st.ans[i];
        const ok = me === key.a;
        return `<li class="ts-rv-i ${ok ? "ok" : "no"}"><span class="ts-mark" aria-hidden="true">${ok ? "✓" : "✕"}</span>
          <div><p class="ts-rv-q"><span class="sr-only">${ok ? "Correct. " : "Incorrect. "}</span>${i + 1}. ${esc(q.q)}</p>
            ${ok ? "" : `<p>Your answer: <s>${me == null ? "(skipped)" : esc(q.o[me])}</s></p>`}
            <p>Correct: <b>${esc(q.o[key.a])}</b></p><p class="ts-why">${esc(key.why)}</p></div></li>`;
      }).join("");
      ui.main.innerHTML = `<div class="ts-col">
        <div class="ts-res">${scoreRing(sc, n)}<div><h2 class="ts-h2 big" tabindex="-1">${esc(verdict(sc, n))}</h2><p class="ts-muted">Your practice result is saved. You can retake it as often as you like.</p></div></div>
        <section class="ts-status${ready ? " is-ready" : ""}" aria-label="Final Exam requirements"><span class="ts-tick" aria-hidden="true">${CHECK}</span>
          <p>${ready ? "You're ready. The Final Exam is unlocked." : "Practice done. Finish the rest of Resources to unlock the Final Exam"}</p>
          ${ready ? `<a class="btn-pill solid" href="${esc(Founders.hash(Hub.manifest, session.id, "real-test"))}">Go to Final Exam</a>` : ""}</section>
        <h2 class="ts-h2 spaced">Review every answer</h2><ol class="ts-rv">${review}</ol>
        <button type="button" class="btn-pill ts-big" data-again>Try a new shuffle</button></div>`;
      $("[data-again]", ui.main).addEventListener("click", begin);
      animateRing(ui.main);
      ui.focusHeading();
      ui.say(`Practice finished. You scored ${sc} out of ${n}. ${ready ? "The Final Exam is unlocked." : "Finish the rest of Resources to unlock the Final Exam."}`);
      celebrate(sc, n);
    }

    intro();
    ui.settle();
    return stop;
  }

  // ---------- Final Exam ----------
  // The server decides everything that matters: whether the exam is unlocked, the one attempt, the shuffle, the clock (the
  // countdown here is only derived from the seconds it reports), the saved draft and the score. A refresh, or another browser,
  // asks the server where the exam stands and continues from there.
  async function mountFinal(el, { session }) {
    let status = await Founders.lab(session.id, "exam");
    const n = status.total ?? status.slip?.n;
    const ui = scaffold(el, { title: "Final Exam", sub: `${n} questions${status.minutes ? `, ${status.minutes} minutes` : ""}, one try.` });
    const STAGES = ["Requirements", "Your details", "Exam", "Score slip"];
    let active = null;
    let timer = null;
    let saveTimer = null;
    let alive = true;
    const stop = () => { active?.destroy(); active = null; clearTimeout(timer); timer = null; clearTimeout(saveTimer); saveTimer = null; };

    let view = ""; // what is on screen ("req", "details", ...), so live updates know what they may redraw
    let sig = "";
    const gate = () => Founders.summary(Hub.manifest).sessions.find((x) => x.id === session.id).gate;
    const reqSig = (g) => g.requirements.map((r) => `${r.have}/${r.need}`).join();

    // A score slip or an exam in progress always wins; otherwise the server says whether it is unlocked.
    function start(s = status, quiet = true) {
      status = s;
      if (s.state === "submitted") { Founders.recordExam(session.id, "submitted", s.slip); return showSlip(s.slip, true); }
      if (s.state === "in_progress") { Founders.recordExam(session.id, "in_progress"); return exam(s); }
      if (s.state === "ready") return details(quiet);
      requirements(quiet);
    }

    const rowStatus = (r) => (r.key === "practice" ? (r.done ? "Completed" : "Not taken yet")
      : r.done ? "Complete" : `${r.have} of ${r.need} ${r.key === "activities" ? "games" : "sections"} done`);

    function requirements(quiet = false) {
      stop();
      view = "req";
      const g = gate();
      sig = reqSig(g);
      ui.who("");
      ui.stages({ status: `${g.have} of ${g.need} parts done`, stages: STAGES, stage: 0 });
      ui.main.innerHTML = `<div class="ts-col ts-req">
        <h2 class="ts-h2" tabindex="-1">Finish these first to unlock the Final Exam</h2>
        <ul class="ts-list">${g.requirements.map((r) => `
          <li class="ts-row${r.done ? " is-done" : ""}"><span class="ts-tick" aria-hidden="true">${r.done ? CHECK : ""}</span>
            <div class="ts-row-t"><b>${esc(r.label)}</b><span>${rowStatus(r)}</span></div>
            ${r.done ? "" : `<a class="btn-pill sm" href="${esc(Founders.hash(Hub.manifest, session.id, r.key))}" aria-label="${r.key === "practice" ? "Start" : "Continue"} ${esc(r.label)}">${r.key === "practice" ? "Start" : "Continue"}</a>`}</li>`).join("")}</ul>
        <div class="nt-track ts-parts-bar" role="progressbar" aria-label="Requirement parts done" aria-valuemin="0" aria-valuemax="${g.need}" aria-valuenow="${g.have}"><i style="width:${(g.have / g.need) * 100}%"></i></div>
        <p class="ts-parts">${g.have} of ${g.need} parts done</p>
        <button type="button" class="btn-pill solid ts-big" disabled aria-describedby="ts-lock-hint">Start the Final Exam</button>
        <p class="ts-hint" id="ts-lock-hint">Complete all three to unlock</p></div>`;
      if (!quiet) ui.focusHeading();
    }

    // Re-check when progress changes (another tab, a finished game, coming back to this tab). The server has the last word.
    async function refresh() {
      if (!alive) return;
      if (view === "req") {
        const g = gate();
        if (g.unlocked) {
          try {
            const s = await Founders.lab(session.id, "exam");
            if (alive && view === "req" && s.state !== "locked") { ui.say("All requirements complete. Enter your details to start the exam."); return start(s); }
          } catch { /* stay on the requirements page */ }
        } else if (reqSig(g) !== sig) { requirements(true); ui.say(`${g.have} of ${g.need} parts done`); }
      } else if (view === "details" && gate().locked) requirements(true);
    }

    function details(quiet = false) {
      stop();
      view = "details";
      ui.who("");
      ui.stages({ status: "Unlocked", stages: STAGES, stage: 1 });
      ui.main.innerHTML = `<form class="ts-col ts-form" novalidate>
        <p class="ts-ok"><span class="ts-tick" aria-hidden="true">${CHECK}</span>All requirements complete</p>
        <h2 class="ts-h2" tabindex="-1">Who is taking the exam?</h2>
        <div class="ts-fields three">
          <div class="ts-fld"><label for="ts-name">Full name</label><input id="ts-name" maxlength="${NAME_MAX}" autocomplete="name" aria-describedby="ts-err"></div>
          <div class="ts-fld"><label for="ts-grade">Grade</label><select id="ts-grade" aria-describedby="ts-err"><option value="">Choose</option>${GRADES.map((g) => `<option>${g}</option>`).join("")}</select></div>
          <div class="ts-fld"><label for="ts-team">Team name</label><input id="ts-team" maxlength="${TEAM_MAX}" autocomplete="off" aria-describedby="ts-err"></div>
        </div>
        <ul class="ts-rules">
          <li><b>${status.minutes} minutes</b><span>The timer starts when you tap Start and keeps running if you refresh or switch device.</span></li>
          <li><b>Shuffled order</b><span>Your order is shuffled, so it differs from your neighbour's.</span></li>
          <li><b>One try</b><span>You can submit once. You will see only your score.</span></li>
        </ul>
        <button type="submit" class="btn-pill solid ts-big">Start the exam</button>
        <p class="ts-err" id="ts-err" role="alert"></p></form>`;
      $("form", ui.main).addEventListener("submit", async (e) => {
        e.preventDefault();
        const nameEl = $("#ts-name", ui.main), gradeEl = $("#ts-grade", ui.main), teamEl = $("#ts-team", ui.main);
        const errEl = $("#ts-err", ui.main), btn = $("button[type=submit]", ui.main);
        // "|" separates the slip fields, so it can never appear inside one.
        const name = nameEl.value.trim().replace(/\|/g, "/");
        const grade = gradeEl.value;
        const team = teamEl.value.trim().replace(/\|/g, "/");
        const bad = [[name.length < MIN_NAME_CHARS, nameEl], [!grade, gradeEl], [!team, teamEl]].filter(([b]) => b);
        [nameEl, gradeEl, teamEl].forEach((x) => x.removeAttribute("aria-invalid"));
        if (bad.length) {
          bad.forEach(([, x]) => x.setAttribute("aria-invalid", "true"));
          errEl.textContent = "Please fill in your full name, grade and team.";
          return bad[0][1].focus();
        }
        btn.disabled = true;
        errEl.textContent = "";
        try {
          const body = await Founders.lab(session.id, "exam/start", { method: "POST", body: { name, grade, team } });
          Founders.recordExam(session.id, "in_progress");
          exam(body);
        } catch (err) {
          btn.disabled = false;
          // Already started or taken (another tab, or a double tap): show where the exam really stands.
          if (err.status === 409) { try { return start(await Founders.lab(session.id, "exam")); } catch { /* fall through to the message */ } }
          errEl.textContent = err.message || "Couldn't start the exam. Please try again.";
        }
      });
      if (!quiet) ui.focusHeading();
    }

    function exam(body) {
      stop();
      view = "exam";
      const endsAt = Date.now() + body.remaining * MS_PER_S; // the server's remaining seconds, turned into a local deadline
      const test = { qs: body.questions };
      const st = { order: fixedOrder(test.qs.length), ans: body.answers.slice() };
      let finishing = false;
      let saving = false;
      const said = new Set();
      ui.who(`${body.name} · Grade ${body.grade} · ${body.team}`);
      ui.stages({ status: "", stages: STAGES, stage: 2 });
      ui.testPanel(n, true);

      const left = () => (endsAt - Date.now()) / MS_PER_S;

      // Draft autosave: shortly after the last pick, the answers so far go to the server.
      async function saveDraft() {
        if (finishing || saving) return;
        saving = true;
        try {
          await Founders.lab(session.id, "exam/save", { method: "POST", body: { answers: dense(st) } });
        } catch (err) {
          saving = false;
          if (err.status === 409) return submit(); // the server says the exam is closed: collect the result
          saveTimer = setTimeout(saveDraft, SAVE_RETRY_MS);
          return;
        }
        saving = false;
      }
      const queueSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, SAVE_DEBOUNCE_MS); };

      async function submit() {
        if (finishing) return;
        finishing = true;
        clearTimeout(timer); clearTimeout(saveTimer);
        active?.destroy(); active = null;
        ui.main.innerHTML = '<div class="ts-col"><h2 class="ts-h2" tabindex="-1">Submitting your exam…</h2><p class="ts-muted" role="status">Please keep this page open.</p></div>';
        ui.say("Submitting your exam");
        for (let attempt = 1; ; attempt++) {
          try {
            const r = await Founders.lab(session.id, "exam/submit", { method: "POST", body: { answers: dense(st) } });
            Founders.recordExam(session.id, "submitted", r.slip);
            return alive && showSlip(r.slip, false);
          } catch (err) {
            if (!alive) return;
            if (attempt < SUBMIT_TRIES) { await sleep(SUBMIT_RETRY_MS); continue; }
            // Nothing is lost: the draft is on the server and the exam closes by itself at the deadline.
            ui.main.replaceChildren(errorBox(`${err.message || "We couldn't reach the server."} Your answers are saved. Try again.`, () => { finishing = false; submit(); }));
            return;
          }
        }
      }

      active = runner(ui, { test, st, onSave: queueSave, onSubmit: submit });
      ui.focusHeading();

      (function tick() {
        if (finishing) return;
        const t = left();
        const level = ui.setClock(t);
        if (level === "crit" && !said.has("crit")) { said.add("crit").add("warn"); ui.say("30 seconds left"); }
        else if (level === "warn" && !said.has("warn")) { said.add("warn"); ui.say("2 minutes left"); }
        if (t <= 0) { toast("Time is up! Submitting..."); ui.say("Time is up! Submitting..."); return submit(); }
        timer = setTimeout(tick, TICK_MS);
      })();
    }

    function showSlip(s, again) {
      stop();
      view = "slip";
      ui.who(`${s.name} · Grade ${s.grade} · ${s.team}`);
      ui.stages({ status: `Submitted: ${s.score} of ${s.n}`, stages: STAGES, stage: STAGES.length - 1 });
      ui.main.innerHTML = `<div class="ts-col">
        <div class="ts-res">${scoreRing(s.score, s.n)}<div><h2 class="ts-h2 big" tabindex="-1">${again ? "You have already taken this exam" : esc(verdict(s.score, s.n))}</h2>
          <p class="ts-muted">${esc(s.name)} · Grade ${esc(s.grade)} · Team ${esc(s.team)} · time ${esc(s.time)}</p></div></div>
        <section class="ts-slip" aria-labelledby="ts-slip-l"><p class="ts-lab" id="ts-slip-l">Your score slip</p><h3>Send this to your mentor</h3>
          <p>Copy the whole line below and send it the way your mentor asks (class group or form). The code at the end proves the score is real.</p>
          <div class="ts-slipline">${esc(s.line)}</div><button type="button" class="btn-pill sm" data-copy>Copy score slip</button></section></div>`;
      $("[data-copy]", ui.main).addEventListener("click", () => copyText(s.line));
      animateRing(ui.main);
      ui.focusHeading();
      ui.say(again ? "You have already taken this exam." : `Exam submitted. You scored ${s.score} out of ${s.n}.`);
      if (!again) celebrate(s.score, s.n);
    }

    start(status);
    ui.settle();
    const unwatch = Founders.watch(refresh);
    return () => { alive = false; unwatch(); stop(); };
  }

  // ---------- Mentor desk (#final/mentor-desk) ----------
  // TODO(roles): /api/me returns { name, email, studentId } only, so no user has a role yet and this page is never reachable.
  // When the server adds `role` to /api/me (from the Students sheet), mentors and admins get it automatically. The slip check itself is
  // client-side with a public salt, exactly like the partner page, so this gate hides a tool; it is not a security boundary.
  const canUseDesk = (user) => MENTOR_ROLES.includes(String(user?.role ?? "").toLowerCase());

  function verifySlip(line) {
    const p = line.split("|").map((x) => x.trim());
    const FIELDS = 8; // 7 slip fields plus the code
    if (p.length !== FIELDS) return null;
    const code = p.pop();
    return { s: p[0], name: p[1], grade: p[2].replace(/^Gr\s*/, ""), team: p[3], score: p[4], time: p[5], ts: p[6], code, ok: code6(p.join("|") + "|" + SALT) === code.toUpperCase() };
  }

  function mountDesk(el, { session }) {
    const ui = scaffold(el, { title: "Mentor desk", sub: "Paste score slips to check them and build a table." });
    ui.stages({ status: "Check score slips", stages: ["Paste slips", "Check", "Copy table"], stage: 0 });
    ui.main.innerHTML = `<div class="ts-col wide"><h2 class="ts-h2" tabindex="-1">Mentor desk</h2>
      <p class="ts-lead">Paste students' score slips below, one per line. Each slip is checked and turned into a table you can paste into Google Sheets or Excel.</p>
      <label class="sr-only" for="ts-slips">Score slips, one per line</label>
      <textarea id="ts-slips" class="ts-area" rows="6" placeholder="FL-S1 | Aarav Sharma | Gr 10 | Rocket | 8/10 | 6m 12s | 2026-10-22 11:40 | ABC123"></textarea>
      <div class="ts-nav"><button type="button" class="btn-pill solid" data-check>Check slips</button><button type="button" class="btn-pill" data-copy disabled>Copy table</button></div>
      <div class="ts-table-wrap" data-table tabindex="0" role="region" aria-label="Checked slips" hidden></div></div>`;
    let rows = [];
    const own = `FL-${session.id.toUpperCase()}`;
    $("[data-check]", ui.main).addEventListener("click", () => {
      rows = $("#ts-slips", ui.main).value.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => verifySlip(l) ?? { bad: l });
      const seen = new Set();
      const body = rows.map((r) => {
        if (r.bad) return `<tr class="x"><td>Unreadable</td><td colspan="6">${esc(r.bad)}</td></tr>`;
        const k = (r.name + r.grade).toLowerCase();
        const dup = seen.has(k);
        seen.add(k);
        const label = r.s !== own ? "Other session" : r.ok ? (dup ? "Valid (repeat)" : "Valid") : "Edited / fake";
        return `<tr class="${r.ok && r.s === own ? "" : "x"}"><td>${label}</td><td>${esc(r.name)}</td><td>${esc(r.grade)}</td><td>${esc(r.team)}</td><td>${esc(r.score)}</td><td>${esc(r.time)}</td><td>${esc(r.ts)}</td></tr>`;
      }).join("");
      const wrap = $("[data-table]", ui.main);
      wrap.hidden = !rows.length;
      wrap.innerHTML = `<table class="ts-table"><thead><tr><th scope="col">Check</th><th scope="col">Name</th><th scope="col">Grade</th><th scope="col">Team</th><th scope="col">Score</th><th scope="col">Time</th><th scope="col">Submitted</th></tr></thead><tbody>${body}</tbody></table>`;
      $("[data-copy]", ui.main).disabled = !rows.length;
      ui.say(`${rows.length} slip${rows.length === 1 ? "" : "s"} checked`);
    });
    $("[data-copy]", ui.main).addEventListener("click", () => {
      const table = "Check\tName\tGrade\tTeam\tScore\tTime\tSubmitted\n"
        + rows.filter((r) => !r.bad).map((r) => [r.ok ? "Valid" : "Invalid", r.name, r.grade, r.team, r.score, r.time, r.ts].join("\t")).join("\n");
      copyText(table);
    });
    return () => {};
  }

  return { mountPractice, mountFinal, mountDesk, canUseDesk, code6, verifySlip };
})();
