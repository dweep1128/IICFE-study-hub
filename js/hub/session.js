// The session page: session.html?course=F001&s=1#overview | #notes | #activities | #tests[/practice|/final]
// Left: the session content panel (back button, progress, video, notes, activities, tests). Right: the video, the title and four tabs.
// Content comes from the session's data file (manifest session.data); the notes, the activities and the tests are the existing views
// (notes.js, activities.js, tests.js). Every count and tick is read from Founders.summary(), the same source as the Sessions list.
// The server keeps every rule: the Final Exam unlock, the clock, the answer keys, and whether an upload is recorded.
const CHECK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const Hub = { manifest: null, user: null }; // tests.js reads Hub.manifest

(() => {
  const SIDE_KEY = "iicfe-session-side"; // "closed" when the student hid the panel on a wide screen
  const KEYS = { left: "ArrowLeft", right: "ArrowRight", home: "Home", end: "End" };
  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "notes", label: "Study Notes", key: "study-notes" },
    { id: "activities", label: "Activities", key: "activities" },
    { id: "tests", label: "Assessment" },
  ];
  const TEST_KEY = { practice: "practice", final: "real-test" };
  const allSessionsHref = () => `course.html?id=${Founders.COURSE_ID}#sessions`;

  const store = {
    get: () => { try { return localStorage.getItem(SIDE_KEY); } catch { return null; } },
    set: (v) => { try { localStorage.setItem(SIDE_KEY, v); } catch { /* the choice lasts for this page only */ } },
  };

  // "#tests/practice" -> { tab: "tests", sub: "practice" }; anything unknown opens the Overview.
  function readHash() {
    const [t, sub = ""] = location.hash.slice(1).split("/");
    return { tab: TABS.some((x) => x.id === t) ? t : "overview", sub };
  }

  const ring = (inner) => `<span class="toc-n" aria-hidden="true">${inner}</span>`;
  const row = ({ open, label, sub = "", inner, done = false, current = false, locked = false, disabled = false }) =>
    `<li><button type="button" class="toc-item${done ? " is-done" : ""}${locked ? " is-locked" : ""}" data-open="${esc(open)}"${current ? ' aria-current="true"' : ""}${disabled ? " disabled" : ""}>
      ${ring(inner)}<span class="toc-t">${esc(label)}${sub ? `<small class="sd-sub">${esc(sub)}</small>` : ""}</span>
      ${done ? '<span class="sr-only">(done)</span>' : ""}${locked ? '<span class="sr-only">(locked)</span>' : ""}</button></li>`;

  function message(shell, title, text, href, label) {
    shell.panel.innerHTML = `<div class="box empty"><div class="empty-ic">${icon("lock")}</div><h1 class="empty-title">${esc(title)}</h1><p>${esc(text)}</p>
      <p><a class="btn-pill solid" href="${esc(href)}"><span aria-hidden="true">←</span> ${esc(label)}</a></p></div>`;
  }

  // ---------- Overview ----------
  function mountOverview(host, ctx) {
    const s = ctx.data.session;
    const learn = ctx.data.notes?.[0]?.blocks.find((b) => b.type === "list")?.items ?? [];
    const facts = [["Date", s.date], ["Time", s.time], ["Venue", s.venue]].filter(([, v]) => v);
    host.innerHTML = `<div class="sd-ov">
      <section><h2>About this session</h2><p class="sd-lead">${richHtml(s.notesIntro ?? "")}</p>
        ${facts.length ? `<dl class="sd-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}</section>
      ${learn.length ? `<section><h2>What you’ll learn</h2><ul class="sd-learn">${learn.map((t) => `<li><span aria-hidden="true">${CHECK}</span><span>${richHtml(t)}</span></li>`).join("")}</ul></section>` : ""}
      <section><h2>Your progress</h2><div data-prog></div></section></div>`;
    const draw = () => {
      const ss = ctx.summary();
      const pct = ctx.percent();
      const next = ss.items.find((it) => !it.done && !(it.key === "real-test" && ss.gate.locked));
      const target = { "study-notes": "notes", activities: "activities", practice: "tests/practice", "real-test": "tests/final" }[next?.key];
      $("[data-prog]", host).innerHTML = `<div class="ss2-ovbar"><div class="nt-track" role="progressbar" aria-label="Session progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>
        ${next ? `<p class="ss2-next">Up next: <a href="#${target}">${esc(next.label)} <span aria-hidden="true">→</span></a></p>` : '<p class="ss2-next is-done">Session complete. Well done.</p>'}`;
    };
    draw();
    return { refresh: draw, destroy() {} };
  }

  // ---------- Tests: two option cards, and the running test in place of them ----------
  function mountTests(host, ctx) {
    let cleanup = null, seq = 0;
    const reset = () => { seq++; cleanup?.(); cleanup = null; };

    function cards() {
      reset();
      const ss = ctx.summary();
      const practice = ss.items.find((i) => i.key === "practice"), exam = ss.items.find((i) => i.key === "real-test");
      const info = Founders.practiceInfo(ss.id);
      const gate = ss.gate;
      const locked = gate.locked && !exam.done;
      const examState = exam.done ? "done" : exam.started ? "progress" : locked ? "locked" : "ready";
      const pendingLinks = gate.missing.map((r) => {
        const to = { "study-notes": "notes", activities: "activities", practice: "tests/practice" }[r.key];
        return `<li><a href="#${to}">${esc(r.key === "practice" ? r.label : `${r.label} ${r.have}/${r.need}`)}</a></li>`;
      }).join("");
      const stat = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
      host.innerHTML = `<div class="ss2-tests">
        <article class="ss2-card" data-card="practice" data-state="${practice.done ? "done" : "todo"}" aria-labelledby="tc-p">
          <header><span class="ss2-card-ic" aria-hidden="true">P</span><div><h2 id="tc-p">Practice Test</h2><p>No timer. Retake it as often as you like.</p></div>
            <span class="pt-tag ${practice.done ? "is-ok" : "is-neutral"}">${practice.done ? "Completed" : "Not started"}</span></header>
          <dl class="ss2-stats">${stat("Best score", info ? `${info.best ?? info.score}/${info.total}` : "–")}${stat("Attempts", info?.attempts ?? 0)}</dl>
          <footer><a class="btn-pill solid" href="#tests/practice">${practice.done ? "Retake practice" : "Start practice"}</a></footer>
        </article>
        <article class="ss2-card" data-card="final" data-state="${examState}" aria-labelledby="tc-f">
          <header><span class="ss2-card-ic" aria-hidden="true">${locked ? icon("lock") : "F"}</span><div><h2 id="tc-f">Final Exam</h2><p>One try. The server keeps the clock.</p></div>
            <span class="pt-tag ${{ done: "is-ok", progress: "is-active", locked: "is-neutral", ready: "is-active" }[examState]}">${{ done: "Completed", progress: "In progress", locked: "Locked", ready: "Unlocked" }[examState]}</span></header>
          <dl class="ss2-stats">${stat("Score", exam.score ? `${exam.score.score}/${exam.score.total}` : "–")}${stat("Attempts", `${exam.done || exam.started ? 1 : 0} of 1`)}</dl>
          ${locked ? `<div class="ss2-pending" role="note"><p>Still to do before you can start:</p><ul>${pendingLinks}</ul></div>` : ""}
          <footer>${locked
            ? '<button type="button" class="btn-pill solid" disabled>Locked</button>'
            : `<a class="btn-pill solid" href="#tests/final">${{ done: "View result", progress: "Resume exam", ready: "Start Final Exam" }[examState]}</a>`}</footer>
        </article></div>`;
    }

    // The test itself reads the server every time it is shown (the Final Exam may have unlocked since the last visit).
    async function test(which) {
      reset();
      const mine = seq;
      host.innerHTML = `<a class="ss2-back" href="#tests"><span aria-hidden="true">←</span> All tests</a><div data-test>${skeleton()}</div>`;
      const slot = $("[data-test]", host);
      try {
        const c = await (which === "practice" ? TestsView.mountPractice : TestsView.mountFinal)(slot, { session: ctx.session });
        if (mine !== seq) return c?.();
        cleanup = c ?? null;
      } catch (e) {
        if (mine !== seq) return;
        if (e.status === 404) slot.innerHTML = emptyState("This module isn't available yet", "It will open here when your mentors release it.", icon("lock"));
        else slot.replaceChildren(errorBox(e.message, () => test(which)));
      }
    }

    let showing = null;
    return {
      show(sub) {
        if (sub === showing && sub) return; // already on screen (a hash change inside the same test)
        showing = Object.hasOwn(TEST_KEY, sub) ? sub : "";
        showing ? test(showing) : cards();
      },
      // Progress changed: the cards redraw, a running test is left alone.
      refresh() { if (!showing && host.isConnected) cards(); },
      destroy: reset,
    };
  }

  // ---------- boot ----------
  async function start() {
    // Every request starts now, in parallel; the shell paints as soon as /api/me (no Sheet call) answers.
    const params0 = new URLSearchParams(location.search);
    const no0 = Number(params0.get("s"));
    const valid = params0.get("course") === Founders.COURSE_ID && Number.isInteger(no0) && no0 >= 1;
    const early = valid ? {
      detail: api(sessionsApi(`/${no0}`)), ready: Founders.ready(),
      data: Founders.load().then((m) => m.sessions[no0 - 1]?.data
        ? fetch(Founders.fileUrl({ file: m.sessions[no0 - 1].data }), { credentials: "same-origin" }).then((r) => { if (!r.ok) throw new Error("This session's content is unavailable."); return r.json(); })
        : null),
    } : null;
    if (early) Object.values(early).forEach((p) => p.catch(() => {})); // handled below; avoids "unhandled rejection" noise
    Hub.user = await Auth.me();
    if (!Hub.user) return location.replace("signin.html");
    document.body.classList.add("hub-page", "session-page");
    const shell = mountShell({ nav: [], backLink: { href: allSessionsHref(), label: "All sessions" }, user: Hub.user });
    shell.hideNav();
    shell.panel.innerHTML = skeleton();

    const params = new URLSearchParams(location.search);
    const no = Number(params.get("s"));
    if (params.get("course") !== Founders.COURSE_ID || !Number.isInteger(no) || no < 1) return message(shell, "Session not found", "That link doesn't point to a session.", allSessionsHref(), "All sessions");

    let manifest, detail, data;
    try {
      manifest = await Founders.load();
      const session = manifest.sessions[no - 1];
      [detail, , data] = await Promise.all([early.detail, early.ready, early.data]); // a locked or unknown session is a 404
      if (!session?.data) return message(shell, "Opens in the course page", "This session is shown on the course page.", `course.html?id=${Founders.COURSE_ID}#sessions/${no}`, "Open it");
    } catch (e) {
      if (e.status === 404) return message(shell, "Session not available", "It will open here when your mentors release it.", allSessionsHref(), "All sessions");
      return shell.panel.replaceChildren(errorBox(e.message, () => location.reload()));
    }
    Hub.manifest = manifest;
    mountPage(shell, manifest, no, detail, data);
  }

  function mountPage(shell, manifest, no, detail, data) {
    const session = manifest.sessions[no - 1];
    const s = data.session;
    const state = makeSessionState(detail);
    const summary = () => Founders.summary(manifest).sessions[no - 1];
    const video = () => (state.video ? { watched: state.videoWatched === true } : null);
    const percent = () => Founders.sessionPercent(summary(), video());
    document.title = `Session ${no}: ${s.title} · IICFE Study Hub`;
    shell.setTopbar({ left: `Session ${no} · ${s.title}`, right: manifest.cohortLabel ?? "" });
    cachedApi("/api/workspace", BELL_MAX_AGE_MS).then((ws) => shell.setNotifications(notificationsFrom(ws))).catch(() => shell.setNotifications([]));

    // ----- left: the session content panel, in the sidebar's own slot -----
    shell.setWidget(`<div class="ss2-side">
      <div class="ss2-id"><span class="ss2-no">Session ${no}</span><p class="ss2-name">${esc(s.title)}</p></div>
      <div class="ss2-pct"><span>Session progress</span><b data-pct></b></div>
      <div class="nt-track" role="progressbar" aria-label="Session progress" aria-valuemin="0" aria-valuemax="100"><i data-bar></i></div>
      <section class="sd-sec" data-sec="video"></section>
      <section class="sd-sec" id="rs-panel-notes"></section>
      <section class="sd-sec" id="rs-panel-activities"></section>
      <section class="sd-sec" data-sec="tests"></section></div>`);
    const side = $("[data-widget]");
    side.classList.add("is-session");

    // ----- right: video, title, tabs -----
    shell.panel.innerHTML = `<div class="rs ss2">
      <section class="ss2-player" aria-label="Video lecture">${playerHtml(state.video, { no, title: s.title, theme: s.theme })}<div class="sd-watch-row" data-video></div></section>
      <header class="ss2-head"><p class="ss2-eyebrow"><span class="ss2-no">Session ${no}</span>${s.subtitle ? `<span>${esc(s.subtitle)}</span>` : ""}</p><h1>${esc(s.title)}</h1></header>
      <div class="ss2-tabs" role="tablist" aria-label="Session sections">
        ${TABS.map((t) => `<button type="button" role="tab" id="ss2-tab-${t.id}" aria-controls="ss2-pane-${t.id}" data-tab="${t.id}">${esc(t.label)}<span class="rs-badge"></span></button>`).join("")}</div>
      ${TABS.map((t) => `<div role="tabpanel" class="ss2-pane" id="ss2-pane-${t.id}" aria-labelledby="ss2-tab-${t.id}" hidden></div>`).join("")}</div>`;

    // ----- sidebar toggle: a button in the top bar. Wide screens fold the panel away; narrow screens already have the burger drawer. -----
    const app = $("[data-app]");
    const burger = $(".burger");
    burger.setAttribute("aria-label", "Open session content");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ss2-toggle";
    toggle.setAttribute("aria-controls", "appSide");
    toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/></svg><span>Session content</span>';
    $(".topbar").prepend(toggle);
    const setFolded = (folded) => {
      app.classList.toggle("ss2-folded", folded);
      toggle.setAttribute("aria-expanded", String(!folded));
      toggle.title = folded ? "Show session content" : "Hide session content";
    };
    setFolded(store.get() === "closed");
    toggle.addEventListener("click", () => { const f = !app.classList.contains("ss2-folded"); setFolded(f); store.set(f ? "closed" : "open"); });

    // ----- views -----
    const ctx = (item, extra = {}) => ({ data, item, session, sessionNo: no, manifest, state, changed: () => paint(), panelHost: document.createElement("div"), summary, percent, ...extra });
    const items = Object.fromEntries(summary().items.map((it) => [it.key, it]));
    const pane = (id) => $(`#ss2-pane-${id}`);
    const videoControl = mountVideoControl($("[data-video]"), state);
    const mounted = {
      overview: mountOverview(pane("overview"), ctx(null)),
      notes: NotesView.mount(pane("notes"), ctx(items["study-notes"], { panelHost: $("#rs-panel-notes") })),
      activities: ActivitiesView.mount(pane("activities"), ctx(items.activities, { panelHost: $("#rs-panel-activities") })),
    };
    mounted.tests = mountTests(pane("tests"), ctx(null));

    // ----- sidebar rows and the badges -----
    const tabEls = $$('[role="tab"]');
    let current = null, currentSub = "";
    function paint() {
      const ss = summary();
      const get = (k) => ss.items.find((it) => it.key === k);
      const practice = get("practice"), exam = get("real-test");
      const locked = ss.gate.locked && !exam.done;
      $('[data-sec="video"]').innerHTML = `<p class="rs-ph-t">Video lecture</p><ol class="toc-list">${state.video
        ? row({ open: "overview", label: state.video.title || "Video lecture", inner: state.videoWatched ? CHECK : "▶", done: state.videoWatched === true, current: current === "overview" })
        : row({ open: "overview", label: "Video lecture coming soon", inner: "▶", disabled: true })}</ol>`;
      $('[data-sec="tests"]').innerHTML = `<p class="rs-ph-t">Assessment</p><ol class="toc-list">
        ${row({ open: "tests/practice", label: "Practice Test", sub: "No timer, retake any time", inner: practice.done ? CHECK : "P", done: practice.done, current: current === "tests" && currentSub === "practice" })}
        ${row({ open: "tests/final", label: "Final Exam", sub: exam.done ? "Result saved" : "One try", inner: exam.done ? CHECK : locked ? icon("lock") : "F", done: exam.done, locked, current: current === "tests" && currentSub === "final" })}</ol>
        ${locked ? `<p class="sd-lock" role="note">${esc(ss.gate.hint)}</p>` : ""}`;
      const pct = percent();
      $("[data-pct]", side).textContent = `${pct}%`;
      $("[data-bar]", side).style.width = `${pct}%`;
      $(".nt-track", side).setAttribute("aria-valuenow", pct);
      for (const t of tabEls) {
        const it = items[TABS.find((x) => x.id === t.dataset.tab).key];
        const sum = it && get(it.key);
        $(".rs-badge", t).textContent = sum ? `${sum.have}/${sum.need}` : "";
      }
    }

    function select(tab, sub = "") {
      const same = tab === current && sub === currentSub;
      current = tab; currentSub = sub;
      for (const t of tabEls) {
        const on = t.dataset.tab === tab;
        t.setAttribute("aria-selected", on);
        t.tabIndex = on ? 0 : -1;
        pane(t.dataset.tab).hidden = !on;
      }
      if (!same && tab === "tests") mounted.tests.show(sub);
      paint();
    }
    const go = () => { const { tab, sub } = readHash(); select(tab, sub); };
    const open = (hash) => { const [tab, sub] = hash.split("/"); select(tab, sub ?? ""); if (location.hash !== `#${hash}`) location.hash = `#${hash}`; };

    // A click in the panel opens its tab first (synchronously), so the notes' and the games' own handlers find a visible pane.
    side.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-open]");
      const tab = btn ? btn.dataset.open : e.target.closest("[data-go]") ? "notes" : e.target.closest("[data-pick],[data-pick-up]") ? "activities" : null;
      if (!tab) return;
      if (btn) { open(tab); (tab === "overview" ? $(".ss2-player") : $(".ss2-tabs")).scrollIntoView({ block: "start" }); }
      else if (current !== tab) open(tab);
      shell.closeDrawer();
    }, true);
    $(".ss2-tabs").addEventListener("click", (e) => { const t = e.target.closest('[role="tab"]'); if (t) open(t.dataset.tab); });
    $(".ss2-tabs").addEventListener("keydown", (e) => {
      const t = e.target.closest('[role="tab"]');
      const i = tabEls.indexOf(t);
      const to = { [KEYS.left]: i - 1, [KEYS.right]: i + 1, [KEYS.home]: 0, [KEYS.end]: tabEls.length - 1 }[e.key];
      if (!t || to == null) return;
      e.preventDefault();
      const next = tabEls[(to + tabEls.length) % tabEls.length];
      next.focus();
      open(next.dataset.tab);
    });
    addEventListener("hashchange", go);
    state.watch(paint);
    Founders.watch(() => { Object.values(mounted).forEach((m) => m.refresh?.()); paint(); });
    addEventListener("pagehide", () => { videoControl.destroy(); Object.values(mounted).forEach((m) => m.destroy?.()); });
    go();
  }

  start();
})();
