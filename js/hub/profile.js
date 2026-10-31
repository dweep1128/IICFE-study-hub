// Profile (#profile): the startup profile with its completion meter. Every field is optional to save; nothing else in the portal depends on it.
// The rules (limits, which fields are required, how the meter is scored) are js/profile-rules.js, the same file the server checks against.
const PR = ProfileRules;
const PF_FIELD_IDS = { startupName: "pf-startupName", oneLineIdea: "pf-oneLineIdea", problemStatement: "pf-problemStatement", description: "pf-description", stage: "pf-stage", website: "pf-website", yourName: "pf-yourName", yourRole: "pf-yourRole", team: "pf-team-add" };
const profileApi = (path) => `/api/courses/${Founders.COURSE_ID}/lab/${path}`;
const pfId = (key) => PF_FIELD_IDS[key] ?? `pf-${key.replace(/\./g, "-")}`; // "team.0.name" -> "pf-team-0-name"

// ---------- the Profile page ----------
// The form as it is on screen: trimmed fields, team rows kept 1:1 with the form's rows so error keys line up.
function pfCleaned(draft) {
  const trim = (m) => ({ name: m.name.trim(), role: m.role.trim(), contact: m.contact.trim() });
  return { ...PR.toProfile(draft), team: draft.team.map(trim) };
}

Panels.profile = async (el, hub) => {
  if (!hub.manifest) return notAvailableYet(el);
  const stored = (await api(profileApi("profile"))).profile; // null until the first save
  const start = stored ?? PR.toProfile({});
  // The member's own name is the obvious start for "your name" and the founder row.
  const draft = {
    ...start, yourName: start.yourName || hub.user.name,
    team: start.team.length ? start.team.map((m) => ({ ...m })) : [{ ...PR.EMPTY_MEMBER, name: hub.user.name }],
  };
  let saved = stored;
  let showErrors = false;
  let saving = false;

  const req = (key) => (PR.REQUIRED_KEYS.has(key) ? "Required" : "Optional");
  const label = (key, text) => `<label for="${pfId(key)}" class="pf-label">${esc(text)}<span class="pf-tag">${req(key)}</span></label>`;
  const text = (key, { multiline = false, rows = 3, placeholder = "", type = "text", counter = false, auto = "" } = {}) => `<div class="pf-field">
    ${label(key, FIELD_LABELS[key])}
    ${multiline ? `<textarea id="${pfId(key)}" class="pt-field" data-key="${key}" rows="${rows}" placeholder="${esc(placeholder)}" aria-describedby="${pfId(key)}-e"></textarea>`
      : `<input id="${pfId(key)}" class="pt-field" data-key="${key}" type="${type}"${type === "url" ? ' inputmode="url"' : ""} placeholder="${esc(placeholder)}"${auto ? ` autocomplete="${auto}"` : ""} aria-describedby="${pfId(key)}-e">`}
    <div class="pf-meta"><p class="pf-err" id="${pfId(key)}-e" data-err="${key}"></p>${counter ? `<p class="pf-count" data-count="${key}"></p>` : ""}</div></div>`;
  const FIELD_LABELS = { startupName: "Startup name", oneLineIdea: "One-line idea", problemStatement: "Problem statement", description: "Description", website: "Website or link", yourName: "Your name", yourRole: "Your role" };

  el.className = "pt-page pt-stagger";
  el.innerHTML = `<header class="tk-head"><p class="pt-eyebrow is-gold">Profile</p><h1 class="pt-h2">Your startup profile</h1>
      <p class="tk-sub">Tell the team what you are building. Complete every required field to put your startup’s name on your dashboard.</p></header>
    <form class="pf" novalidate>
      <section class="pf-card" aria-labelledby="pf-progress-h"><div class="pf-top"><h2 class="pt-eyebrow" id="pf-progress-h">Profile completion</h2><span class="pf-pct" data-pct></span></div>
        <div class="ss-bar is-lg" role="progressbar" aria-labelledby="pf-progress-h" aria-valuemin="0" aria-valuemax="100"><i data-bar></i></div><p class="pf-hint" data-hint></p></section>

      <section class="pf-card" aria-labelledby="pf-startup-h"><h2 class="pt-eyebrow" id="pf-startup-h">Your startup</h2>
        ${text("startupName", { counter: true })}
        ${text("oneLineIdea", { placeholder: "What you are building, for whom, in one line", counter: true })}
        ${text("problemStatement", { multiline: true, placeholder: "The problem, who has it, and why it matters (a few sentences)", counter: true })}
        ${text("description", { multiline: true, rows: 4, placeholder: "How it works, traction so far, anything else worth knowing", counter: true })}
        <fieldset class="pf-field"><legend class="pf-label">Stage of startup<span class="pf-tag">Required</span></legend>
          <div class="pf-stages">${PR.STAGES.map((s, i) => `<label class="pf-stage"><input type="radio" name="stage" value="${s}"${i === 0 ? ` id="${pfId("stage")}"` : ""}><span>${esc(PR.STAGE_LABELS[s])}</span></label>`).join("")}</div>
          <p class="pf-err" data-err="stage"></p></fieldset>
        ${text("website", { type: "url", placeholder: "https://" })}
      </section>

      <section class="pf-card" aria-labelledby="pf-team-h"><h2 class="pt-eyebrow" id="pf-team-h">You &amp; your team</h2>
        <div class="pf-two">${text("yourName", { auto: "name" })}${text("yourRole", { placeholder: "Founder, CEO, CTO…" })}</div>
        <div class="pf-field"><div class="pf-label">Team members<span class="pf-tag">Required: at least the founder</span></div>
          <ul class="pf-team" data-team></ul><p class="pf-err" data-err="team"></p>
          <button type="button" class="pt-ghost" id="${pfId("team")}" data-add>+ Add team member</button></div>
      </section>

      <div class="pf-bar"><p data-status role="status"></p><p class="pf-err" role="alert" data-form-err></p><button type="submit" class="btn-pill solid" data-save>Save profile</button></div>
    </form>`;

  const form = $(".pf", el);
  const teamList = $("[data-team]", el);
  const drawTeam = () => {
    teamList.innerHTML = draft.team.map((m, i) => `<li class="pf-member"><div class="pf-member-top"><span class="pt-tag is-neutral">${i === 0 ? "Founder" : `Member ${i + 1}`}</span>
        <button type="button" class="pf-remove" data-remove="${i}"${draft.team.length === 1 ? " hidden" : ""}>Remove</button></div>
      <div class="pf-three">${["name", "role", "contact"].map((k) => `<div><label class="sr-only" for="pf-team-${i}-${k}">${esc(`${i === 0 ? "Founder" : `Member ${i + 1}`} ${k === "contact" ? "email or phone (optional)" : k}`)}</label>
        <input id="pf-team-${i}-${k}" class="pt-field" data-member="${i}" data-k="${k}" value="${esc(m[k])}" placeholder="${k === "name" ? "Name" : k === "role" ? "Role" : "Email or phone (optional)"}"><p class="pf-err" data-err="team.${i}.${k}"></p></div>`).join("")}</div></li>`).join("");
    $("[data-add]", el).disabled = draft.team.length >= PR.LIMITS.teamSize;
    paint();
  };

  // Everything that follows the fields (meter, counters, errors, the save bar) is repainted without touching the inputs, so typing never loses focus.
  function paint() {
    const clean = pfCleaned(draft);
    const errors = PR.validate(clean, draft.stage);
    const savedPct = PR.completion(saved), draftPct = PR.completion(clean);
    const dirty = JSON.stringify(PR.toProfile(clean)) !== JSON.stringify(saved ? PR.toProfile(saved) : null);
    $("[data-pct]", el).textContent = `${savedPct}%`;
    $("[data-bar]", el).style.width = `${savedPct}%`;
    $(".ss-bar", el).setAttribute("aria-valuenow", savedPct);
    $("[data-hint]", el).textContent = dirty && draftPct !== savedPct ? `${draftPct}% once you save these changes.` : savedPct === 100 ? "Complete. Your startup now shows in the header." : "Fill every required field to reach 100%.";
    for (const e of $$("[data-err]", el)) { const key = e.dataset.err; const msg = showErrors || key === "oneLineIdea" ? errors[key] ?? "" : ""; e.textContent = msg; const c = document.getElementById(pfId(key)); if (c && c.matches("input,textarea")) c.setAttribute("aria-invalid", String(!!msg)); }
    for (const e of $$("input[data-member]", el)) e.setAttribute("aria-invalid", String(!!(showErrors && errors[`team.${e.dataset.member}.${e.dataset.k}`])));
    for (const c of $$("[data-count]", el)) { const key = c.dataset.count; const n = clean[key].length; c.textContent = `${n}/${PR.LIMITS[key]}`; c.classList.toggle("is-over", n > PR.LIMITS[key]); }
    $("[data-status]", el).textContent = saving ? "Saving…" : !saved ? "Not saved yet." : dirty ? "You have unsaved changes." : "All changes saved.";
    $("[data-save]", el).disabled = saving || !dirty;
    $("[data-save]", el).textContent = saving ? "Saving…" : "Save profile";
    return errors;
  }

  // fill the inputs once
  for (const key of ["startupName", "oneLineIdea", "problemStatement", "description", "website", "yourName", "yourRole"]) $(`[data-key="${key}"]`, el).value = draft[key];
  const radio = $(`input[name="stage"][value="${draft.stage}"]`, el);
  if (radio) radio.checked = true;
  drawTeam();

  form.addEventListener("input", (e) => {
    const k = e.target.dataset.key, m = e.target.dataset.member;
    if (k) draft[k] = e.target.value;
    else if (m != null) draft.team[Number(m)][e.target.dataset.k] = e.target.value;
    paint();
  });
  form.addEventListener("change", (e) => { if (e.target.name === "stage") { draft.stage = e.target.value; paint(); } });
  form.addEventListener("click", (e) => {
    if (e.target.closest("[data-add]")) { draft.team.push({ ...PR.EMPTY_MEMBER }); drawTeam(); $(`#pf-team-${draft.team.length - 1}-name`, el).focus(); }
    const rm = e.target.closest("[data-remove]");
    if (rm && draft.team.length > 1) { draft.team.splice(Number(rm.dataset.remove), 1); drawTeam(); }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (saving) return;
    showErrors = true;
    const errors = paint();
    const formErr = $("[data-form-err]", el);
    const first = Object.keys(errors)[0];
    if (first) { formErr.textContent = "Fix the highlighted fields, then save."; document.getElementById(pfId(first))?.focus(); return; }
    formErr.textContent = "";
    const previous = saved;
    saving = true;
    saved = PR.toProfile(pfCleaned(draft)); // shown as saved at once; put back if the save fails
    paint();
    try {
      const data = await api(profileApi("profile"), { method: "POST", body: saved });
      saved = data.profile;
      toast("Profile saved.");
    } catch (ex) { saved = previous; formErr.textContent = ex.message || "Could not save. Try again."; }
    saving = false;
    paint();
  });
};
