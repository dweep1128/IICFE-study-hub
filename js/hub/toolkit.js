// Toolkit: four guidance worksheets (what to include, tips, a worked example) and two "Coming soon" slots, as in the old portal.
// Guidance only: nothing here calls an AI service, so Generate stays off and says why.
const TOOL_KIND_LABEL = { advisory: "Instant answer", builder: "Generates a deliverable" };
const COMING_SOON_SLOTS = 2;
const MAX_TOOL_INPUT = 4000;
const TOOLS = [
  {
    id: "idea-validator", name: "Idea Validator", kind: "advisory",
    tagline: "Painkiller or vitamin? Find out before you build.",
    include: ["Your idea in one line", "Target customer (be specific)", "Their current workaround", "Where you’d find 10 of them"],
    tips: ["Name one person in one situation, not “small businesses”.", "Describe past behaviour, not hypothetical frustration.", "Compliments aren’t validation. Pre-orders and workarounds are."],
    example: "Idea: weekly healthy meal kits for busy parents in Jaipur. Customer: working parents with kids under 10 who currently order Swiggy 4–5 nights/week or skip dinner prep entirely. I can reach them through my mom’s school WhatsApp groups and two apartment society groups.",
  },
  {
    id: "competitor-analysis", name: "Competitor Analysis", kind: "advisory",
    tagline: "Your real rival is what customers do today.",
    include: ["What you’re building", "Who it’s for", "What they do today", "Your hunch on the gap"],
    tips: ["“We have no competition” is almost always wrong. Name the workaround.", "Spreadsheets, interns, and “do nothing” count as competitors.", "One defensible wedge beats a list of vague differentiators."],
    example: "A booking platform for amateur sports grounds (turf cricket, badminton) in tier-2 cities. Customers: weekend players and college teams. Today they book by calling the owner or DMing on Instagram. Discovery and instant confirmation is the gap.",
  },
  {
    id: "deck-builder", name: "Deck Builder", kind: "builder",
    tagline: "A full investor pitch deck, slide by slide.",
    include: ["Problem & solution", "Market & business model", "Traction (any size)", "Team & the ask"],
    tips: ["Give raw facts. Honest small numbers beat invented big ones.", "Lead with the problem and why now, not the product tour.", "Paste notes from your other toolkit results if you have them."],
    example: "Re-Loop: campus marketplace for reselling textbooks and hostel gear. Problem: students lose money on random WhatsApp groups. Solution: verified listings + in-app chat. Model: 5% fee. Traction: 1 campus, ₹60k GMV in 2 months. Team: 3 final-year students. Ask: ₹25L to expand to 10 campuses.",
  },
  {
    id: "financial-model-builder", name: "Financial Model Builder", kind: "builder",
    tagline: "Investor-grade projections you can defend live.",
    include: ["Pricing & revenue model", "Cost to acquire one customer", "Growth rate (monthly)", "Fixed monthly costs"],
    tips: ["Estimates are fine. Label every assumption clearly.", "Unit economics matter more than a giant TAM slide.", "Name the one number the whole model hinges on."],
    example: "SaaS for small gyms in India at ₹1,500/month per gym. CAC ~₹2,000 via Meta ads. Target: 15 new gyms/month. Fixed costs ~₹50,000/month (hosting + part-time dev). Raising ₹40L. Want 12-month projections, break-even, and headline valuation numbers.",
  },
];
const cardNum = (n) => String(n).padStart(2, "0");

function toolkitIndex(el) {
  el.className = "pt-page pt-stagger";
  const kind = (t) => `<span class="pt-tag is-neutral">${esc(TOOL_KIND_LABEL[t.kind].toLowerCase())}</span>`;
  el.innerHTML = `<header class="tk-head"><p class="pt-eyebrow is-gold">The toolkit</p><h1 class="pt-h2">Six guides. One founder’s journey.</h1>
      <p class="tk-sub">Each tool is a worksheet for student founders: what to have ready, rules of thumb, and a worked example.</p></header>
    <ul class="tk-grid">
      ${TOOLS.map((t, i) => `<li><a class="tk-card" href="#toolkit/${t.id}">
        <div class="tk-card-top"><span class="tk-num">[${cardNum(i + 1)}]</span>${kind(t)}</div>
        <h2>${esc(t.name)}</h2><p>${esc(t.tagline)}</p>
        <span class="tk-open">Open tool <span aria-hidden="true">→</span></span></a></li>`).join("")}
      ${Array.from({ length: COMING_SOON_SLOTS }, (_, i) => `<li class="tk-soon"><span class="tk-num">[${cardNum(TOOLS.length + i + 1)}]</span>
        <span class="pt-tag is-neutral">Coming Soon</span></li>`).join("")}
    </ul>`;
}

function toolDetail(el, tool) {
  el.className = "pt-page";
  const num = cardNum(TOOLS.indexOf(tool) + 1);
  el.innerHTML = `<a class="tk-back" href="#toolkit"><span aria-hidden="true">←</span> All tools</a>
    <div class="tk-detail-head"><div class="tk-badges"><span class="tk-num is-gold">[${num}]</span><span class="pt-tag is-neutral">${esc(TOOL_KIND_LABEL[tool.kind].toLowerCase())}</span></div>
      <h1 class="tk-title">${esc(tool.name)}</h1><p class="tk-sub">${esc(tool.tagline)}</p></div>
    <div class="tk-detail">
      <aside>
        <p class="pt-eyebrow">What to include</p>
        <ul class="tk-chips">${tool.include.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        <p class="pt-eyebrow">Tips</p>
        <ul class="tk-tips">${tool.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      </aside>
      <div>
        <div class="tk-box">
          <div class="tk-box-top"><label class="pt-eyebrow" for="tool-input">Your details</label><button type="button" class="tk-example" data-example>Try an example ↻</button></div>
          <textarea id="tool-input" rows="7" maxlength="${MAX_TOOL_INPUT}" placeholder="Describe your idea, audience, and anything specific…"></textarea>
          <div class="tk-box-foot"><span class="tk-count" data-count>0/${MAX_TOOL_INPUT}</span>
            <button type="button" class="tk-generate" disabled aria-describedby="generate-note">Generate <span aria-hidden="true">→</span></button></div>
        </div>
        <p id="generate-note" class="tk-note">Automatic generation is not switched on for this dashboard yet. Use the example and the tips as a worksheet.</p>
      </div>
    </div>`;
  const input = $("#tool-input", el);
  const count = $("[data-count]", el);
  const sync = () => { count.textContent = `${input.value.length}/${MAX_TOOL_INPUT}`; };
  input.addEventListener("input", sync);
  $("[data-example]", el).addEventListener("click", () => { input.value = tool.example; sync(); input.focus(); });
}

Panels.toolkit = async (el) => {
  const id = hashParts()[1];
  if (!id) return toolkitIndex(el);
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) return notAvailableYet(el);
  toolDetail(el, tool);
};
