// Study Notes reader. Renders the typed blocks in session.json natively; nothing here is specific to Session 1,
// so a new session only needs its own JSON (new block types go in BLOCKS + WIRE below).
// Layout: the contents list lives in a tinted side panel (ctx.panelHost); the sections are flat (whitespace + a hairline) in the
// reading area (host); only interactive widgets are bordered cards. See css/resources.css.

// Strings in session.json carry only <b>/<i>; everything else is escaped. Shared by the notes and activities views.
const richHtml = (s) => esc(s).replace(/&lt;(\/?)(b|i)&gt;/g, "<$1$2>");

const NotesView = (() => {
  const XP_FLASH_MS = 1600;
  const SPY_TOP_PX = 110; // reading line just under the sticky top bar
  const SPY_BOTTOM_PCT = 60;
  const PROSE = new Set(["lead", "paragraph"]);
  const SPLIT = new Set(["whyLadder", "hats", "list"]); // prose + one of these sit side by side when the column is wide

  const h = richHtml;
  const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

  // ---------- block renderers: (block, ctx) => html ----------
  const BLOCKS = {
    lead: (b) => `<p class="nt-lead">${h(b.html)}</p>`,
    paragraph: (b) => `<p class="nt-p${b.style === "muted" ? " muted" : b.style === "lead" ? " nt-lead" : ""}">${h(b.html)}</p>`,
    list: (b) => `<ul class="nt-checks">${b.items.map((x) => `<li><span class="nt-ck" aria-hidden="true">${CHECK}</span><span>${h(x)}</span></li>`).join("")}</ul>`,
    stories: (b) => `<div class="nt-cols c2">${b.items.map((x) => `
      <article class="nt-col"><p class="nt-kicker">${h(x.label)}</p><h3>${h(x.title)}</h3><p>${h(x.html)}</p></article>`).join("")}</div>`,
    steps: (b) => `<ol class="nt-cols c3">${b.items.map((x) => `
      <li class="nt-col"><p class="nt-kicker">${h(x.label)}</p><h3>${h(x.title)}</h3><p>${h(x.html)}</p></li>`).join("")}</ol>`,
    flips: (b) => `<p class="nt-hint">Tap each card to flip it.</p><div class="nt-flips">${b.items.map((x) => `
      <button type="button" class="flip" aria-pressed="false"><span class="flip-in">
        <span class="flip-face front"><span class="nt-kicker">${h(x.letter)} · tap to flip</span><span class="flip-title">${h(x.title)}</span><span class="flip-text">${h(x.front)}</span></span>
        <span class="flip-face back" aria-hidden="true">${x.back.map((r) => `<span class="flip-text${r.muted ? " muted" : ""}"><b>${h(r.label)}:</b> ${h(r.html)}</span>`).join("")}</span>
      </span></button>`).join("")}</div>`,
    callout: (b) => `<div class="nt-note" role="note"><p class="nt-kicker">${h(b.label)}</p><p>${h(b.html)}</p></div>`,
    note: (b) => `<div class="nt-note" role="note"><p class="nt-kicker">${h(b.label)}</p><h3>${h(b.title)}</h3><p>${h(b.html)}</p></div>`,
    quickcheck: (b, ctx) => {
      const id = `qc-${ctx.uid()}`;
      return `<div class="qc" role="group" aria-labelledby="${id}"><p class="qc-q" id="${id}">${h(b.question)}</p>
        <div class="qc-opts">${b.options.map((o) => `<button type="button" class="qc-opt">${h(o)}</button>`).join("")}</div>
        <p class="qc-fb" role="status"></p></div>`;
    },
    whyLadder: () => `<div class="nt-widget nt-why"><p class="nt-kicker">Tap “Next why” to dig deeper</p>
      <div class="why-rungs" role="status"></div>
      <div class="nt-actions"><button type="button" class="btn-pill solid sm" data-why-next>Next why</button><button type="button" class="btn-pill sm" data-why-reset>Start again</button></div></div>`,
    hats: (b) => `<div class="nt-widget"><p class="nt-p muted">${h(b.ideaLabel)} <b>${h(b.idea)}</b> Tap a hat to see what it says.</p>
      <div class="nt-hats">${b.items.map((x, i) => `
        <button type="button" class="hat-btn" data-tone="${esc(x.id)}" data-i="${i}" aria-pressed="false">
          <svg class="hat-svg" viewBox="0 0 64 40" aria-hidden="true"><path d="M14 30C14 8 50 8 50 30Z"/><rect x="3" y="28" width="58" height="8" rx="4"/></svg>
          <b>${h(x.name)}</b><small>${h(x.focus)}</small></button>`).join("")}</div>
      <div class="nt-hatout" role="status"><p class="nt-kicker">Pick a hat</p><p>Tap any hat above.</p></div></div>`,
    spots: (b) => `<div class="nt-widget"><p class="nt-count" role="status"><span data-seen>0</span> of ${b.items.length} spots seen</p>
      <div class="nt-spots">${b.items.map((x, i) => `
        <button type="button" class="spot" data-i="${i}" aria-pressed="false"><span class="spot-n" aria-hidden="true">${i + 1}</span><span>${h(x.name)}</span></button>`).join("")}</div>
      <div class="nt-spotout" role="status"><p class="nt-kicker">Problem spotted</p><p>Tap a spot on the street.</p></div></div>`,
    glossary: (b) => `<dl class="nt-gloss">${b.items.map((x) => `<div><dt>${h(x.term)}</dt><dd>${h(x.html)}</dd></div>`).join("")}</dl>`,
    takeaways: (b) => `<ol class="nt-takes">${b.items.map((x) => `<li>${h(x)}</li>`).join("")}</ol>`,
  };

  // ---------- block interactions: (root, block, ctx) => void ----------
  const WIRE = {
    flips(root) {
      for (const card of $$(".flip", root)) {
        card.addEventListener("click", () => {
          const on = card.classList.toggle("on");
          card.setAttribute("aria-pressed", on);
          $(".front", card).setAttribute("aria-hidden", on);
          $(".back", card).setAttribute("aria-hidden", !on);
        });
      }
    },
    quickcheck(root, b) {
      const card = $(".qc", root);
      const opts = $$(".qc-opt", root);
      const fb = $(".qc-fb", root);
      opts.forEach((btn, i) => btn.addEventListener("click", () => {
        if (card.classList.contains("solved") || btn.getAttribute("aria-disabled") === "true") return;
        if (i === b.correct) {
          card.classList.add("solved");
          btn.classList.add("right");
          for (const o of opts) o.setAttribute("aria-disabled", "true");
          fb.innerHTML = `<b>Yes!</b> ${h(b.why)}`;
        } else { // one try per option
          btn.classList.add("wrong");
          btn.setAttribute("aria-disabled", "true");
          fb.innerHTML = "<b>Not quite.</b> Try another one.";
        }
      }));
    },
    whyLadder(root, b) {
      const rungs = $(".why-rungs", root);
      const next = $("[data-why-next]", root);
      let step = 0;
      const draw = () => {
        rungs.innerHTML = `<div class="rung top"><p class="nt-kicker">The problem we see</p><p>${h(b.start)}</p></div>`
          + b.steps.slice(0, step).map((s, i) => `<div class="rung" style="--d:${i}"><p class="nt-kicker">Why #${i + 1}</p><p><b>${h(s.question)}</b><br>${h(s.answer)}</p></div>`).join("")
          + (step === b.steps.length ? `<div class="rung root"><p class="nt-kicker">Root found</p><p>${h(b.root)}</p></div>` : "");
        next.disabled = step >= b.steps.length;
      };
      next.addEventListener("click", () => { if (step < b.steps.length) { step++; draw(); } });
      $("[data-why-reset]", root).addEventListener("click", () => { step = 0; draw(); });
      draw();
    },
    hats(root, b) {
      const out = $(".nt-hatout", root);
      const btns = $$(".hat-btn", root);
      btns.forEach((btn) => btn.addEventListener("click", () => {
        const x = b.items[Number(btn.dataset.i)];
        for (const o of btns) o.setAttribute("aria-pressed", o === btn);
        out.dataset.tone = x.id;
        out.innerHTML = `<p class="nt-kicker">${h(x.name)} hat · ${h(x.focus)}</p><p class="nt-hatsay">${h(x.text)}</p>`;
      }));
    },
    spots(root, b) {
      const out = $(".nt-spotout", root);
      const seen = new Set();
      for (const btn of $$(".spot", root)) {
        btn.addEventListener("click", () => {
          const i = Number(btn.dataset.i);
          const x = b.items[i];
          seen.add(i);
          $$(".spot", root).forEach((o) => o.setAttribute("aria-pressed", o === btn));
          btn.classList.add("seen");
          $("[data-seen]", root).textContent = seen.size;
          out.innerHTML = `<p class="nt-kicker">Problem #${i + 1} · ${h(x.name)}</p>
            <p><b>The problem:</b> ${h(x.problem)}</p><p><b>Who suffers:</b> ${h(x.who)}</p><p><b>Idea sparks:</b> ${h(x.sparks)}</p>`;
        });
      }
    },
  };

  // Consecutive prose blocks form one group; everything else is its own widget. Prose + one wide widget go side by side.
  function layoutSection(s, blockCtx) {
    let groups = [];
    s.blocks.forEach((b, i) => {
      const html = `<div class="nt-block" data-b="${i}">${(BLOCKS[b.type] ?? (() => ""))(b, blockCtx)}</div>`;
      const prose = PROSE.has(b.type);
      const last = groups.at(-1);
      if (prose && last?.prose) last.html += html;
      else groups.push({ prose, type: b.type, html });
    });
    // A quick check sits right under the paragraph it tests (the first prose group), not at the bottom of the section.
    const qcs = groups.filter((g) => g.type === "quickcheck");
    if (groups[0]?.prose && qcs.length) {
      const rest = groups.filter((g) => g.type !== "quickcheck");
      groups = [rest[0], ...qcs, ...rest.slice(1)];
    }
    const wrap = (g) => (g.prose ? `<div class="nt-prose">${g.html}</div>` : g.html);
    const split = groups.length === 2 && groups[0].prose && SPLIT.has(groups[1].type);
    return split ? `<div class="nt-split">${groups.map(wrap).join("")}</div>` : groups.map(wrap).join("");
  }

  // ---------- the view ----------
  function mount(host, ctx) {
    const sections = ctx.data.notes;
    const required = sections.filter((s) => s.required).map((s) => s.id);
    const totalXp = sections.reduce((n, s) => n + s.xp, 0);
    const key = ctx.item.storageKey;
    let uid = 0;
    const blockCtx = { uid: () => ++uid };

    const readDone = () => { const v = Founders.readKey(key); return v && typeof v === "object" ? v : {}; };
    const nextOf = (i) => sections[i + 1];
    const tocItems = (done) => sections.map((s, i) => `
      <li><button type="button" class="toc-item${done[s.id] ? " is-done" : ""}" data-go="${esc(s.id)}">
        <span class="toc-n" aria-hidden="true">${done[s.id] ? CHECK : i + 1}</span><span class="toc-t">${h(s.title)}</span>
        ${done[s.id] ? '<span class="sr-only">(done)</span>' : ""}</button></li>`).join("");
    const all = (sel) => [...$$(sel, host), ...$$(sel, ctx.panelHost)]; // the list lives in the side panel and in the narrow-screen dropdown

    // Side panel: this page's navigation on its own tinted surface. The only progress bar for the page.
    ctx.panelHost.innerHTML = `<nav aria-label="Study notes contents">
      <p class="rs-ph-t">${h(ctx.item.label)}</p><p class="rs-ph-s" data-prog-text></p>
      <div class="nt-track" role="progressbar" aria-label="Sections done" aria-valuemin="0" aria-valuemax="${sections.length}"><i data-prog-fill></i></div>
      <ol class="toc-list" data-toc></ol></nav>`;

    host.innerHTML = `<details class="nt-toc-m"><summary><span>Contents</span><small data-m-count></small></summary>
        <ol class="toc-list" data-toc></ol></details>
      <div class="nt-main">
        ${sections.map((s, i) => `
          <section class="nt-sec" id="nt-${esc(s.id)}" data-sec="${esc(s.id)}" aria-labelledby="nt-${esc(s.id)}-h">
            <header class="nt-sec-h"><p class="nt-part">${h(s.tag)}</p><h2 id="nt-${esc(s.id)}-h" tabindex="-1">${h(s.title)}</h2></header>
            <div class="nt-body">${layoutSection(s, blockCtx)}</div>
            <footer class="nt-sec-f">
              <button type="button" class="nt-done-btn" aria-pressed="false" data-done="${esc(s.id)}"><span class="bx" aria-hidden="true">${CHECK}</span>Mark as done</button>
              <span class="nt-xp" role="status"></span>
              ${nextOf(i) ? `<button type="button" class="next-link" data-go="${esc(nextOf(i).id)}">Next: ${h(nextOf(i).title)} <span aria-hidden="true">→</span></button>` : ""}
            </footer>
          </section>`).join("")}
      </div>`;

    // wire block interactions
    sections.forEach((s) => $$(".nt-block", $(`#nt-${s.id}`, host)).forEach((el) => {
      const b = s.blocks[Number(el.dataset.b)];
      const wire = WIRE[b.type];
      if (wire) wire(el, b, blockCtx);
      else if (!BLOCKS[b.type]) console.warn(`Unknown note block type: ${b.type}`);
    }));

    const draw = () => {
      const done = readDone();
      const got = sections.reduce((n, s) => n + (done[s.id] ? s.xp : 0), 0);
      const count = sections.filter((s) => done[s.id]).length;
      all("[data-toc]").forEach((ol) => { ol.innerHTML = tocItems(done); });
      all("[data-prog-text]").forEach((el) => { el.textContent = `${count} of ${sections.length} done`; el.title = `${got} / ${totalXp} XP`; });
      all("[data-prog-fill]").forEach((el) => { el.style.width = `${pct(count, sections.length)}%`; });
      all(".nt-track").forEach((el) => el.setAttribute("aria-valuenow", count));
      $("[data-m-count]", host).textContent = `${count} of ${sections.length} done`;
      for (const s of sections) $(`[data-done="${s.id}"]`, host).setAttribute("aria-pressed", !!done[s.id]);
      markCurrent();
    };

    // toggle "done"; same storage key and shape the original page used (section id -> true)
    host.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-done]");
      if (btn) {
        const s = sections.find((x) => x.id === btn.dataset.done);
        const done = readDone();
        done[s.id] = !done[s.id];
        Founders.writeKey(key, done);
        const flash = $(".nt-xp", btn.closest(".nt-sec-f"));
        flash.textContent = done[s.id] ? `+${s.xp} XP` : "";
        flash.classList.toggle("show", !!done[s.id]);
        setTimeout(() => { flash.textContent = ""; flash.classList.remove("show"); }, XP_FLASH_MS);
        ctx.changed();
        return;
      }
      const go = e.target.closest("[data-go]");
      if (go) goTo(go.dataset.go);
    });
    ctx.panelHost.addEventListener("click", (e) => { const go = e.target.closest("[data-go]"); if (go) goTo(go.dataset.go); });

    function goTo(id) {
      const sec = $(`#nt-${id}`, host);
      $(".nt-toc-m", host).open = false;
      sec.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      $("h2", sec).focus({ preventScroll: true });
    }

    // scroll-spy: the first section crossing the reading line is "current"
    let current = sections[0].id;
    function markCurrent() {
      all(".toc-item").forEach((b) => (b.dataset.go === current ? b.setAttribute("aria-current", "location") : b.removeAttribute("aria-current")));
    }
    const visible = new Set();
    const spy = new IntersectionObserver((entries) => {
      for (const en of entries) (en.isIntersecting ? visible.add(en.target.dataset.sec) : visible.delete(en.target.dataset.sec));
      const first = sections.find((s) => visible.has(s.id));
      if (first && first.id !== current) { current = first.id; markCurrent(); }
    }, { rootMargin: `-${SPY_TOP_PX}px 0px -${SPY_BOTTOM_PCT}% 0px` });
    $$(".nt-sec", host).forEach((c) => spy.observe(c));

    draw();
    return {
      badge: () => { const d = readDone(); return `${sections.filter((s) => d[s.id]).length}/${sections.length}`; },
      isComplete: () => { const d = readDone(); return required.every((id) => d[id]); },
      refresh: draw,
      destroy: () => spy.disconnect(),
    };
  }

  return { mount };
})();
