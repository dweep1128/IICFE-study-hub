// Shared across every page: helpers, header/footer, menu, scroll reveal.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Escapes first, then turns [[x]] into gold spans, {{x}} into teal spans and \n into <br>.
const rich = (s) => esc(s).replace(/\[\[(.+?)\]\]/g, '<span class="gold">$1</span>').replace(/\{\{(.+?)\}\}/g, '<span class="teal">$1</span>').replace(/\n/g, "<br>");
const ARROW = '<span class="arrow" aria-hidden="true">→</span>';
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Strip ".html" so it also matches hosts that serve clean URLs (e.g. /courses).
const pageName = (p) => (p.split("/").pop() || "index").replace(/\.html$/, "");
const isCurrent = (href) => !href.includes("#") && pageName(href) === pageName(location.pathname);

// Icon tile + title + one line. Pass an inline SVG as `iconSvg` to override the default inbox icon.
const INBOX_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13 6 5h12l2 8"/><path d="M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5h-5l-1.5 2h-3L9 13Z"/></svg>';
const emptyState = (title, text = "", iconSvg = INBOX_ICON) =>
  `<div class="box empty"><div class="empty-ic">${iconSvg}</div><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}</div>`;

const courseCard = (c, cta = "View course") => `
  <article class="card fade">
    <span class="code">${esc(c.code)}</span>
    <h3>${esc(c.name)}</h3>
    <p>${esc(c.desc)}</p>
    <a class="link" href="${esc(c.href)}" aria-label="${esc(cta)}: ${esc(c.name)}">${esc(cta)} ${ARROW}</a>
  </article>`;

function renderBrand() {
  const { logo, name, sub } = DATA.site.brand;
  $$("[data-brand]").forEach((el) => {
    el.innerHTML = `<span class="brand-text">${esc(name)}<small>${esc(sub)}</small></span>`;
    const img = new Image();
    img.alt = ""; // decorative: the wordmark beside it carries the name
    img.onload = () => el.prepend(img); // wordmark stays; the logo joins it only once it has actually loaded
    img.src = logo;
  });
}

function renderChrome() {
  const { nav, footer, cta } = DATA.site;
  // Signed-out defaults; applyAuthLinks() swaps them once /api/me answers.
  const auth = Auth.link(null);

  const header = $("[data-site-header]");
  if (header) {
    header.innerHTML = `
      <div class="container header-row">
        <a class="brand" href="index.html" aria-label="IICFE Singapore home" data-brand></a>
        <button class="nav-toggle" aria-expanded="false" aria-controls="nav" aria-label="Toggle menu"><span></span><span></span><span></span></button>
        <nav id="nav" class="nav" aria-label="Primary">
          <div class="nav-links">${nav.map((l) => `<a href="${esc(l.href)}"${isCurrent(l.href) ? ' aria-current="page"' : ""}>${esc(l.label)}</a>`).join("")}</div>
          <div class="nav-actions">
            <a class="btn btn-outline btn-sm" href="${esc(auth.href)}"${isCurrent(auth.href) ? ' aria-current="page"' : ""} data-auth><span data-auth-label>${esc(auth.label)}</span></a>
            ${header.hasAttribute("data-cta") ? `<a class="btn btn-gold btn-sm" href="${esc(cta.href)}">${esc(cta.label)} ${ARROW}</a>` : ""}
          </div>
        </nav>
      </div>`;
    setupMenu();
  }

  const foot = $("[data-site-footer]");
  if (foot) {
    foot.innerHTML = `
      <div class="container footer-row">
        <div>
          <a class="brand" href="index.html" aria-label="IICFE Singapore home" data-brand></a>
          <p class="blurb">${esc(footer.blurb)}</p>
          <p class="blurb"><a href="mailto:${esc(footer.email)}">${esc(footer.email)}</a></p>
        </div>
        <nav aria-label="Footer">
          ${footer.links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join("")}
          <a href="${esc(auth.href)}" data-auth><span data-auth-label>${esc(auth.label)}</span></a>
        </nav>
      </div>
      <div class="container copyright">${esc(footer.copyright)}</div>`;
  }
  renderBrand();
}

// Updates every [data-auth] link (header, hero, footer) to Sign In / My Workspace.
function applyAuthLinks() {
  Auth.me().then((user) => {
    const { label, href } = Auth.link(user);
    $$("[data-auth]").forEach((a) => { a.href = href; $("[data-auth-label]", a).textContent = label; });
  });
}

function setupMenu() {
  const btn = $(".nav-toggle");
  const nav = $("#nav");
  const set = (open) => { nav.classList.toggle("open", open); btn.setAttribute("aria-expanded", open); };
  btn.addEventListener("click", () => set(!nav.classList.contains("open")));
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") set(false); });
}

// Call after the page has rendered its .fade elements. onShow(el) runs once per revealed element.
function setupReveal(onShow) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add("in");
      onShow?.(e.target);
      io.unobserve(e.target);
    });
  }, { threshold: 0.15 });
  $$(".fade").forEach((el) => io.observe(el));
}

renderChrome();
applyAuthLinks();
