// Overview: the Founder's Lab portal's home page (greeting, journey card with the 7-stage rail, Next action, Next session, Recent activity,
// Quick access, footer strip). Everything about the journey comes from the server (Founders.journey()): this file only draws it.
const CHECK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const QUICK_ACCESS = [
  { href: "#toolkit", icon: "pBook", title: "Toolkit", subtitle: "Guides for founders" },
  { href: "#sessions", icon: "pCalendar", title: "Sessions", subtitle: "Upcoming & past sessions" },
  { href: "#journey", icon: "pCompass", title: "My Journey", subtitle: "Stages and checklist" },
];
const TAGLINE = "Learn . Build . Connect . Launch";
const QUOTE = "“Small steps build big companies.”";
const HALF_STAGE = 0.5; // the gold line ends in the middle of the current stage's node

// Hero art: a climber on a sun, drawn only with theme tokens (the old portal's palette mapped to Study Hub's).
const HERO_ART = `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="pt-sun" cx="50%" cy="42%" r="60%">
  <stop offset="0%" style="stop-color:var(--surface-2)"/><stop offset="55%" style="stop-color:var(--gold)"/><stop offset="100%" style="stop-color:var(--gold-dark)"/></radialGradient></defs>
  <rect width="100" height="100" fill="url(#pt-sun)"/>
  <path d="M0 78 L16 54 L28 66 L44 38 L58 58 L72 46 L100 80 L100 100 L0 100 Z" style="fill:var(--next-bg)" opacity="0.28"/>
  <path d="M22 100 L46 52 L54 62 L68 40 L100 100 Z" style="fill:var(--next-bg)"/>
  <g style="fill:var(--next-bg)"><rect x="63" y="34" width="4.5" height="6" rx="1" transform="rotate(18 63 34)"/><circle cx="68.5" cy="34.5" r="3"/><path d="M65.5 37 Q68.5 41 71 38 L74 47 Q69 51 64 48 Z"/>
  <path d="M65 46 L62 54 M70 46 L73 54" style="stroke:var(--next-bg)" stroke-width="2" stroke-linecap="round"/></g></svg>`;

const ic = (name) => `<span aria-hidden="true">${icon(name)}</span>`;
const stageWord = { done: "Complete", current: "In progress", locked: "Upcoming" };

function dateParts(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const part = (o) => d.toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
  return { month: part({ month: "short" }).toUpperCase(), day: d.getUTCDate(), weekday: part({ weekday: "short" }).toUpperCase() };
}

// The rail: a hairline with a gold line grown to the current stage, one round node per stage.
function railHtml(stages) {
  const completed = stages.filter((s) => s.status === "done").length;
  const currentIdx = stages.findIndex((s) => s.status === "current");
  const progress = currentIdx === -1 ? completed / stages.length : (currentIdx + HALF_STAGE) / stages.length;
  return `<div class="pt-rail"><div class="pt-rail-line"></div><div class="pt-rail-fill" style="transform:scaleX(${progress})"></div>
    <ol>${stages.map((s) => `<li class="${s.status === "locked" ? "" : "is-reached"} ${s.status === "current" ? "is-current" : ""}"${s.status === "current" ? ' aria-current="step"' : ""}>
      <span class="pt-node">${ic("pCheck")}</span><b>${esc(s.label)}</b><small>${stageWord[s.status]}</small></li>`).join("")}</ol></div>`;
}

function overviewHtml(hub, j, nextSession) {
  const current = j.stages.find((s) => s.id === j.currentId);
  const first = String(hub.user.name).trim().split(/\s+/)[0];
  const na = j.nextAction;
  const when = nextSession?.date ? dateParts(nextSession.date) : null;
  return `
    <header class="pt-hero">
      <div><h1 class="pt-h1">${esc(timeGreeting())}${first ? `, ${esc(first)}` : ""}.</h1><p class="pt-sub">Keep building. You’re making progress.</p></div>
      <div class="pt-hero-side"><p class="pt-quote">${esc(QUOTE)}</p><div class="pt-art">${HERO_ART}</div></div>
    </header>

    <div class="pt-grid">
      <section class="pt-card" aria-labelledby="pt-j">
        <div class="pt-head"><h2 class="pt-eyebrow" id="pt-j">Your journey</h2>
          <div class="pt-right"><span>${j.doneStages} of ${j.totalStages} stages complete</span><span class="pt-pct">${j.percent}%</span></div></div>
        <div class="pt-cur"><div><p class="pt-cur-name">${esc(current.label)}</p>
            <p class="pt-cur-sub">${current.completion.doneCount} of ${current.completion.totalCount} compulsory items done.</p></div>
          <a class="pt-ghost" href="#journey">View details ${ic("pArrow")}</a></div>
        ${railHtml(j.stages)}
      </section>

      <section class="pt-next" aria-labelledby="pt-n">
        <div><div class="pt-next-top"><h2 class="pt-eyebrow" id="pt-n">Next action</h2><span class="pt-pill">Priority</span></div>
          <h3>${esc(na ? na.label : "All caught up for this stage.")}</h3>
          <p>${esc(na ? na.hint : "Nothing compulsory left open right now. Nice work.")}</p></div>
        <div class="pt-next-foot"><span>${esc(current.label)}</span><a class="pt-round" href="#journey" aria-label="Open My Journey">${ic("pArrow")}</a></div>
      </section>
    </div>

    <div class="pt-two">
      <section class="pt-card" aria-labelledby="pt-s">
        <div class="pt-line"><h2 class="pt-eyebrow" id="pt-s">Next session</h2><a class="pt-link" href="#sessions">View all ${ic("pChevron")}</a></div>
        ${nextSession ? `<div class="pt-session">${when ? `<div class="pt-date"><small>${when.month}</small><b>${when.day}</b><em>${when.weekday}</em></div>` : ""}
          <p><span class="t">${esc(nextSession.topic)}</span>${nextSession.time ? `<span class="m" style="display:block">${esc(nextSession.time)}</span>` : ""}</p></div>`
        : '<p class="pt-none">No upcoming sessions scheduled.</p>'}
      </section>

      <section class="pt-card" aria-labelledby="pt-a">
        <h2 class="pt-eyebrow" id="pt-a">Recent activity</h2>
        <ul class="pt-acts">${j.activity.length ? j.activity.map((a) => `
          <li><span class="pt-act-ic">${ic("pCheck")}</span><p><span class="t" style="display:block">${esc(a.title)}</span>${a.date ? `<span class="d">${esc(fmtShort(a.date))}</span>` : ""}</p></li>`).join("")
          : '<li class="pt-none" style="margin:0">Nothing yet. Items you complete show up here.</li>'}</ul>
      </section>
    </div>

    <section class="pt-quick" aria-labelledby="pt-q">
      <div class="pt-line"><h2 class="pt-eyebrow" id="pt-q">Quick access</h2><span class="note">Everything you need, in one place.</span></div>
      <ul>${QUICK_ACCESS.map((q) => `<li><a class="pt-qcard" href="${q.href}"><span class="pt-qic">${ic(q.icon)}</span>
        <span class="pt-qtxt"><b>${esc(q.title)}</b><span>${esc(q.subtitle)}</span></span><span class="pt-qarrow">${ic("pArrow")}</span></a></li>`).join("")}</ul>
    </section>

    <div class="pt-foot"><p class="tag">${esc(TAGLINE)}</p><div><p class="co">${esc(hub.manifest?.cohortLabel ?? hub.title)}</p><div class="rule"></div></div></div>`;
}

Panels.overview = async (el, hub) => {
  if (!hub.manifest) {
    const d = await hub.getHub();
    el.innerHTML = head("Overview", d.course.title, d.course.description || "") + emptyState("Coming soon", "Sessions for this course will appear here.", icon("overview"));
    return;
  }
  const j = await Founders.journey(true); // fresh each visit; a failure falls through to the router's error box with Retry
  el.className = "pt-page pt-stagger";
  // The next visible session dated today or later, worked out by the server from the Sessions list. A failure just shows "no upcoming sessions".
  const nextSession = await api(`/api/courses/${Founders.COURSE_ID}/lab/sessions`).then((r) => r.next && { topic: r.next.name, date: r.next.date, time: r.next.time }).catch(() => null);
  let shown = j;
  const draw = () => { el.innerHTML = overviewHtml(hub, shown, nextSession); };
  draw();
  // Redraw only when the journey itself changed (other progress events, like a focus refresh, must not replay the entrance animation).
  return Founders.watch(() => { const now = Founders.journeyNow(); if (el.isConnected && now && now !== shown) { shown = now; draw(); } });
};

// ---------- tabs with no content yet ----------
const head = (label, title, sub) => `<div class="panel-head"><p class="mono-label">${esc(label)}</p><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div>`;
