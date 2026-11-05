// Pieces shared by the Sessions list (course.html) and the session page (session.html): the video player and the per-session state.
const sessionsApi = (path = "") => `/api/courses/${Founders.COURSE_ID}/lab/sessions${path}`;
const noop = { destroy() {} };

// ---------- the video lecture ----------
// The server sends either { provider: "file", src } (a Drive lecture streamed by our own signed-in API: no Drive link or id reaches the page)
// or an embed address for YouTube or Vimeo (server/sessions.js), never autoplaying. Without a video: a calm placeholder.
const PLAY = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>';
// ---------- the session thumbnail: a 16:9 card drawn in SVG from the home palette, reused on the Sessions list ----------
// One illustration per topic theme. Every colour is a CSS class (portal.css), so light and dark themes both follow tokens.css.
const THUMB_ART = {
  // a tangled problem turns into a lit bulb
  ideas: `<circle class="vt-blob" cx="508" cy="170" r="104"/>
    <path class="vt-line vt-soft" d="M318 236l14-28 10 22 12-30 8 26 14-24 6 20 12-14"/>
    <path class="vt-line vt-gold vt-dash" d="M392 200c22-12 40-18 62-20"/><path class="vt-line vt-gold" d="M446 170l12 10-14 8"/>
    <circle class="vt-line vt-fill" cx="508" cy="154" r="50"/>
    <path class="vt-line vt-gold" d="M498 196v-20m20 20v-20m-20 0c-2-14 22-14 20 0"/>
    <rect class="vt-fill-sage" x="486" y="202" width="44" height="16" rx="5"/><rect class="vt-fill-sage" x="492" y="222" width="32" height="12" rx="5"/>
    <path class="vt-line vt-gold" d="M508 86V68M556 104l12-12M460 104l-12-12M576 154h18M440 154h-18"/>`,
  // a sketch, a pencil and a set square
  design: `<circle class="vt-blob" cx="500" cy="170" r="104"/>
    <rect class="vt-line vt-dash" x="420" y="104" width="150" height="110" rx="10"/>
    <path class="vt-line vt-gold" d="M440 236l60-60 60 60Z"/>
    <path class="vt-line vt-fill" d="M548 92l22 22-74 74-28 6 6-28Z"/><path class="vt-line vt-soft" d="M536 104l22 22"/>`,
  // a speech bubble with rising bars
  pitch: `<circle class="vt-blob" cx="504" cy="170" r="104"/>
    <path class="vt-line vt-fill" d="M420 100h170a14 14 0 0 1 14 14v96a14 14 0 0 1-14 14h-110l-34 28v-28h-26a14 14 0 0 1-14-14v-96a14 14 0 0 1 14-14Z"/>
    <rect class="vt-fill-sage" x="452" y="168" width="24" height="36" rx="4"/><rect class="vt-fill-teal" x="492" y="146" width="24" height="58" rx="4"/><rect class="vt-fill-gold" x="532" y="124" width="24" height="80" rx="4"/>`,
  // steps up to a flag: the default for any other topic
  default: `<circle class="vt-blob" cx="500" cy="170" r="104"/>
    <path class="vt-line" d="M410 250h50v-40h50v-40h50v-40"/>
    <path class="vt-line vt-gold" d="M560 130V70"/><path class="vt-fill-gold" d="M560 70l40 14-40 14Z"/>
    <circle class="vt-fill-sage" cx="436" cy="234" r="8"/>`,
};
// A session's theme: the one named in its content, else a guess from its title.
const thumbTheme = (title, theme) => (THUMB_ART[theme] ? theme
  : /idea|problem|ideation/i.test(title) ? "ideas" : /design|prototype|build/i.test(title) ? "design" : /pitch|present|demo|story/i.test(title) ? "pitch" : "default");
// Title on up to three lines of ~15 characters, so it never runs under the illustration.
function thumbLines(title, max = 15) {
  const lines = [];
  for (const w of String(title).split(/\s+/)) {
    const last = lines.at(-1);
    if (last && `${last} ${w}`.length <= max) lines[lines.length - 1] = `${last} ${w}`; else lines.push(w);
  }
  return lines.slice(0, 3);
}
/** The thumbnail: { no, title, theme, hasVideo, compact }. Decorative SVG + a play badge; "Coming soon" until a video exists. */
function videoThumbHtml({ no, title, theme, hasVideo = false, compact = false }) {
  const lines = thumbLines(title);
  const step = 46, base = 300 - (lines.length - 1) * step; // the title sits bottom-left, clear of the centred play button
  return `<div class="vt${compact ? " is-compact" : ""}" role="img" aria-label="${esc(`Session ${no}: ${title}${hasVideo ? "" : ". Video lecture coming soon"}`)}">
    <svg viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect class="vt-bg" width="640" height="360"/>
      <path class="vt-wave" d="M0 312c120-34 230 30 360-4s200-40 280-14v66H0Z"/>
      ${THUMB_ART[thumbTheme(title, theme)]}
      <rect class="vt-badge" x="40" y="44" width="136" height="32" rx="16"/>
      <text class="vt-badge-t" x="108" y="65" text-anchor="middle">SESSION ${String(no).padStart(2, "0")}</text>
      ${lines.map((l, i) => `<text class="vt-title" x="40" y="${base + i * step}">${esc(l)}</text>`).join("")}
    </svg>
    <span class="vt-play" aria-hidden="true">${PLAY}</span>${hasVideo ? "" : '<span class="vt-soon">Coming soon</span>'}</div>`;
}
// The player: the real video when the session has one, else the thumbnail, in the same 16:9 frame (no layout change either way).
// The frame shimmers (is-loading) until the first frame or the embed has loaded; see the listener below.
function playerHtml(video, { no, title, theme }) {
  const label = esc(video?.title || `Video lecture: ${title}`);
  if (video?.provider === "file") {
    return `<div class="sd-frame is-loading"><video src="${esc(video.src)}" controls playsinline preload="metadata" aria-label="${label}"
      controlslist="nodownload noremoteplayback" disablepictureinpicture disableremoteplayback></video></div>`;
  }
  if (video) {
    return `<div class="sd-frame is-loading"><iframe src="${esc(video.embedUrl)}" title="${label}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"
      allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div>`;
  }
  return `<div class="sd-frame is-thumb">${videoThumbHtml({ no, title, theme })}</div>`;
}
// Media and iframe load events don't bubble, so one capturing listener ends the loading state for every player on the page.
// "suspend" covers iOS Safari, which fetches nothing until the student taps play.
for (const type of ["loadedmetadata", "loadeddata", "suspend", "load", "error"]) {
  document.addEventListener(type, (e) => { if (e.target instanceof Element && e.target.matches(".sd-frame > video, .sd-frame > iframe")) e.target.parentElement.classList.remove("is-loading"); }, true);
}
// No "Save video as..." menu on the lecture (download and picture-in-picture are also off on the element itself).
document.addEventListener("contextmenu", (e) => { if (e.target instanceof Element && e.target.closest(".sd-frame > video")) e.preventDefault(); });
// "Mark video as watched": a toggle saved on the server with the rest of the lab progress. Progress only; it is not part of the Final Exam gate.
function mountVideoControl(host, st) {
  if (!st.video) { host.innerHTML = ""; return noop; }
  host.innerHTML = '<button type="button" class="sd-watch" aria-pressed="false"><span class="sd-watch-box" aria-hidden="true"></span><span data-t></span></button><span class="ss-err" role="alert" data-err></span>';
  const btn = $(".sd-watch", host), err = $("[data-err]", host);
  const draw = () => { btn.setAttribute("aria-pressed", String(st.videoWatched === true)); $("[data-t]", btn).textContent = st.videoWatched ? "Watched" : "Mark video as watched"; };
  draw();
  btn.addEventListener("click", async () => {
    const next = !st.videoWatched;
    btn.disabled = true; err.textContent = "";
    st.videoWatched = next; draw(); // shown at once; put back if the server refuses
    try { await api(sessionsApi(`/${st.no}/video`), { method: "POST", body: { watched: next } }); await st.reload().catch(() => {}); }
    catch (ex) { st.videoWatched = !next; err.textContent = ex.message || "Could not save. Try again."; }
    btn.disabled = false; draw(); st.changed();
  });
  const unwatch = st.watch(draw);
  return { destroy: unwatch };
}

// ---------- state shared by one open session ----------
// The server is the source of truth: after a tick, an upload or a quiz the steps are re-read from it.
function makeSessionState(detail) {
  const watchers = new Set();
  const state = {
    ...detail,
    watch: (fn) => { watchers.add(fn); return () => watchers.delete(fn); },
    changed: () => watchers.forEach((fn) => fn()),
    // The parts of a session's detail that change as the student works (a fresh copy from the server).
    apply(fresh) {
      Object.assign(state, { steps: fresh.steps, ticked: fresh.ticked, submissions: fresh.submissions, quizResult: fresh.quizResult, videoWatched: fresh.videoWatched });
      state.changed();
    },
    async reload() { state.apply(await api(sessionsApi(`/${detail.no}`))); },
  };
  return state;
}

