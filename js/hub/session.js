// Session 1's page (course.html#sessions/1/...): the native Study Notes, Activities, Practice Test and Final Exam, then Plan & Uploads,
// Session Output and Recap. Content comes from the session's data file (manifest session.data, e.g. content/founders-lab/s1/session.json);
// each manifest item with a `view` name is rendered by the matching view below. The server keeps every rule: the Final Exam unlock, the clock,
// the answer keys. The Sessions timeline and every other session live in js/hub/sessions.js.
const Resources = (() => {
  const KEYS = { left: "ArrowLeft", right: "ArrowRight", home: "Home", end: "End" };
  const dataCache = new Map();
  let active = null; // { manifest, sessionId, select(key) }

  // A tab that mounts one of the session's extra panes (plan, output, recap). Its side panel shows the session's steps.
  const extraView = (mountPane) => ({
    mount(host, ctx) {
      const pane = mountPane(host, ctx.state);
      const drawPanel = () => { ctx.panelHost.innerHTML = `<p class="rs-ph-t">Session steps</p><p class="rs-ph-s">What counts towards finishing this session.</p>${stepBarHtml(ctx.state.steps) || '<p class="rs-ph-s">Nothing to finish here yet.</p>'}`; };
      drawPanel();
      const unwatch = ctx.state.watch(drawPanel);
      return { badge: () => "", refresh() {}, destroy() { unwatch(); pane.destroy(); } };
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
  // Built when first needed: tests.js loads after this file.
  const views = () => ({
    notes: NotesView, activities: ActivitiesView, practice: testView((el, o) => TestsView.mountPractice(el, o)), final: testView((el, o) => TestsView.mountFinal(el, o)),
    plan: extraView(mountPlan), output: extraView(mountOutput), recap: extraView(mountRecap),
  });
  const EXTRA_ITEMS = [{ key: "plan", view: "plan", label: "Plan & Uploads", done: true }, { key: "output", view: "output", label: "Session Output", done: true }, { key: "recap", view: "recap", label: "Recap", done: true }];

  const loadData = (session) => {
    if (!dataCache.has(session.id)) {
      dataCache.set(session.id, fetch(Founders.fileUrl({ file: session.data }), { credentials: "same-origin" })
        .then((r) => { if (!r.ok) throw new Error("This session's content is unavailable."); return r.json(); })
        .catch((e) => { dataCache.delete(session.id); throw e; }));
    }
    return dataCache.get(session.id);
  };

  // "#sessions/1/study-notes": the session by number, then the tab. A bare "#sessions/1" opens the first unfinished step.
  function resolve(manifest, parts) {
    const session = manifest.sessions[Number(parts[0]) - 1];
    const sum = Founders.summary(manifest).sessions.find((s) => s.id === session.id);
    const V = views();
    const tabs = [...sum.items.filter((it) => it.view && V[it.view]), ...EXTRA_ITEMS];
    const item = tabs.find((it) => it.key === parts[1]) ?? tabs.find((it) => !it.done) ?? tabs[0];
    return { session, tabs, item };
  }

  async function mount(el, hub, parts, state) {
    const { manifest } = hub;
    const { session, tabs, item } = resolve(manifest, parts);
    const data = await loadData(session);
    const s = data.session;
    const V = views();

    // Three surfaces: the app's icon rail, this page's tinted side panel (one per tab), and the open reading area.
    // The subtitle is the last sentence of the notes intro; mentors' roles live in the tooltip and aria-label.
    const lastSentence = (t) => (t ?? "").split(/(?<=\.)\s+/).at(-1);
    const subs = { notes: lastSentence(s.notesIntro), activities: data.activities?.subtitle };
    el.innerHTML = `<div class="rs"><div class="rs-layout">
      <aside class="rs-side" aria-label="Page navigation">
        ${tabs.map((it) => `<div class="rs-panel" id="rs-panel-${esc(it.key)}" hidden></div>`).join("")}
      </aside>
      <div class="rs-read">
        <header class="rs-head">
          <a class="tk-back" href="#sessions"><span aria-hidden="true">←</span> All sessions</a>
          <div class="rs-row"><h1>${esc(s.title)}</h1>
            <ul class="rs-mentors" aria-label="Mentors">${s.mentors.map((m) => `
              <li><button type="button" class="rs-chip" title="${esc(m.role)}" aria-label="${esc(`${m.name}, ${m.role}`)}"><span class="rs-av" aria-hidden="true">${esc(Auth.initials(m.name))}</span>${esc(m.name)}</button></li>`).join("")}</ul></div>
          <p class="rs-sub"></p>
        </header>
        <div class="rs-tabs" role="tablist" aria-label="Session sections">
          ${tabs.map((it) => `<button type="button" role="tab" id="rs-tab-${esc(it.key)}" aria-controls="rs-pane-${esc(it.key)}" data-key="${esc(it.key)}" data-view="${esc(it.view)}">${esc(it.label)}<span class="rs-badge"></span></button>`).join("")}
          <span class="rs-ind" aria-hidden="true"></span></div>
        ${tabs.map((it) => `<div role="tabpanel" class="rs-pane" id="rs-pane-${esc(it.key)}" aria-labelledby="rs-tab-${esc(it.key)}" hidden></div>`).join("")}
      </div></div></div>`;

    const tabEls = $$('[role="tab"]', el);
    const ind = $(".rs-ind", el);
    const mounted = {};
    const updateBadges = () => tabEls.forEach((t) => { $(".rs-badge", t).textContent = mounted[t.dataset.key]?.badge() ?? ""; });
    for (const it of tabs) {
      mounted[it.key] = V[it.view].mount($(`#rs-pane-${it.key}`, el), { data, item: it, session, manifest, state, changed: updateBadges, panelHost: $(`#rs-panel-${it.key}`, el) });
    }

    let current = null;
    const place = () => { // gold underline slides under the selected tab
      const t = tabEls.find((x) => x.dataset.key === current);
      if (!t) return;
      ind.style.setProperty("--x", `${t.offsetLeft}px`);
      ind.style.setProperty("--w", `${t.offsetWidth}px`);
    };
    function select(key) {
      const changedTab = current !== key;
      current = key;
      $(".rs-sub", el).textContent = subs[tabEls.find((x) => x.dataset.key === key)?.dataset.view] ?? "";
      for (const t of tabEls) {
        const on = t.dataset.key === key;
        t.setAttribute("aria-selected", on);
        t.tabIndex = on ? 0 : -1;
        $(`#rs-pane-${t.dataset.key}`, el).hidden = !on;
        $(`#rs-panel-${t.dataset.key}`, el).hidden = !on;
      }
      if (changedTab) mounted[key].show?.();
      place();
    }
    el.addEventListener("click", (e) => {
      const t = e.target.closest('[role="tab"]');
      if (t) location.hash = `#sessions/${parts[0]}/${t.dataset.key}`; // the router calls go() below
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
      location.hash = `#sessions/${parts[0]}/${next.dataset.key}`;
    });
    addEventListener("resize", place);
    document.fonts?.ready.then(place);

    select(item.key);
    updateBadges();
    const unwatch = Founders.watch(() => { Object.values(mounted).forEach((v) => v.refresh()); updateBadges(); });
    active = { manifest, sessionId: session.id, no: parts[0], select };
    return () => {
      unwatch();
      removeEventListener("resize", place);
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
