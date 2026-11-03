// Pieces shared by the Sessions list (course.html) and the session page (session.html): the video player and the per-session state.
const sessionsApi = (path = "") => `/api/courses/${Founders.COURSE_ID}/lab/sessions${path}`;
const noop = { destroy() {} };

// ---------- the video lecture ----------
// The server sends an embed address only for YouTube, Vimeo or Google Drive links (server/sessions.js), with no autoplay. Without one: a calm placeholder.
const PLAY = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>';
function playerHtml(video, title) {
  if (video) {
    return `<div class="sd-frame"><iframe src="${esc(video.embedUrl)}" title="${esc(video.title || `Video lecture: ${title}`)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"
      allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
  }
  return `<div class="sd-frame is-empty" role="img" aria-label="Video lecture coming soon"><div class="sd-ph"><span class="sd-ph-ic">${PLAY}</span>
    <p class="sd-ph-t">Video lecture coming soon</p><p class="sd-ph-s">${esc(title)}</p></div></div>`;
}
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
    async reload() {
      const fresh = await api(sessionsApi(`/${detail.no}`));
      Object.assign(state, { steps: fresh.steps, ticked: fresh.ticked, submissions: fresh.submissions, quizResult: fresh.quizResult, videoWatched: fresh.videoWatched });
      state.changed();
    },
  };
  return state;
}

