// Activities hub: four team games rebuilt natively from session.json (rules and scoring come from the data).
// Progress is saved under the item's storageKey as { team, pts, done: { <gameId>: true } }, the shape the Overview and rings read.
const ActivitiesView = (() => {
  const SPIN_TURNS = 5;
  const SPIN_MS = 3600;
  const SPIN_JITTER = 0.6; // landing point wanders within the middle 60% of the wedge
  const FULL_TURN = 360;
  const WHEEL_R = 140;
  const WHEEL_LABEL_INSET = 14;
  const MIN_IDEA_CHARS = 8;
  const TIMER_TICK_MS = 100;
  const TIMER_WARN = 0.5;
  const TIMER_LOW = 0.25;
  const TEAM_NAME_MAX = 30;
  const RESET_CONFIRM_MS = 3000;
  const NEXT_RIGHT_MS = 900; // pause before the next hat comment after a right answer
  const NEXT_WRONG_MS = 1900;
  const NEXT_RUNG_MS = 1300;
  const NEXT_CARD_MS = 260;
  const CONFETTI = { game: 36, all: 72 };
  const h = richHtml;
  const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
  const motionOk = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Countdown bar. role="timer" is not announced on every tick, so screen readers aren't flooded.
  function timer(host, secs, onEnd) {
    const el = document.createElement("div");
    el.className = "ac-timer";
    el.setAttribute("role", "timer");
    el.setAttribute("aria-label", "Time left");
    el.innerHTML = '<div class="ac-bar"><i></i></div><span></span>';
    host.append(el);
    const t0 = Date.now();
    let stopped = false;
    const left = () => Math.max(0, secs - (Date.now() - t0) / 1000);
    const paint = () => {
      const l = left();
      $("i", el).style.width = `${(l / secs) * 100}%`;
      el.dataset.level = l < secs * TIMER_LOW ? "low" : l < secs * TIMER_WARN ? "warn" : "ok";
      $("span", el).textContent = `${Math.ceil(l)}s`;
      return l;
    };
    const id = setInterval(() => { if (!stopped && paint() <= 0) { stopped = true; clearInterval(id); onEnd?.(); } }, TIMER_TICK_MS);
    paint();
    return { el, left, stop() { stopped = true; clearInterval(id); } };
  }

  // ---------- game engines: (game, host, api) => void. api: add(points, streakChange), finish(), say(msg), cleanup(fn) ----------
  const ENGINES = {
    wheel(g, host, api) {
      const N = g.items.length, theta = FULL_TURN / N, S = g.scoring;
      const rad = (d) => (d * Math.PI) / 180;
      const pt = (deg, r) => `${(r * Math.cos(rad(deg))).toFixed(2)} ${(r * Math.sin(rad(deg))).toFixed(2)}`;
      let round = 0, rot = 0;
      const used = new Set();
      host.innerHTML = `<div class="wheel-wrap">
        <div class="wheel-box"><span class="wheel-ptr" aria-hidden="true"></span>
          <svg class="wheel" viewBox="-${WHEEL_R + 4} -${WHEEL_R + 4} ${(WHEEL_R + 4) * 2} ${(WHEEL_R + 4) * 2}" role="img" aria-label="Wheel of ${N} market problems"><g class="wheel-rot">
            ${g.items.map((it, i) => { const a0 = -90 + i * theta, mid = a0 + theta / 2;
              // Labels run along the radius; on the left half they are flipped 180 degrees so the text never reads upside-down.
              const m = ((mid % FULL_TURN) + FULL_TURN) % FULL_TURN, flip = m > 90 && m < 270, x = WHEEL_R - WHEEL_LABEL_INSET;
              return `<g class="seg s${i % 2}" data-i="${i}"><path d="M0 0 L${pt(a0, WHEEL_R)} A${WHEEL_R} ${WHEEL_R} 0 0 1 ${pt(a0 + theta, WHEEL_R)} Z"/>
                <text transform="rotate(${flip ? mid + 180 : mid})" x="${flip ? -x : x}" y="5" text-anchor="${flip ? "start" : "end"}">${esc(it.label)}</text></g>`; }).join("")}
          </g></svg>
          <button type="button" class="spin btn-pill solid">Spin</button></div>
        <div class="wheel-side"><p class="ac-round" role="status">Round 1 of ${g.rounds}</p>
          <div class="ac-card" data-res><p class="nt-label">Your challenge</p><p>Spin the wheel to get a problem from the market.</p></div>
          <div data-wplay></div></div></div>`;
      const spin = $(".spin", host), rotor = $(".wheel-rot", host), res = $("[data-res]", host), play = $("[data-wplay]", host);

      spin.addEventListener("click", () => {
        if (spin.disabled) return;
        spin.disabled = true;
        const free = g.items.map((_, i) => i).filter((i) => !used.has(i));
        const pick = free[Math.floor(Math.random() * free.length)];
        // Rotate so the picked wedge's centre (plus a little jitter) ends under the pointer at the top.
        const target = -(pick * theta + theta / 2) + (Math.random() - 0.5) * theta * SPIN_JITTER;
        rot += FULL_TURN * SPIN_TURNS + ((((target - rot) % FULL_TURN) + FULL_TURN) % FULL_TURN);
        const ms = motionOk() ? SPIN_MS : 0;
        rotor.style.transition = ms ? `transform ${ms}ms cubic-bezier(.12,.6,.1,1)` : "none";
        rotor.style.transform = `rotate(${rot}deg)`;
        const land = () => { used.add(pick); $(`.seg[data-i="${pick}"]`, host).classList.add("used"); landed(pick); };
        ms ? setTimeout(land, ms) : land();
      });

      function landed(i) {
        const it = g.items[i];
        res.innerHTML = `<p class="nt-label">Problem from the market</p><h3>${h(it.label)}</h3><p>${h(it.text)}</p>`;
        const ideas = [];
        play.innerHTML = `<p class="nt-label ac-gap">Brainstorm! Add up to ${g.maxIdeas} ideas before time runs out (+${S.ideaPts} each)</p>
          <div data-tm></div><ol class="ac-ideas"></ol>
          <form class="ac-row"><label class="sr-only" for="idea-${g.id}">Your idea</label>
            <input id="idea-${g.id}" maxlength="120" autocomplete="off" placeholder="Type an idea, e.g. ${esc(it.example)}"><button class="btn-pill solid sm" type="submit">Add</button></form>`;
        const tm = timer($("[data-tm]", play), g.seconds, review);
        api.cleanup(tm.stop);
        const input = $("input", play), list = $(".ac-ideas", play), form = $("form", play);
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const v = input.value.trim();
          if (v.length < MIN_IDEA_CHARS) return api.say(`Write a bit more (${MIN_IDEA_CHARS}+ letters)`);
          if (ideas.length >= g.maxIdeas) return;
          ideas.push(v); input.value = "";
          list.insertAdjacentHTML("beforeend", `<li>${esc(v)}</li>`);
          api.add(S.ideaPts);
          if (ideas.length >= g.maxIdeas) review();
        });
        input.focus({ preventScroll: true });

        let reviewed = false;
        function review() {
          if (reviewed) return;
          reviewed = true; tm.stop(); input.disabled = true; $("button", form).disabled = true;
          if (!ideas.length) {
            play.insertAdjacentHTML("beforeend", `<div class="ac-card"><p>No ideas this time! Shout ideas faster next round.</p><button type="button" class="btn-pill sm" data-next>Next</button></div>`);
            return $("[data-next]", play).addEventListener("click", (e) => { e.target.disabled = true; nextRound(); });
          }
          play.insertAdjacentHTML("beforeend", `<div class="ac-card"><p class="nt-label">R-E-U bonus check (+${S.reuPts} per tick, be honest!)</p>
            ${ideas.map((d) => `<div class="reu"><p>${esc(d)}</p><div class="reu-b">${["Realistic", "Executable", "Unique"].map((x) => `<button type="button" class="tog" aria-pressed="false">${x}</button>`).join("")}</div></div>`).join("")}
            <button type="button" class="btn-pill solid sm" data-lock>Lock it in</button></div>`);
          $$(".tog", play).forEach((b) => b.addEventListener("click", () => b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true")));
          $("[data-lock]", play).addEventListener("click", (e) => {
            const n = $$(".tog[aria-pressed=true]", play).length;
            $$(".tog", play).forEach((b) => { b.disabled = true; });
            e.target.disabled = true;
            if (n) api.add(n * S.reuPts);
            nextRound();
          });
        }
      }
      function nextRound() {
        round++;
        const label = $(".ac-round", host);
        if (round >= g.rounds) { label.textContent = "All rounds done"; return api.finish(); }
        label.textContent = `Round ${round + 1} of ${g.rounds}`;
        spin.disabled = false;
        api.say(`Spin again for round ${round + 1}`);
      }
    },

    sorter(g, host, api) {
      const S = g.scoring;
      const deck = shuffle(g.cards);
      let i = 0, right = 0, t0 = null, tick = null;
      host.innerHTML = `<div class="sort-top"><span class="nt-label" data-count></span><span class="nt-label" data-time>0s</span></div>
        <div class="deck"></div>
        <div class="bins" role="group" aria-label="Boxes">${g.bins.map((b, k) => `<button type="button" class="bin" data-k="${esc(b.key)}"><span class="bin-key" aria-hidden="true">${k + 1}</span><b>${h(b.label)}</b><small>${h(b.sub ?? "")}</small><span class="cnt" aria-label="cards placed">0</span></button>`).join("")}</div>
        <p class="ac-fb" role="status"></p>`;
      const deckEl = $(".deck", host), fb = $(".ac-fb", host), bins = $$(".bin", host);
      api.cleanup(() => clearInterval(tick));
      const startClock = () => { if (t0) return; t0 = Date.now(); tick = setInterval(() => { $("[data-time]", host).textContent = `${Math.round((Date.now() - t0) / 1000)}s`; }, 500); };
      const binAt = (x, y) => bins.find((b) => { const r = b.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });

      function show() {
        $("[data-count]", host).textContent = `Card ${Math.min(i + 1, deck.length)} of ${deck.length}`;
        if (i >= deck.length) return end();
        const card = document.createElement("div");
        card.className = "scard";
        card.tabIndex = 0;
        card.innerHTML = `<span class="nt-label">Drag me, tap a box, or press 1-${bins.length}</span><p>${h(deck[i].text)}</p>`;
        deckEl.replaceChildren(card);
        drag(card);
      }
      function drag(card) {
        let sx = 0, sy = 0, on = false;
        card.addEventListener("pointerdown", (e) => { on = true; sx = e.clientX; sy = e.clientY; card.setPointerCapture(e.pointerId); card.classList.add("drag"); startClock(); });
        card.addEventListener("pointermove", (e) => {
          if (!on) return;
          card.style.transform = `translate(${e.clientX - sx}px, ${e.clientY - sy}px) rotate(${(e.clientX - sx) / 40}deg)`;
          const hit = binAt(e.clientX, e.clientY);
          bins.forEach((b) => b.classList.toggle("hot", b === hit));
        });
        card.addEventListener("pointerup", (e) => {
          if (!on) return;
          on = false; card.classList.remove("drag");
          const hit = binAt(e.clientX, e.clientY);
          bins.forEach((b) => b.classList.remove("hot"));
          hit ? drop(hit) : (card.style.transform = "");
        });
        card.addEventListener("pointercancel", () => { on = false; card.style.transform = ""; card.classList.remove("drag"); });
      }
      function drop(bin) {
        if (i >= deck.length) return;
        startClock();
        const c = deck[i], ok = bin.dataset.k === c.bin, home = bins.find((b) => b.dataset.k === c.bin);
        if (ok) {
          right++; api.setStreak(api.streak() + 1);
          api.add(S.correctPts + (api.streak() > S.streakAfter ? S.streakBonus : 0));
          fb.innerHTML = `<b class="good">Correct!</b> ${h(c.why)}`;
        } else {
          api.setStreak(0);
          fb.innerHTML = `<b class="bad">Oops.</b> It belongs in <b>${esc($("b", home).textContent)}</b>. ${h(c.why)}`;
        }
        bin.classList.add(ok ? "yes" : "no");
        setTimeout(() => bin.classList.remove("yes", "no"), NEXT_CARD_MS * 2);
        const cnt = $(".cnt", home); cnt.textContent = Number(cnt.textContent) + 1;
        $(".scard", deckEl)?.classList.add("gone");
        i++;
        setTimeout(show, motionOk() ? NEXT_CARD_MS : 0);
      }
      bins.forEach((b) => b.addEventListener("click", () => drop(b)));
      host.addEventListener("keydown", (e) => { const b = bins[Number(e.key) - 1]; if (b && !e.target.matches("input,textarea")) { e.preventDefault(); drop(b); } });
      function end() {
        clearInterval(tick);
        const secs = Math.round((Date.now() - (t0 ?? Date.now())) / 1000), bonus = secs <= g.fastSecs ? S.fastBonus : 0;
        deckEl.innerHTML = `<div class="ac-card ac-end"><h3>${right} / ${deck.length} sorted right</h3><p>${secs} seconds${bonus ? ` · speed bonus +${bonus}!` : ""}</p><button type="button" class="btn-pill sm" data-again>Play again</button></div>`;
        if (bonus) api.add(bonus);
        $("[data-again]", deckEl).addEventListener("click", api.replay);
        api.finish();
      }
      show();
    },

    speed(g, host, api) {
      const S = g.scoring;
      host.innerHTML = `<div class="ac-card"><p>${h(g.how)}</p><button type="button" class="btn-pill solid sm" data-go>Start the clock</button></div>`;
      $("[data-go]", host).addEventListener("click", run);
      function run() {
        const items = shuffle(g.items);
        let i = 0, right = 0, tm = null, locked = false;
        host.innerHTML = `<div class="sp-top"><span class="nt-label" data-n></span><span class="nt-label">Streak x<b data-s>0</b></span></div>
          <div class="ac-card sp-q"></div><div data-tm></div>
          <div class="sp-opts" role="group" aria-label="Which hat is speaking?">${g.options.map((o) => `<button type="button" class="sp-o" data-tone="${esc(o.tone)}" data-k="${esc(o.key)}">${h(o.label)}</button>`).join("")}</div>
          <p class="ac-fb" role="status"></p>`;
        const fb = $(".ac-fb", host);
        api.cleanup(() => tm?.stop());
        function next() {
          if (i >= items.length) return end();
          locked = false; fb.textContent = "";
          $("[data-n]", host).textContent = `Comment ${i + 1} of ${items.length}`;
          $(".sp-q", host).innerHTML = `<p>${h(items[i].text)}</p>`;
          const slot = $("[data-tm]", host); slot.replaceChildren();
          tm = timer(slot, g.seconds, () => answer(null));
        }
        function answer(k, btn) {
          if (locked) return;
          locked = true; tm.stop();
          const it = items[i], ok = k === it.answer, label = g.options.find((o) => o.key === it.answer).label;
          if (ok) {
            right++; api.setStreak(api.streak() + 1);
            api.add(S.basePts + Math.round(tm.left()) + (api.streak() >= S.streakFrom ? S.streakBonus : 0));
            fb.innerHTML = `<b class="good">Yes!</b> ${h(it.why)}`;
          } else {
            api.setStreak(0);
            fb.innerHTML = `<b class="bad">${k ? "Nope." : "Time up!"}</b> That was the <b>${h(label)}</b>. ${h(it.why)}`;
          }
          $("[data-s]", host).textContent = api.streak();
          i++;
          setTimeout(next, ok ? NEXT_RIGHT_MS : NEXT_WRONG_MS);
        }
        $$(".sp-o", host).forEach((b) => b.addEventListener("click", () => answer(b.dataset.k, b)));
        function end() {
          host.innerHTML = `<div class="ac-card ac-end"><h3>${right} / ${items.length} correct</h3><p>${right >= items.length - 2 ? "Super fast thinking!" : "Play again to beat your score."}</p><button type="button" class="btn-pill sm" data-again>Play again</button></div>`;
          $("[data-again]", host).addEventListener("click", run);
          api.finish();
        }
        next();
      }
    },

    ladder(g, host, api) {
      const S = g.scoring;
      let pi = 0;
      function puzzle() {
        const p = g.puzzles[pi];
        let ri = 0, miss = false;
        host.innerHTML = `<p class="nt-label">Puzzle ${pi + 1} of ${g.puzzles.length}</p>
          <div class="ac-card"><p class="nt-label">Problem</p><p><b>${h(p.start)}</b></p></div>
          <ol class="lad-done" aria-label="Rungs climbed"></ol><div class="lad-q" role="group"></div>`;
        const q = $(".lad-q", host), done = $(".lad-done", host);
        function rung() {
          const r = p.rungs[ri];
          miss = false;
          q.setAttribute("aria-label", `Rung ${ri + 1} of ${p.rungs.length}`);
          q.innerHTML = `<p class="nt-label">Why #${ri + 1}: ${h(r.question)}</p>
            <div class="lad-opts">${r.options.map((o, k) => `<button type="button" class="lad-o" data-k="${k}">${h(o)}</button>`).join("")}</div><p class="ac-fb" role="status"></p>`;
          const fb = $(".ac-fb", q);
          $$(".lad-o", q).forEach((b) => b.addEventListener("click", () => {
            if (b.getAttribute("aria-disabled") === "true") return;
            if (Number(b.dataset.k) === r.correct) {
              b.classList.add("right");
              $$(".lad-o", q).forEach((x) => x.setAttribute("aria-disabled", "true"));
              if (!miss) { api.setStreak(api.streak() + 1); api.add(S.rungPts); }
              fb.innerHTML = `<b class="good">Deeper!</b> ${h(r.why)}`;
              done.insertAdjacentHTML("beforeend", `<li><span class="nt-label">Why #${ri + 1}</span> ${h(r.options[r.correct])}</li>`);
              ri++;
              setTimeout(ri < p.rungs.length ? rung : root, NEXT_RUNG_MS);
            } else {
              miss = true; api.setStreak(0);
              b.classList.add("wrong"); b.setAttribute("aria-disabled", "true");
              fb.innerHTML = `<b class="bad">Not deeper.</b> ${h(g.wrongText)}`;
            }
          }));
        }
        function root() {
          const last = pi >= g.puzzles.length - 1;
          q.innerHTML = `<div class="ac-card ac-end"><p class="nt-label">Root cause found</p><p>${h(p.root)}</p><button type="button" class="btn-pill solid sm" data-next>${last ? "Finish" : "Next puzzle"}</button></div>`;
          $("[data-next]", q).addEventListener("click", () => {
            pi++;
            if (pi < g.puzzles.length) return puzzle();
            host.innerHTML = `<div class="ac-card ac-end"><h3>All puzzles cracked!</h3><button type="button" class="btn-pill sm" data-again>Play again</button></div>`;
            $("[data-again]", host).addEventListener("click", api.replay);
            api.finish();
          });
          $("[data-next]", q).focus({ preventScroll: true });
        }
        rung();
      }
      puzzle();
    },
  };

  // ---------- the hub ----------
  function mount(host, ctx) {
    const cfg = ctx.data.activities;
    const key = ctx.item.storageKey;
    const base = () => { const v = Founders.readKey(key); return v && typeof v === "object" ? v : {}; };
    let S = { team: "", pts: 0, done: {}, ...base() };
    let streak = 0;
    let openId = null;
    let cleanups = [];
    const all = (sel) => [...$$(sel, host), ...$$(sel, ctx.panelHost)]; // the stats and list live in the side panel and the narrow-screen dropdown
    const save = () => Founders.writeKey(key, { ...base(), team: S.team, pts: S.pts, done: S.done });
    const doneCount = () => cfg.games.filter((g) => S.done[g.id]).length;
    const allDone = () => doneCount() === cfg.games.length;
    const runCleanups = () => { cleanups.forEach((fn) => fn()); cleanups = []; };

    function build() {
      const gameItems = () => cfg.games.map((g) => `
        <li><button type="button" class="toc-item${S.done[g.id] ? " is-done" : ""}" data-pick="${esc(g.id)}"${openId === g.id ? ' aria-current="true"' : ""}>
          <span class="toc-n" aria-hidden="true">${S.done[g.id] ? CHECK : g.no}</span><span class="toc-t">${h(g.title)}</span>${S.done[g.id] ? '<span class="sr-only">(done)</span>' : ""}</button></li>`).join("");

      // Side panel: this page's navigation (the games) plus the team's points and streak, on its own tinted surface.
      ctx.panelHost.innerHTML = `<nav aria-label="Games">
        <p class="rs-ph-t">${h(ctx.item.label)}</p><p class="rs-ph-s" data-hud="sum"></p>
        <div class="nt-track" role="progressbar" aria-label="Games done" aria-valuemin="0" aria-valuemax="${cfg.games.length}"><i data-prog-fill></i></div>
        <dl class="ac-sum"><div><dt>Points</dt><dd data-hud="pts"></dd></div><div><dt>Streak</dt><dd data-hud="streak"></dd></div></dl>
        <ol class="toc-list" data-games></ol></nav>`;

      host.innerHTML = `<div class="ac">
        <details class="nt-toc-m"><summary><span>Games</span><small data-hud="sum"></small></summary><ol class="toc-list" data-games></ol></details>
        <div class="ac-team"><label for="team-${esc(ctx.item.key)}">${h(cfg.team.label)}</label>
          <input id="team-${esc(ctx.item.key)}" maxlength="${TEAM_NAME_MAX}" placeholder="${esc(cfg.team.placeholder)}" autocomplete="off" value="${esc(S.team)}"></div>
        <p class="sr-only" role="status" data-say></p>
        <p class="ac-intro">${h(cfg.intro)}</p>
        <div class="ac-grid">${cfg.games.map((g) => `
          <section class="ac-game" id="ac-${esc(g.id)}" aria-labelledby="ac-${esc(g.id)}-h" data-game="${esc(g.id)}">
            <div class="ac-game-h"><span class="ac-no" aria-hidden="true">${g.no}</span>
              <div class="ac-game-t"><h2 id="ac-${esc(g.id)}-h">${h(g.title)}</h2><p>${h(g.blurb)}</p>
                <ul class="ac-meta">${g.meta.map((m) => `<li>${h(m)}</li>`).join("")}</ul></div>
              <div class="ac-game-a"><span class="ac-done" hidden>${CHECK}Done</span><button type="button" class="btn-pill solid sm" data-play>Play</button>
                <button type="button" class="link-btn" data-close hidden>Back to games</button></div></div>
            <div class="ac-play" hidden></div></section>`).join("")}</div>
        <p class="ac-allnote" data-allnote role="status" hidden>${CHECK}<span>All four activities done.</span></p>
        <p class="ac-reset"><button type="button" class="link-btn" data-reset>Reset team score</button></p>
      </div>`;

      const say = (msg) => { const el = $("[data-say]", host); el.textContent = ""; setTimeout(() => { el.textContent = msg; }, 50); };
      let listSig = "";
      const hud = () => {
        all('[data-hud="pts"]').forEach((el) => { el.textContent = S.pts; });
        all('[data-hud="streak"]').forEach((el) => { el.textContent = streak; });
        all('[data-hud="sum"]').forEach((el) => { el.textContent = `${doneCount()} of ${cfg.games.length} done`; });
        all("[data-prog-fill]").forEach((el) => { el.style.width = `${(doneCount() / cfg.games.length) * 100}%`; });
        all(".nt-track").forEach((el) => el.setAttribute("aria-valuenow", doneCount()));
        const sig = `${cfg.games.map((g) => (S.done[g.id] ? 1 : 0)).join("")}|${openId}`;
        if (sig !== listSig) { listSig = sig; all("[data-games]").forEach((ol) => { ol.innerHTML = gameItems(); }); }
        for (const g of cfg.games) {
          const sec = $(`#ac-${g.id}`, host), d = !!S.done[g.id];
          sec.classList.toggle("is-done", d);
          $(".ac-done", sec).hidden = !d;
          $("[data-play]", sec).textContent = d ? "Play again" : "Play";
        }
        $("[data-allnote]", host).hidden = !allDone();
      };
      const api = (g, sec) => ({
        add(pts) { S.pts += pts; save(); hud(); say(`Plus ${pts} points. ${S.pts} total, streak ${streak}`); },
        streak: () => streak,
        setStreak(n) { streak = n; hud(); },
        say,
        cleanup: (fn) => cleanups.push(fn),
        replay: () => start(g, sec),
        finish() {
          const first = !S.done[g.id];
          S.done[g.id] = true; save(); hud(); ctx.changed();
          say(`${g.title} complete`);
          confetti(CONFETTI.game);
          if (first && allDone()) { setTimeout(() => confetti(CONFETTI.all), 500); $("[data-allnote]", host).scrollIntoView({ behavior: motionOk() ? "smooth" : "auto", block: "center" }); }
        },
      });
      function start(g, sec) {
        runCleanups();
        streak = 0;
        openId = g.id;
        // The opened game takes the full width; the other three collapse to compact rows (css: .has-open).
        const grid = $(".ac-grid", host);
        grid.classList.add("has-open");
        for (const other of $$(".ac-game", grid)) {
          other.classList.toggle("is-open", other === sec);
          $("[data-close]", other).hidden = other !== sec;
          if (other !== sec) { $(".ac-play", other).hidden = true; $(".ac-play", other).replaceChildren(); }
        }
        const play = $(".ac-play", sec);
        play.hidden = false;
        play.replaceChildren();
        ENGINES[g.type]?.(g, play, api(g, sec));
        if (!ENGINES[g.type]) console.warn(`Unknown game type: ${g.type}`);
        $(".ac-toc-m, .nt-toc-m", host).open = false;
        hud();
        grid.scrollIntoView({ behavior: motionOk() ? "smooth" : "auto", block: "start" });
      }
      function closeGame() {
        runCleanups();
        openId = null;
        hud();
        const grid = $(".ac-grid", host);
        grid.classList.remove("has-open");
        for (const g of $$(".ac-game", grid)) {
          g.classList.remove("is-open");
          $("[data-close]", g).hidden = true;
          $(".ac-play", g).hidden = true; $(".ac-play", g).replaceChildren();
        }
      }

      const pickGame = (id) => start(cfg.games.find((g) => g.id === id), $(`#ac-${id}`, host));
      ctx.panelHost.addEventListener("click", (e) => { const pick = e.target.closest("[data-pick]"); if (pick) pickGame(pick.dataset.pick); });
      host.querySelector(".ac").addEventListener("click", (e) => {
        if (e.target.closest("[data-close]")) return closeGame();
        const pick = e.target.closest("[data-pick]");
        if (pick) return pickGame(pick.dataset.pick);
        const play = e.target.closest("[data-play]");
        if (play) { const sec = play.closest("[data-game]"); return start(cfg.games.find((g) => g.id === sec.dataset.game), sec); }
        const reset = e.target.closest("[data-reset]");
        if (reset) { // two taps: the first only asks
          if (!reset.dataset.sure) {
            reset.dataset.sure = "1"; reset.textContent = "Tap again to reset everything";
            setTimeout(() => { if (reset.isConnected) { delete reset.dataset.sure; reset.textContent = "Reset team score"; } }, RESET_CONFIRM_MS);
            return;
          }
          runCleanups(); S = { team: "", pts: 0, done: {} }; streak = 0; openId = null; save(); ctx.changed(); build();
        }
      });
      $(".ac-team input", host).addEventListener("input", (e) => { S.team = e.target.value.trim().slice(0, TEAM_NAME_MAX); save(); hud(); });
      hud();
    }

    build();
    return {
      badge: () => `${cfg.games.filter((g) => base().done?.[g.id]).length}/${cfg.games.length}`,
      isComplete: () => cfg.games.every((g) => base().done?.[g.id]),
      // Our own saves also trigger this; only rebuild when another tab changed the saved score (never mid-game).
      refresh() {
        const b = base();
        if (b.pts === S.pts && JSON.stringify(b.done ?? {}) === JSON.stringify(S.done)) return;
        S = { ...S, ...b, done: b.done ?? {} }; runCleanups(); build();
      },
      destroy: runCleanups,
    };
  }

  return { mount };
})();
