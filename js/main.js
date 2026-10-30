// ===== HOME PAGE CONTENT: swap in real data here =====
// {{teal}} and [[gold]] mark colored words in the headline; \n is a forced line break.
// Nav and brand live in js/data.js.
const SITE = {
  hero: {
    pill: "Study Hub",
    org: "IICFE Singapore",
    title: "Your pathway to\n[[global]]\n[[designations]]\nstarts here",
    primary: { label: "Explore Courses", href: "courses.html", icon: "globe" },
  },
  stats: [
    { label: "6+ Modules", icon: "layers" },
    { label: "Global", icon: "globe" },
    { label: "Expert Faculty", icon: "cap" },
    { label: "Career-Ready", icon: "case" },
  ],
  courses: {
    title: "Pick your [[course]]",
    items: [
      { name: "Financial Reporting", code: "FR", desc: "Master standards, consolidations and interpretation.", href: "courses.html" },
      { name: "Audit & Assurance", code: "AA", desc: "Understand risk, evidence and audit reporting.", href: "courses.html" },
      { name: "Performance Management", code: "PM", desc: "Costing, budgeting and better business decisions.", href: "courses.html" },
      { name: "Financial Management", code: "FM", desc: "Investment appraisal, finance and risk management.", href: "courses.html" },
    ],
    all: { label: "View all courses", href: "courses.html" },
  },
  faq: {
    title: "FAQs",
    lede: "Quick answers before you start.",
    items: [
      { q: "Who is the Study Hub for?", a: "ACCA students preparing for F1, F2 and F3, and anyone considering the ACCA path." },
      { q: "Do I need an account?", a: "You can browse for free. Sign in to open your workspace and track your progress." },
      { q: "Can I study on my phone?", a: "Yes. The Study Hub works on phones, tablets and laptops." },
      { q: "How do I get help?", a: "Use the Contact page and our team will get back to you." },
    ],
  },
};
// =====================================================

const ICONS = {
  book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H20v14H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  cap: '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/>',
  case: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

function renderPage() {
  const { hero, stats, courses, faq } = SITE;
  $("[data-hero-pill]").textContent = hero.pill;
  $("[data-hero-org]").textContent = hero.org;
  $("[data-hero-title]").innerHTML = rich(hero.title);
  $("[data-hero-ctas]").innerHTML =
    `<a class="btn btn-gold btn-lg" href="${esc(hero.primary.href)}"><span class="btn-ic">${icon(hero.primary.icon)}</span>${esc(hero.primary.label)} ${ARROW}</a>`;
  $("[data-stats]").innerHTML = stats.map((s) => `<li>${icon(s.icon)}<span>${esc(s.label)}</span></li>`).join("");

  $("[data-courses-title]").innerHTML = rich(courses.title);
  $("[data-courses]").innerHTML = courses.items.map((c) => courseCard(c)).join("");
  const all = $("[data-all-courses]");
  all.href = courses.all.href;
  all.innerHTML = `${esc(courses.all.label)} ${ARROW}`;

  // the heading is uppercased by CSS: keep a trailing lowercase "s" lowercase so it reads "FAQs"
  $("[data-faq-title]").innerHTML = esc(faq.title).replace(/s$/, '<span class="lc">s</span>');
  $("[data-faq-lede]").textContent = faq.lede;
  // Real buttons (aria-expanded/aria-controls); the first row starts open.
  $("[data-faq]").innerHTML = faq.items.map((f, i) => `
    <div class="faq-item"${i === 0 ? " data-open" : ""}>
      <h3><button class="faq-q" type="button" id="faq-q-${i}" aria-expanded="${i === 0}" aria-controls="faq-a-${i}"><span>${esc(f.q)}</span><span class="faq-ic" aria-hidden="true"></span></button></h3>
      <div class="faq-a" id="faq-a-${i}" role="region" aria-labelledby="faq-q-${i}"><div><p>${esc(f.a)}</p></div></div>
    </div>`).join("");
}

// One row open at a time; the height animation is CSS (grid-template-rows), see .faq-item in home.css.
function setupFaq() {
  const list = $("[data-faq]");
  list.addEventListener("click", (e) => {
    const btn = e.target.closest(".faq-q");
    if (!btn) return;
    const item = btn.closest(".faq-item");
    const open = !item.hasAttribute("data-open");
    $$(".faq-item", list).forEach((it) => {
      const on = it === item && open;
      it.toggleAttribute("data-open", on);
      $(".faq-q", it).setAttribute("aria-expanded", on);
    });
  });
}

// A broken hero image would show alt text over the teal fallback; drop it instead.
function setupHeroFallback() {
  const img = $(".home-hero-img");
  const drop = () => img.parentElement.remove();
  img.addEventListener("error", drop);
  if (img.complete && !img.naturalWidth) drop();
}

renderPage();
setupHeroFallback();
setupFaq();
applyAuthLinks();
setupReveal();
