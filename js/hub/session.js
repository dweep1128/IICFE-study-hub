// Session 1's page (course.html#sessions/1/...), laid out like a course player: the video lecture on top, the tab bar under it, and a
// "Session content" list on the right (the video, the study-note sections, the games, the Practice Test and the Final Exam, with ticks).
// Content comes from the session's data file (manifest session.data, e.g. content/founders-lab/s1/session.json); each manifest item with a
// `view` name is rendered by the matching view below. The server keeps every rule: the Final Exam unlock, the clock, the answer keys.
// The Sessions timeline and every other session live in js/hub/sessions.js.
const Resources = (() => {
  const KEYS = { left: "ArrowLeft", right: "ArrowRight", home: "Home", end: "End" };
  const WIDE_PX = 1000; // the page's width from which the content list sits beside the lesson (matches the @container rs rules in portal.css)
  const PCT = 100;
  const dataCache = new Map();
  let active = null; // { manifest, no, select(key) }

  // A tab that mounts one of the session's extra panes (plan, output, recap).
  const extraView = (mountPane) => ({
    mount(host, ctx) {
      const pane = mountPane(host, ctx.state);
      return { badge: () => "", refresh() {}, destroy: pane.destroy };
    },
  });
  // The tests ask the server where they stand, so each visit to the tab re-reads it (the Final Exam may have unlocked since the last visit).
  const testView = (mountTest) => ({
    mount(host, ctx) {
      let cleanup = null, seq = 0;
      const show = async () => {
        const mine = ++seq;
        cleanup?.(); cleanup = null;
        host.innerHTML = skeleton();
        try {
          const c = await mountTest(host, { session: ctx.session });
          if (mine !== seq) return c?.();
          cleanup = c ?? null;
        } catch (e) { if (mine === seq) host.replaceChildren(e.status === 404 ? emptyState("This module isn't available yet", "It will open here when your mentors release it.", icon("lock")) : errorBox(e.message, show)); }
      };
      return { badge: () => "", refresh() {}, show, destroy() { seq++; cleanup?.(); } };
    },
  });

  // Overview: what the session is about, what you will be able to do (the Mission brief's list), when and where, and how far you are.
  const overviewView = {
    mount(host, ctx) {
      const s = ctx.data.session;
      const learn = ctx.data.notes?.[0]?.blocks.find((b) => b.type === "list")?.items ?? [];
      const facts = [["Date", s.date], ["Time", s.time], ["Venue", s.venue]].filter(([, v]) => v);
      host.innerHTML = `<div class="sd-ov">
        <section><h2>About this session</h2><p class="sd-lead">${richHtml(ctx.data.session.notesIntro ?? "")}</p>
          ${facts.length ? `<dl class="sd-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}</section>
        ${learn.length ? `<section><h2>What you’ll learn</h2><ul class="sd-learn">${learn.map((t) => `<li><span aria-hidden="true">${CHECK}</span><span>${richHtml(t)}</span></li>`).join("")}</ul></section>` : ""}
        <section><h2>Your progress</h2><div data-prog></div></section></div>`;
      const draw = () => { $("[data-prog]", host).innerHTML = stepBarHtml(ctx.state.steps) || '<p class="rs-ph-s">Nothing to finish here yet.</p>'; };
      draw();
      const unwatch = ctx.state.watch(draw);
      return { badge: () => "", refresh() {}, destroy: unwatch };
    },
  };

  // Built when first needed: tests.js loads after this file.
  const views = () => ({
    overview: overviewView, notes: NotesView, activities: ActivitiesView,
    practice: testView((el, o) => TestsView.mountPractice(el, o)), final: testView((el, o) => TestsView.mountFinal(el, o)),
    plan: extraView(mountPlan), output: extraView(mountOutput), recap: extraView(mountRecap),
  });
  const OVERVIEW_ITEM = { key: "overview", view: "overview", label: "Overview", done: true };
  const EXTRA_ITEMS = [{ key: "plan", view: "plan", label: "Plan & Uploads", done: true }, { key: "output", view: "output", label: "Session Output", done: true }, { key: "recap", view: "recap", label: "Recap", done: true }];

  const loadData = (session) => {
    if (!dataCache.has(session.id)) {
      dataCache.set(session.id, fetch(Founders.fileUrl({ file: session.data }), { credentials: "same-origin" })
        .then((r) => { if (!r.ok) throw new Error("This session's content is unavailable."); return r.json(); })
        .catch((e) => { dataCache.delete(session.id); throw e; }));
    }
    return dataCache.get(session.id);
  };

  // "#sessions/1/study-notes": the session by number, then the tab. A bare "#sessions/1" opens the Overview.
  function resolve(manifest, parts) {
    const session = manifest.sessions[Number(parts[0]) - 1];
    const sum = Founders.summary(manifest).sessions.find((s) => s.id === session.id);
    const V = views();
    const tabs = [OVERVIEW_ITEM, ...sum.items.filter((it) => it.view && V[it.view]), ...EXTRA_ITEMS];
    const item = tabs.find((it) => it.key === parts[1]) ?? tabs[0];
    return { session, tabs, item };
  }

  // ---------- the right-hand "Session content" list ----------
  const NOTES_KEY = "study-notes", ACTS_KEY = "activities", PRACTICE_KEY = "practice", EXAM_KEY = "real-test";
  const ring = (inner, cls = "") => `<span class="toc-n ${cls}" aria-hidden="true">${inner}</span>`;
  const rowBtn = ({ open, label, sub = "", inner, done = false, current = false, locked = false, disabled = false }) =>
    `<li><button type="button" class="toc-item${done ? " is-done" : ""}${locked ? " is-locked" : ""}" data-open="${esc(open)}"${current ? ' aria-current="true"' : ""}${disabled ? " disabled" : ""}>
      ${ring(inner)}<span class="toc-t">${esc(label)}${sub ? `<small class="sd-sub">${esc(sub)}</small>` : ""}</span>
      ${done ? '<span class="sr-only">(done)</span>' : ""}${locked ? '<span class="sr-only">(locked)</span>' : ""}</button></li>`;

  async function mount(el, hub, parts, state) {
    const { manifest } = hub;
    const { session, tabs, item } = resolve(manifest, parts);
    const data = await loadData(session);
    const s = data.session;
    const V = views();
    const no = parts[0];
    const sumOf = () => Founders.summary(manifest).sessions.find((x) => x.id === session.id);

    el.innerHTML = `<div class="rs sd">
      <a class="tk-back" href="#sessions"><span aria-hidden="true">←</span> All sessions</a>
      <div class="sd-grid">
        <section class="sd-player" aria-label="Video lecture">
          ${playerHtml(state.video, s.title)}
          <header class="rs-head sd-info">
            <div class="rs-row"><h1>${esc(s.title)}</h1>
              <ul class="rs-mentors" aria-label="Mentors">${s.mentors.map((m) => `
                <li><button type="button" class="rs-chip" title="${esc(m.role)}" aria-label="${esc(`${m.name}, ${m.role}`)}"><span class="rs-av" aria-hidden="true">${esc(Auth.initials(m.name))}</span>${esc(m.name)}</button></li>`).join("")}</ul></div>
            <div class="sd-watch-row" data-video></div>
          </header>
        </section>
        <div class="rs-tabs sd-tabs" role="tablist" aria-label="Session sections">
          ${tabs.map((it) => `<button type="button" role="tab" id="rs-tab-${esc(it.key)}" aria-controls="rs-pane-${esc(it.key)}" data-key="${esc(it.key)}" data-view="${esc(it.view)}">${esc(it.label)}<span class="rs-badge"></span></button>`).join("")}
          <span class="rs-ind" aria-hidden="true"></span></div>
        <aside class="sd-side" aria-label="Session content">
          <details class="sd-cur" open>
            <summary><span>Session content</span><b data-pct></b></summary>
            <div class="nt-track" role="progressbar" aria-label="Session progress" aria-valuemin="0" aria-valuemax="100"><i data-bar></i></div>
            <div class="sd-secs">
              <section class="sd-sec" data-sec="video"></section>
              <section class="sd-sec" id="rs-panel-${NOTES_KEY}"></section>
              <section class="sd-sec" id="rs-panel-${ACTS_KEY}"></section>
              <section class="sd-sec" data-sec="tests"></section>
            </div>
          </details>
        </aside>
        <div class="sd-content">
          <p class="rs-sub" data-sub></p>
          ${tabs.map((it) => `<div role="tabpanel" class="rs-pane" id="rs-pane-${esc(it.key)}" aria-labelledby="rs-tab-${esc(it.key)}" hidden></div>`).join("")}
        </div>
      </div></div>`;

    const root = $(".sd", el);
    const tabEls = $$('[role="tab"]', el);
    const ind = $(".rs-ind", el);
    const details = $(".sd-cur", el);
    const subs = { notes: ((t) => (t ?? "").split(/(?<=\.)\s+/).at(-1))(s.notesIntro), activities: data.activities?.subtitle };
    const video = mountVideoControl($("[data-video]", el), state);
    const mounted = {};
    const updateBadges = () => tabEls.forEach((t) => { $(".rs-badge", t).textContent = mounted[t.dataset.key]?.badge() ?? ""; });
    for (const it of tabs) {
      // Only the notes and the games draw a list of their own; it lives in the right-hand panel, which is always visible.
      const panelHost = $(`#rs-panel-${it.key}`, el) ?? document.createElement("div");
      mounted[it.key] = V[it.view].mount($(`#rs-pane-${it.key}`, el), { data, item: it, session, manifest, state, changed: () => { updateBadges(); drawRows(); }, panelHost });
    }

    // Video, Practice Test and Final Exam rows, and the progress bar on top. The notes and the games draw their own sections.
    let current = null;
    function drawRows() {
      const sum = sumOf();
      const get = (k) => sum.items.find((it) => it.key === k);
      const notes = get(NOTES_KEY), acts = get(ACTS_KEY), practice = get(PRACTICE_KEY), exam = get(EXAM_KEY);
      const lockedExam = sum.gate.locked && !exam.done;
      $('[data-sec="video"]', el).innerHTML = `<p class="rs-ph-t">Video lecture</p><ol class="toc-list">${state.video
        ? rowBtn({ open: "overview", label: state.video.title || "Video lecture", inner: state.videoWatched ? CHECK : "▶", done: state.videoWatched === true, current: current === "overview" })
        : rowBtn({ open: "overview", label: "Video lecture coming soon", inner: "▶", disabled: true })}</ol>`;
      $('[data-sec="tests"]', el).innerHTML = `<p class="rs-ph-t">Tests</p><ol class="toc-list">
        ${rowBtn({ open: PRACTICE_KEY, label: "Practice Test", sub: "No timer, retake any time", inner: practice.done ? CHECK : "P", done: practice.done, current: current === PRACTICE_KEY })}
        ${rowBtn({ open: EXAM_KEY, label: "Final Exam", sub: exam.done ? "Score slip ready" : "One try", inner: exam.done ? CHECK : lockedExam ? icon("lock") : "F", done: exam.done, locked: lockedExam, current: current === EXAM_KEY })}</ol>
        ${lockedExam ? `<p class="sd-lock" role="note">${esc(sum.gate.hint)}</p>` : ""}`;
      const total = (state.video ? 1 : 0) + notes.need + acts.need + 2;
      const done = (state.video && state.videoWatched ? 1 : 0) + notes.have + acts.have + (practice.done ? 1 : 0) + (exam.done ? 1 : 0);
      const pct = total ? Math.round((done / total) * PCT) : 0;
      $("[data-pct]", el).textContent = `${pct}%`;
      $("[data-bar]", el).style.width = `${pct}%`;
      $(".nt-track", el).setAttribute("aria-valuenow", pct);
    }

    const place = () => { // gold underline slides under the selected tab
      const t = tabEls.find((x) => x.dataset.key === current);
      if (!t) return;
      ind.style.setProperty("--x", `${t.offsetLeft}px`);
      ind.style.setProperty("--w", `${t.offsetWidth}px`);
    };
    function select(key) {
      const changedTab = current !== key;
      current = key;
      $("[data-sub]", el).textContent = subs[tabEls.find((x) => x.dataset.key === key)?.dataset.view] ?? "";
      for (const t of tabEls) {
        const on = t.dataset.key === key;
        t.setAttribute("aria-selected", on);
        t.tabIndex = on ? 0 : -1;
        $(`#rs-pane-${t.dataset.key}`, el).hidden = !on;
      }
      if (changedTab) mounted[key].show?.();
      drawRows();
      place();
    }
    const openTab = (key) => { select(key); location.hash = `#sessions/${no}/${key}`; }; // select now; the router's go() then finds it already open

    // The content list: a click opens the tab it belongs to first (synchronously), so the notes' and games' own handlers find a visible pane.
    $(".sd-side", el).addEventListener("click", (e) => {
      const open = e.target.closest("[data-open]");
      const key = open?.dataset.open ?? (e.target.closest("[data-go]") ? NOTES_KEY : e.target.closest("[data-pick]") ? ACTS_KEY : null);
      if (!key) return;
      if (key !== current) openTab(key);
      if (open) (key === "overview" ? $(".sd-player", el) : $(".sd-tabs", el)).scrollIntoView({ block: "start" });
      if (root.clientWidth < WIDE_PX) details.open = false;
    }, true);

    el.addEventListener("click", (e) => {
      const t = e.target.closest('[role="tab"]');
      if (t) location.hash = `#sessions/${no}/${t.dataset.key}`; // the router calls go() below
    });
    el.addEventListener("keydown", (e) => {
      const t = e.target.closest('[role="tab"]');
      if (!t) return;
      const i = tabEls.indexOf(t);
      const to = { [KEYS.left]: i - 1, [KEYS.right]: i + 1, [KEYS.home]: 0, [KEYS.end]: tabEls.length - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      const next = tabEls[(to + tabEls.length) % tabEls.length];
      next.focus();
      location.hash = `#sessions/${no}/${next.dataset.key}`;
    });

    // Beside the lesson the list is always open; under it, it is a drawer that starts closed.
    let wasWide = null;
    const fit = () => { const wide = root.clientWidth >= WIDE_PX; if (wide !== wasWide) { wasWide = wide; details.open = wide; } place(); };
    const watchSize = new ResizeObserver(fit); // also fires once the page is attached, when the width first becomes known
    watchSize.observe(root);
    document.fonts?.ready.then(place);

    select(item.key);
    updateBadges();
    const unwatchState = state.watch(drawRows);
    const unwatch = Founders.watch(() => { Object.values(mounted).forEach((v) => v.refresh()); updateBadges(); drawRows(); });
    active = { manifest, no, select };
    return () => {
      unwatch();
      unwatchState();
      video.destroy();
      watchSize.disconnect();
      Object.values(mounted).forEach((v) => v.destroy());
      active = null;
    };
  }

  // Called by the router on a hash change inside Session 1: switch tab in place so games and scroll position survive.
  function go(parts) {
    if (!active || String(parts[0]) !== String(active.no)) return false;
    active.select(resolve(active.manifest, parts).item.key);
    return true;
  }

  return { mount, go, loadData };
})();
