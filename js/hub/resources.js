const YT_EMBED_RE = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/embed\//;
const HL_COLORS = { yellow: "#FBE9A6", green: "#BFE8D2", pink: "#F8CDDA" };
const BAR_GAP = 10;
const BAR_HEIGHT_FALLBACK = 44;
const PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';

// ---------- video modal ----------
function openVideo(v, opener) {
  const dlg = document.createElement("dialog");
  dlg.className = "video-dialog";
  dlg.setAttribute("aria-label", v.title);
  const playable = YT_EMBED_RE.test(v.url);
  dlg.innerHTML = `<div class="vhead"><span>${esc(v.title)}</span><button type="button">Close</button></div>` +
    (playable
      ? `<iframe src="${esc(v.url)}" title="${esc(v.title)}" allow="fullscreen; encrypted-media; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-presentation" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`
      : `<div class="fallback"><p>This video can't be played here.</p>${v.url ? `<a class="btn-pill solid" href="${esc(v.url)}" target="_blank" rel="noopener noreferrer">Open in a new tab</a>` : ""}</div>`);
  document.body.append(dlg);
  const close = () => dlg.close();
  $("button", dlg).addEventListener("click", close);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener("close", () => { dlg.remove(); opener?.focus(); }); // removing the iframe stops playback
  dlg.showModal();
}

function videosTab(el, items) {
  if (!items.length) return (el.innerHTML = emptyState("No video lectures yet", "Lectures will appear here once they're uploaded.", icon("resources")));
  el.innerHTML = `<div class="cards">${items.map((v, i) => `
    <button type="button" class="hub-card vcard" data-i="${i}">
      <span class="vthumb"><span>${PLAY}</span></span>
      <span class="vbody"><h3>${esc(v.title)}</h3><p>${esc(v.moduleTitle)}${v.durationMin ? ` · ${v.durationMin} min` : ""}</p></span>
    </button>`).join("")}</div>`;
  $$(".vcard", el).forEach((b) => b.addEventListener("click", () => openVideo(items[b.dataset.i], b)));
}

function otherTab(el, items) {
  if (!items.length) return (el.innerHTML = emptyState("No other resources yet", "Links and downloads will appear here."));
  el.innerHTML = `<div class="cards">${items.map((x) => `
    <a class="hub-card link-card" href="${esc(x.url || "#")}" target="_blank" rel="noopener noreferrer">
      <h3>${esc(x.title)}</h3><p>${esc(x.moduleTitle)}</p><span class="link">Open <span class="arrow" aria-hidden="true">→</span></span>
    </a>`).join("")}</div>`;
}

// ---------- study text with highlights ----------
// Renders one paragraph as escaped text with <mark>s. Overlapping highlights are skipped (they stay in the side list).
function paragraphHtml(text, highlights) {
  let cursor = 0;
  let out = "";
  for (const h of [...highlights].sort((a, b) => a.startOffset - b.startOffset)) {
    if (h.startOffset < cursor || h.endOffset > text.length) continue;
    out += esc(text.slice(cursor, h.startOffset)) +
      `<mark class="hl hl-${esc(h.color)}" data-id="${esc(h.highlightId)}" tabindex="0" role="button" aria-label="Highlight: ${esc(h.text)}. Press Enter to manage.">${esc(text.slice(h.startOffset, h.endOffset))}</mark>`;
    cursor = h.endOffset;
  }
  return out + esc(text.slice(cursor));
}

function studyTab(el, texts) {
  if (!texts.length) return (el.innerHTML = emptyState("No study texts yet", "Reading material will appear here once it's added.", icon("guide")));

  const state = { current: texts[0], highlights: [], pending: null, mode: null };
  el.innerHTML = `
    <p class="hl-hint">Select any passage to highlight it in yellow, green or pink. Click a highlight to remove it.</p>
    <div class="st-layout">
      <nav class="st-list" aria-label="Study texts">${texts.map((t, i) => `<button type="button" data-i="${i}">${esc(t.title.replace(/^Study text:\s*/i, ""))}<small>${esc(t.moduleTitle)}</small></button>`).join("")}</nav>
      <article class="hub-card st-read" data-read></article>
      <aside class="hub-card hl-side" aria-label="My highlights"><h3>My highlights</h3><div data-hl-list></div></aside>
    </div>`;
  const read = $("[data-read]", el);
  const list = $("[data-hl-list]", el);

  const bar = document.createElement("div");
  bar.className = "hl-bar";
  bar.hidden = true;
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Highlight options");
  document.body.append(bar);

  const hideBar = () => { bar.hidden = true; state.pending = null; state.mode = null; };
  const placeBar = (rect) => {
    bar.hidden = false;
    const w = bar.offsetWidth;
    const h = bar.offsetHeight || BAR_HEIGHT_FALLBACK;
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, innerWidth - w - 8));
    const above = rect.top - h - BAR_GAP;
    bar.style.left = `${left}px`;
    bar.style.top = `${above >= 8 ? above : rect.bottom + BAR_GAP}px`;
  };

  function renderRead() {
    const t = state.current;
    read.innerHTML = `<h2>${esc(t.title)}</h2>` + (t.paragraphs.length
      ? t.paragraphs.map((p, i) => `<p data-idx="${i}">${paragraphHtml(p, state.highlights.filter((h) => h.paragraphIndex === i))}</p>`).join("")
      : emptyState("This text is empty", "Content hasn't been added yet."));
    $$(".st-list button", el).forEach((b) => (texts[b.dataset.i] === t ? b.setAttribute("aria-current", "true") : b.removeAttribute("aria-current")));
    renderList();
  }

  function renderList() {
    const hs = [...state.highlights].sort((a, b) => a.paragraphIndex - b.paragraphIndex || a.startOffset - b.startOffset);
    list.innerHTML = hs.length
      ? `<ul>${hs.map((h) => `<li><q style="--c:${HL_COLORS[h.color] ?? HL_COLORS.yellow}">${esc(h.text)}</q>${h.note ? `<span class="n">${esc(h.note)}</span>` : ""}
          <div class="acts"><button type="button" data-jump="${esc(h.highlightId)}">Jump</button><button type="button" data-del="${esc(h.highlightId)}">Remove</button></div></li>`).join("")}</ul>`
      : '<p class="none">No highlights yet.</p>';
  }

  async function select(i) {
    hideBar();
    state.current = texts[i];
    state.highlights = [];
    renderRead();
    try {
      state.highlights = await api(`/api/highlights?resourceId=${encodeURIComponent(state.current.resourceId)}`);
    } catch (e) { toast(e.message); }
    renderRead();
  }

  async function removeHighlight(id) {
    try {
      await api(`/api/highlights/${encodeURIComponent(id)}`, { method: "DELETE" });
      state.highlights = state.highlights.filter((h) => h.highlightId !== id);
      hideBar();
      renderRead();
    } catch (e) { toast(e.message); }
  }

  async function saveHighlight(color) {
    const p = state.pending;
    if (!p) return;
    try {
      const saved = await api("/api/highlights", { method: "POST", body: { ...p, color, note: $("input", bar)?.value ?? "", resourceId: state.current.resourceId } });
      state.highlights.push(saved);
      getSelection().removeAllRanges();
      hideBar();
      renderRead();
    } catch (e) { toast(e.message); }
  }

  // Selection -> { paragraphIndex, startOffset, endOffset, text } relative to the paragraph's own text.
  function selectionInfo() {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const pStart = range.startContainer.parentElement?.closest("p[data-idx]");
    const pEnd = range.endContainer.parentElement?.closest("p[data-idx]");
    if (!pStart || pStart !== pEnd || !read.contains(pStart)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(pStart);
    pre.setEnd(range.startContainer, range.startOffset);
    let start = pre.toString().length;
    let end = start + range.toString().length;
    const full = pStart.textContent;
    while (start < end && /\s/.test(full[start])) start++; // trim the selection's edges so the stored slice is exact
    while (end > start && /\s/.test(full[end - 1])) end--;
    if (end <= start) return null;
    return { paragraphIndex: Number(pStart.dataset.idx), startOffset: start, endOffset: end, text: full.slice(start, end), rect: range.getBoundingClientRect() };
  }

  function showCreateBar() {
    const info = selectionInfo();
    if (!info) { if (state.mode === "create" && !bar.contains(document.activeElement)) hideBar(); return; }
    const { rect, ...pending } = info;
    state.pending = pending;
    state.mode = "create";
    const note = $("input", bar)?.value ?? "";
    bar.innerHTML = `<button class="sw yellow" type="button" data-c="yellow" aria-label="Highlight yellow"></button><button class="sw green" type="button" data-c="green" aria-label="Highlight green"></button><button class="sw pink" type="button" data-c="pink" aria-label="Highlight pink"></button>
      <input type="text" maxlength="300" placeholder="Add a note (optional)" aria-label="Note for this highlight">`;
    $("input", bar).value = note;
    placeBar(rect);
  }

  function showManageBar(mark) {
    const h = state.highlights.find((x) => x.highlightId === mark.dataset.id);
    if (!h) return;
    state.mode = "manage";
    bar.innerHTML = `${h.note ? `<span class="note">${esc(h.note)}</span>` : '<span class="note">No note</span>'}<button class="txt" type="button" data-remove="${esc(h.highlightId)}">Remove highlight</button>`;
    placeBar(mark.getBoundingClientRect());
    $("button", bar).focus();
  }

  // ----- events -----
  $(".st-list", el).addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (b) select(Number(b.dataset.i)); });
  bar.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); }); // keep the text selected
  bar.addEventListener("click", (e) => {
    const c = e.target.closest("[data-c]");
    const rm = e.target.closest("[data-remove]");
    if (c) saveHighlight(c.dataset.c);
    if (rm) removeHighlight(rm.dataset.remove);
  });
  bar.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input")) { e.preventDefault(); saveHighlight("yellow"); } });
  read.addEventListener("click", (e) => { const m = e.target.closest("mark.hl"); if (m) showManageBar(m); });
  read.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("mark.hl")) { e.preventDefault(); showManageBar(e.target); } });
  list.addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    const jump = e.target.closest("[data-jump]");
    if (del) removeHighlight(del.dataset.del);
    if (jump) {
      const m = $(`mark[data-id="${CSS.escape(jump.dataset.jump)}"]`, read);
      if (!m) return toast("That highlight overlaps another one.");
      m.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      m.classList.add("flash");
      setTimeout(() => m.classList.remove("flash"), 1600);
    }
  });
  const onSelectionChange = () => { if (state.mode !== "manage" && !bar.contains(document.activeElement)) showCreateBar(); };
  const onPointerDown = (e) => { if (!bar.hidden && !bar.contains(e.target) && !e.target.closest("mark.hl")) hideBar(); };
  const onKey = (e) => { if (e.key === "Escape" && !bar.hidden) hideBar(); };
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", onKey);

  select(0);
  return () => {
    document.removeEventListener("selectionchange", onSelectionChange);
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("keydown", onKey);
    bar.remove();
  };
}

// ---------- panel ----------
Panels.resources = async (el, hub) => {
  const all = await api(hub.url("resources"));
  const by = (type) => all.filter((r) => r.type === type);
  const TABS = [
    { id: "video", label: "Video lectures", render: (t) => videosTab(t, by("video")) },
    { id: "study", label: "Study text", render: (t) => studyTab(t, by("study_text")) },
    { id: "other", label: "Other resources", render: (t) => otherTab(t, all.filter((r) => r.type !== "video" && r.type !== "study_text")) },
  ];
  el.innerHTML = `<div class="panel-head"><p class="mono-label">Resources</p><h1>Resources</h1><p>Lectures, reading and extra material for this course.</p></div>
    <div class="tabs" role="tablist" aria-label="Resource types">${TABS.map((t) => `<button type="button" role="tab" id="tab-${t.id}" aria-controls="tp-${t.id}" data-id="${t.id}">${esc(t.label)}</button>`).join("")}</div>
    <div data-tabpanel role="tabpanel" tabindex="0"></div>`;
  const tabs = $$("[role=tab]", el);
  const body = $("[data-tabpanel]", el);
  let cleanup = null;

  function show(id) {
    cleanup?.();
    cleanup = null;
    tabs.forEach((b) => { const on = b.dataset.id === id; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; });
    body.setAttribute("aria-labelledby", `tab-${id}`);
    body.id = `tp-${id}`;
    body.innerHTML = "";
    const result = TABS.find((t) => t.id === id).render(body);
    cleanup = typeof result === "function" ? result : null; // only the study tab needs tearing down
  }
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => show(b.dataset.id));
    b.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      const next = tabs[(i + step + tabs.length) % tabs.length];
      next.focus();
      show(next.dataset.id);
    });
  });
  show("video");
  return () => cleanup?.();
};
