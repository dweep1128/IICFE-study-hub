// Course Guide and Amigo panels. The Course Guide panel is rebuilt on the .accordion styles and the /guidance route.

// ---------- course guide ----------
Panels.guide = async (el, hub) => {
  const items = await api(hub.url("guidance"));
  el.innerHTML = head("Course Guide", "Course Guide", "How to get the most out of this course.") + (items.length
    ? `<div class="accordion">${items.map((g, i) => `
        <details${i === 0 ? " open" : ""}><summary>${esc(g.title)}</summary><div class="body">${paras(g.body)}</div></details>`).join("")}</div>`
    : emptyState("No guide yet", "Your course guide will appear here once it's added.", icon("guide")));
};

// ---------- Amigo ----------
// There is no chat backend wired up yet, so this is an honest "coming soon" page: no fake replies, no invented features.
// The example questions come from the Study Notes and are not clickable.
const AMIGO_EXAMPLES = [
  "Explain the R-E-U test in simple words",
  "Give me an example of the Three Why approach",
  "Quiz me on the six hats",
  "What should I do for the homework?",
];
const AMIGO_MARK = `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" focusable="false">
  <circle cx="32" cy="32" r="30" class="am-face"/>
  <path d="M14 22 L20 8 L30 17 Z" class="am-gold"/><path d="M50 22 L44 8 L34 17 Z" class="am-gold"/>
  <circle cx="23" cy="30" r="3.5" class="am-eye"/><circle cx="41" cy="30" r="3.5" class="am-eye"/>
  <path d="M22 41 Q32 51 42 41" class="am-smile"/></svg>`;

Panels.amigo = async (el) => {
  el.innerHTML = `<section class="am" aria-labelledby="am-t">
    <div class="am-avatar">${AMIGO_MARK}</div>
    <h1 id="am-t">Amigo</h1>
    <p class="am-sub">Your study buddy for Founder's Lab</p>
    <div class="am-input" aria-disabled="true">
      <label class="sr-only" for="am-in">Message Amigo</label>
      <input id="am-in" type="text" placeholder="Ask Amigo anything about the course" disabled aria-describedby="am-note">
      <button type="button" disabled aria-label="Send">${icon("send")}</button>
    </div>
    <p class="am-note" id="am-note">Amigo is coming soon</p>
    <h2 class="am-h">Things you'll be able to ask</h2>
    <ul class="am-chips">${AMIGO_EXAMPLES.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>
  </section>`;
};
