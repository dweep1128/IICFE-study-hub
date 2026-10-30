// Resources tab: session header plus the native "Study Notes" and "Activities" views (course.html#resources/...).
// Content comes from the session's data file (manifest session.data, e.g. content/founders-lab/s1/session.json);
// each manifest item with a `view` name is rendered by the matching view below. Mock Tests and Final Exam are native too (js/hub/tests.js) and reuse loadData.
const Resources = (() => {
  const VIEWS = { notes: NotesView, activities: ActivitiesView };
  const KEYS = { left: "ArrowLeft", right: "ArrowRight", home: "Home", end: "End" };
  const dataCache = new Map();
  const comingSoon = Panels.resources; // used when a course has no content manifest
  let active = null; // { manifest, sessionId, select(key) }

  const loadData = (session) => {
    if (!dataCache.has(session.id)) {
      dataCache.set(session.id, fetch(Founders.fileUrl({ file: session.data }), { credentials: "same-origin" })
        .then((r) => { if (!r.ok) throw new Error("This session's content is unavailable."); return r.json(); })
        .catch((e) => { dataCache.delete(session.id); throw e; }));
    }
    return dataCache.get(session.id);
  };

  // The session a hash asks for by id ("#resources/s2/..." or "#resources/s2"), or null when it names none. An id the manifest doesn't have is unknown.
  const askedSession = (parts) => (parts.length > 1 ? parts[0] : /^s\d+$/.test(parts[0] ?? "") ? parts[0] : null);
  const isUnknown = (manifest, parts) => { const id = askedSession(parts); return id != null && !manifest.sessions.some((s) => s.id === id); };

  // "#resources/study-notes" (first session) or "#resources/s2/study-notes"; a bare "#resources" opens the first unfinished step.
  function resolve(manifest, parts) {
    const [a, b] = parts;
    const key = b ?? a;
    const sessions = manifest.sessions;
    const session = (b ? sessions.find((s) => s.id === a) : null) ?? sessions[0];
    const sum = Founders.summary(manifest).sessions.find((s) => s.id === session.id);
    const native = sum.items.filter((it) => it.view && VIEWS[it.view]);
    const item = native.find((it) => it.key === key) ?? native.find((it) => !it.done) ?? native[0];
    return { session, native, item };
  }

  async function mount(el, hub, parts) {
    const { manifest } = hub;
    if (!manifest) return comingSoon(el, hub);
    if (isUnknown(manifest, parts)) return notAvailableYet(el);
    const { session, native, item } = resolve(manifest, parts);
    if (!session.data || !native.length) return comingSoon(el, hub);
    const data = await loadData(session);
    const s = data.session;

    // Three surfaces: the app's icon rail, this page's tinted side panel (one per tab), and the open reading area.
    // The subtitle is the last sentence of the notes intro; mentors' roles live in the tooltip and aria-label.
    const lastSentence = (t) => (t ?? "").split(/(?<=\.)\s+/).at(-1);
    const subs = { notes: lastSentence(s.notesIntro), activities: data.activities?.subtitle };
    el.innerHTML = `<div class="rs"><div class="rs-layout">
      <aside class="rs-side" aria-label="Page navigation">
        ${native.map((it) => `<div class="rs-panel" id="rs-panel-${esc(it.key)}" hidden></div>`).join("")}
      </aside>
      <div class="rs-read">
        <header class="rs-head">
          <div class="rs-row"><h1>${esc(s.title)}</h1>
            <ul class="rs-mentors" aria-label="Mentors">${s.mentors.map((m) => `
              <li><button type="button" class="rs-chip" title="${esc(m.role)}" aria-label="${esc(`${m.name}, ${m.role}`)}"><span class="rs-av" aria-hidden="true">${esc(Auth.initials(m.name))}</span>${esc(m.name)}</button></li>`).join("")}</ul></div>
          <p class="rs-sub"></p>
        </header>
        <div class="rs-tabs" role="tablist" aria-label="Resources">
          ${native.map((it) => `<button type="button" role="tab" id="rs-tab-${esc(it.key)}" aria-controls="rs-pane-${esc(it.key)}" data-key="${esc(it.key)}" data-view="${esc(it.view)}">${esc(it.label)}<span class="rs-badge"></span></button>`).join("")}
          <span class="rs-ind" aria-hidden="true"></span></div>
        ${native.map((it) => `<div role="tabpanel" class="rs-pane" id="rs-pane-${esc(it.key)}" aria-labelledby="rs-tab-${esc(it.key)}" hidden></div>`).join("")}
      </div></div></div>`;

    const tabs = $$('[role="tab"]', el);
    const ind = $(".rs-ind", el);
    const views = {};
    const updateBadges = () => tabs.forEach((t) => { $(".rs-badge", t).textContent = views[t.dataset.key]?.badge() ?? ""; });
    for (const it of native) {
      views[it.key] = VIEWS[it.view].mount($(`#rs-pane-${it.key}`, el), { data, item: it, session, manifest, changed: updateBadges, panelHost: $(`#rs-panel-${it.key}`, el) });
    }

    let current = null;
    const place = () => { // gold underline slides under the selected tab
      const t = tabs.find((x) => x.dataset.key === current);
      if (!t) return;
      ind.style.setProperty("--x", `${t.offsetLeft}px`);
      ind.style.setProperty("--w", `${t.offsetWidth}px`);
    };
    function select(key) {
      current = key;
      $(".rs-sub", el).textContent = subs[tabs.find((x) => x.dataset.key === key)?.dataset.view] ?? "";
      for (const t of tabs) {
        const on = t.dataset.key === key;
        t.setAttribute("aria-selected", on);
        t.tabIndex = on ? 0 : -1;
        $(`#rs-pane-${t.dataset.key}`, el).hidden = !on;
        $(`#rs-panel-${t.dataset.key}`, el).hidden = !on;
      }
      place();
    }
    el.addEventListener("click", (e) => {
      const t = e.target.closest('[role="tab"]');
      if (t) location.hash = Founders.hash(manifest, session.id, t.dataset.key); // the router calls go() below
    });
    el.addEventListener("keydown", (e) => {
      const t = e.target.closest('[role="tab"]');
      if (!t) return;
      const i = tabs.indexOf(t);
      const to = { [KEYS.left]: i - 1, [KEYS.right]: i + 1, [KEYS.home]: 0, [KEYS.end]: tabs.length - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      const next = tabs[(to + tabs.length) % tabs.length];
      next.focus();
      location.hash = Founders.hash(manifest, session.id, next.dataset.key);
    });
    addEventListener("resize", place);
    document.fonts?.ready.then(place);

    select(item.key);
    updateBadges();
    const unwatch = Founders.watch(() => { Object.values(views).forEach((v) => v.refresh()); updateBadges(); });
    active = { manifest, sessionId: session.id, select };
    return () => {
      unwatch();
      removeEventListener("resize", place);
      Object.values(views).forEach((v) => v.destroy());
      active = null;
    };
  }

  // Called by the router on a hash change inside Resources: switch tab in place so games and scroll position survive.
  function go(parts) {
    if (!active || isUnknown(active.manifest, parts)) return false; // an unknown module remounts, which shows "not available yet"
    const { session, item } = resolve(active.manifest, parts);
    if (session.id !== active.sessionId) return false;
    active.select(item.key);
    return true;
  }

  return { mount, go, loadData };
})();
Panels.resources = (el, hub) => Resources.mount(el, hub, hashParts().slice(1));
