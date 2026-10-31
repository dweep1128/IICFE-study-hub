// My Journey (the old portal's page): the 7-stage rail and checklist ("My Startup" tab) and the Competitions tab.
// The server owns every rule (which stage is current, what is locked, what counts as done); this file draws what it returns and sends
// ticks, written answers and links back. Study Hub's tokens only (css/portal.css).
const JOURNEY_TABS = [{ id: "startup", label: "My Startup" }, { id: "competitions", label: "Competitions" }];
const COMPETITION_FILTERS = ["all", "open", "applied", "result", "closed"];
const COMP_PILL = { open: "is-ok", applied: "is-active", result: "is-done", closed: "is-neutral" };
const STAR = (on) => `<svg viewBox="0 0 24 24" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 14.9 9.4 21.5 10.4 16.7 15 17.9 21.5 12 18.3 6.1 21.5 7.3 15 2.5 10.4 9.1 9.4Z"/></svg>`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function viewHeader(tab) {
  return `<div class="pt-view-head"><div><p class="pt-eyebrow is-gold">My journey</p><h2 class="pt-h2">Your startup journey, mapped.</h2></div>
    <nav class="pt-tabs" aria-label="My Journey sections">${JOURNEY_TABS.map((t) => `<a href="#journey/${t.id}"${tab === t.id ? ' aria-current="page"' : ""}>${esc(t.label)}</a>`).join("")}</nav></div>`;
}

// ---------- My Startup ----------
function railHtml(stages, selectedId) {
  const doneCount = stages.filter((s) => s.status === "done").length;
  const progress = (doneCount + 0.5) / stages.length;
  return `<div class="jr-rail"><div class="jr-hline"></div><div class="jr-hfill" style="transform:scaleX(${progress})"></div><div class="jr-vline"></div>
    <ol>${stages.map((s) => `<li${s.status === "current" ? ' aria-current="step"' : ""}>
      <button type="button" class="jr-stage is-${s.status}${s.id === selectedId ? " is-selected" : ""}" data-stage="${esc(s.id)}" aria-pressed="${s.id === selectedId}">
        <span class="jr-node">${s.status === "done" ? icon("pCheck") : esc(s.n)}</span>
        <span class="jr-stage-t"><b>${esc(s.label)}</b><small>${s.status === "done" ? "Complete" : s.status === "current" ? `${s.completion.doneCount}/${s.completion.totalCount} required` : "Locked"}</small></span>
      </button></li>`).join("")}</ol></div>`;
}

const LOCKED_NOTE = "Complete every compulsory item in the stage before this one to unlock it. You can preview what's ahead below.";

function rowHtml(d) {
  const box = d.kind === "check"
    ? `<button type="button" class="jr-box" role="checkbox" aria-checked="false" data-act="tick">${icon("pCheck")}</button>`
    : `<span class="jr-box" role="img" aria-label="Not done yet">${icon("pCheck")}</span>`; // text items are done by saving an answer, upload items by a submitted link
  return `<li class="jr-row" data-item="${esc(d.id)}"><div class="jr-row-in">${box}
    <div class="jr-row-body"><div class="jr-row-title"><p>${esc(d.label)}</p><span class="pt-tag ${d.required ? "is-active" : "is-neutral"}">${d.required ? "Compulsory" : "Optional"}</span></div>
      <p class="jr-hint">${esc(d.hint)}</p>${d.kind === "text" ? '<div class="jr-text"></div>' : ""}${d.kind === "upload" ? '<div class="jr-proof"><div class="jr-status"></div><div class="jr-up"></div></div>' : ""}</div></div></li>`;
}

function startupTab(host) {
  let j = Founders.journeyNow();
  let selectedId = j.currentId;
  const rows = new Map(); // itemId -> { update(item, locked) }
  host.innerHTML = '<div data-rail></div><div class="jr-section" data-section></div>';
  const railEl = $("[data-rail]", host);
  const section = $("[data-section]", host);
  const stageOf = () => j.stages.find((s) => s.id === selectedId) ?? j.stages.find((s) => s.id === j.currentId);

  const setError = (text) => { const e = $("[data-error]", section); if (e) e.textContent = text; };
  const send = (body) => api(`/api/courses/${Founders.COURSE_ID}/lab/journey/check`, { method: "POST", body });
  const accept = (journey) => Founders.setJourney(journey); // the watcher below redraws what changed

  function mountRow(li, item) {
    const box = $(".jr-box", li);
    const state = { item, locked: false };
    const paintBox = () => {
      const done = state.item.checked;
      box.classList.toggle("is-done", done);
      if (box.getAttribute("role") === "checkbox") {
        box.setAttribute("aria-checked", done);
        box.setAttribute("aria-label", done ? `Mark ${item.label} as not done` : `Mark ${item.label} as done`);
        box.disabled = state.locked;
      } else box.setAttribute("aria-label", done ? "Done" : "Not done yet");
    };
    const parts = [];

    if (item.kind === "check") {
      box.addEventListener("click", async () => {
        if (state.locked) return;
        const next = !state.item.checked;
        state.item = { ...state.item, checked: next }; paintBox(); setError("");
        try { accept((await send({ itemId: item.id, checked: next })).journey); }
        catch (e) { state.item = { ...state.item, checked: !next }; paintBox(); setError(e.message || "Could not save. Try again."); }
      });
    }

    if (item.kind === "text") {
      const host = $(".jr-text", li);
      const max = item.maxLength ?? 0;
      let draft = item.answer, editing = !item.answer, busy = false, err = "";
      const drawText = () => {
        const saved = state.item.answer;
        if (!editing) {
          host.innerHTML = `<p class="jr-ans">${esc(saved)}</p>${state.locked ? "" : '<button type="button" class="pt-ghost" data-edit>Edit</button>'}`;
          $("[data-edit]", host)?.addEventListener("click", () => { draft = saved; editing = true; err = ""; drawText(); $("textarea", host).focus(); });
          return;
        }
        const id = `answer-${item.id}`;
        host.innerHTML = `<label class="sr-only" for="${id}">Your answer: ${esc(item.label)}</label>
          <textarea class="pt-field" id="${id}" rows="3" maxlength="${max}"${state.locked || busy ? " disabled" : ""}>${esc(draft)}</textarea>
          <div class="jr-text-foot"><span class="jr-count" aria-live="polite">${draft.length}/${max}</span><div class="jr-btns">
            ${saved ? `<button type="button" class="pt-ghost" data-cancel${busy ? " disabled" : ""}>Cancel</button>` : ""}
            <button type="button" class="btn-pill solid" data-save${state.locked || busy || draft.trim() === saved ? " disabled" : ""}>${busy ? "Saving…" : "Save"}</button></div></div>
          ${err ? `<p class="jr-err" role="alert">${esc(err)}</p>` : ""}`;
        const ta = $("textarea", host);
        ta.addEventListener("input", () => { draft = ta.value; $(".jr-count", host).textContent = `${draft.length}/${max}`; $("[data-save]", host).disabled = draft.trim() === saved; });
        $("[data-cancel]", host)?.addEventListener("click", () => { draft = saved; editing = false; err = ""; drawText(); });
        $("[data-save]", host).addEventListener("click", async () => {
          busy = true; err = ""; drawText();
          try {
            const res = await send({ itemId: item.id, answer: draft.trim() });
            draft = draft.trim(); busy = false; editing = !draft;
            state.item = res.journey.stages.flatMap((s) => s.deliverables).find((x) => x.id === item.id);
            drawText(); accept(res.journey);
          } catch (e) { busy = false; err = e.message || "Could not save. Try again."; drawText(); }
        });
      };
      // A half-written answer must survive other rows changing: only redraw when nobody is typing here.
      parts.push({ redraw: drawText, refresh: () => { if (!editing) drawText(); } });
      drawText();
    }

    if (item.kind === "upload") {
      const statusEl = $(".jr-status", li);
      const upEl = $(".jr-up", li);
      let up = null, shownKey = "";
      const drawProof = () => {
        const proof = state.item.proof;
        statusEl.innerHTML = submissionStatusHtml(proof);
        const showUp = !state.locked && proof?.status !== "approved";
        const key = `${showUp}|${proof?.status ?? ""}|${proof?.version ?? 0}`;
        if (key === shownKey) return; // keep a half-typed link while nothing about the submission changed
        shownKey = key;
        up?.destroy(); upEl.innerHTML = "";
        if (showUp) up = mountUploader(upEl, { uploadType: "checkpoint", itemId: item.id, label: item.label,
          cta: proof?.status === "changes_requested" ? "Re-submit" : proof ? "Replace link" : "Submit link", ghost: !!proof && proof.status !== "changes_requested", onSubmitted: (res) => accept(res.journey) });
      };
      parts.push({ redraw: drawProof, refresh: drawProof });
      drawProof();
    }

    paintBox();
    return {
      update(next, locked) {
        state.item = next; const was = state.locked; state.locked = locked; paintBox();
        parts.forEach((p) => (was !== locked ? p.redraw() : p.refresh()));
      },
    };
  }

  function drawSection() {
    const stage = stageOf();
    const locked = stage.status === "locked";
    rows.clear();
    section.innerHTML = `<span class="pt-eyebrow">${esc(stage.label)}</span>
      <h3 class="jr-h3" data-count></h3>${locked ? `<p class="jr-locked">${LOCKED_NOTE}</p>` : ""}
      <p class="jr-error" role="alert" data-error></p><ul class="jr-list">${stage.deliverables.map(rowHtml).join("")}</ul>`;
    for (const d of stage.deliverables) rows.set(d.id, mountRow($(`[data-item="${CSS.escape(d.id)}"]`, section), d));
    patch();
  }

  // Brings what is on screen up to date with the latest journey without rebuilding rows (a half-written answer must survive).
  function patch() {
    const hadFocus = railEl.contains(document.activeElement);
    railEl.innerHTML = railHtml(j.stages, stageOf().id);
    if (hadFocus) $(`[data-stage="${CSS.escape(stageOf().id)}"]`, railEl)?.focus();
    const stage = stageOf();
    const locked = stage.status === "locked";
    $("[data-count]", section).textContent = `${stage.completion.doneCount} of ${stage.completion.totalCount} compulsory items done`;
    const note = $(".jr-locked", section);
    if (locked && !note) $("[data-error]", section).insertAdjacentHTML("beforebegin", `<p class="jr-locked">${LOCKED_NOTE}</p>`);
    if (!locked && note) note.remove();
    for (const d of stage.deliverables) rows.get(d.id)?.update(d, locked);
  }

  railEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-stage]");
    if (!b || b.dataset.stage === selectedId) return;
    selectedId = b.dataset.stage; drawSection();
  });
  drawSection();
  return Founders.watch(() => { const now = Founders.journeyNow(); if (host.isConnected && now && now !== j) { j = now; patch(); } });
}

// ---------- Competitions ----------
function competitionsTab(host, initial) {
  let comps = initial;
  let filter = "all";
  const draw = () => {
    const visible = filter === "all" ? comps : comps.filter((c) => c.status === filter);
    host.innerHTML = `<div class="cp-head"><span class="pt-eyebrow">Competitions</span>
      <div class="pt-seg" role="group" aria-label="Filter competitions by status">${COMPETITION_FILTERS.map((f) => `<button type="button" aria-pressed="${filter === f}" data-filter="${f}">${f}</button>`).join("")}</div></div>
      <ul class="cp-list">${visible.length ? visible.map(cardHtml).join("") : `<li class="pt-empty">${comps.length ? "No competitions in this filter. Try another one." : "No competitions are listed yet. The program team publishes them here."}</li>`}</ul>`;
  };
  const cardHtml = (c) => {
    const facts = [["Eligibility", c.eligibility], ["Event", c.eventDate ? fmtDate(c.eventDate) : ""], ["Deadline", c.deadline ? fmtDate(c.deadline) : ""], ["Prize", c.prize]];
    return `<li class="cp-card" data-comp="${esc(c.id)}"><div class="cp-top"><div><div class="cp-title"><h3>${esc(c.name)}</h3><span class="pt-tag ${COMP_PILL[c.status]}">${esc(c.status)}</span></div>${c.org ? `<p class="cp-org">${esc(c.org)}</p>` : ""}</div>
      <button type="button" class="cp-star${c.saved ? " is-on" : ""}" data-star aria-pressed="${c.saved}" aria-label="${c.saved ? "Unsave" : "Save"} competition">${STAR(c.saved)}</button></div>
      ${c.about ? `<p class="cp-about">${esc(c.about)}</p>` : ""}
      <dl class="cp-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v ? esc(v) : "—"}</dd></div>`).join("")}</dl>
      <div class="cp-foot"><label class="cp-status" for="status-${esc(c.id)}">Status <select class="pt-field is-pill" id="status-${esc(c.id)}" data-status>${["open", "applied", "result", "closed"].map((s) => `<option value="${s}"${s === c.status ? " selected" : ""}>${cap(s)}</option>`).join("")}</select></label>
        ${c.url ? `<a class="cp-site" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Official site ↗</a>` : ""}<span class="cp-err" role="alert" data-err></span></div></li>`;
  };

  // Optimistic: the card changes at once; if the server refuses, it goes back and says why.
  async function change(id, changes) {
    const before = comps;
    comps = comps.map((c) => (c.id === id ? { ...c, ...changes } : c));
    draw();
    try { comps = (await api(`/api/courses/${Founders.COURSE_ID}/lab/competitions`, { method: "POST", body: { compId: id, ...changes } })).competitions; draw(); }
    catch (e) { comps = before; draw(); const card = $(`[data-comp="${CSS.escape(id)}"] [data-err]`, host); if (card) card.textContent = e.message || "Could not save. Try again."; }
  }
  host.addEventListener("click", (e) => {
    const f = e.target.closest("[data-filter]");
    if (f) { filter = f.dataset.filter; return draw(); }
    const star = e.target.closest("[data-star]");
    if (star) { const id = star.closest("[data-comp]").dataset.comp; change(id, { saved: !comps.find((c) => c.id === id).saved }); }
  });
  host.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-status]");
    if (sel) change(sel.closest("[data-comp]").dataset.comp, { status: sel.value });
  });
  draw();
}

Panels.journey = async (el, hub) => {
  if (!hub.manifest) { el.innerHTML = emptyState("Coming soon", "This course has no journey yet.", icon("pCompass")); return; }
  const tab = hashParts()[1] || "startup";
  if (!JOURNEY_TABS.some((t) => t.id === tab)) return notAvailableYet(el);
  await Founders.journey(true); // fresh each visit; a failure falls through to the router's error box with Retry
  el.className = "pt-page";
  el.innerHTML = `${viewHeader(tab)}<div class="pt-view" data-view></div>`;
  const view = $("[data-view]", el);
  if (tab === "competitions") {
    const { competitions } = await api(`/api/courses/${Founders.COURSE_ID}/lab/competitions`);
    competitionsTab(view, competitions);
    return;
  }
  return startupTab(view);
};
