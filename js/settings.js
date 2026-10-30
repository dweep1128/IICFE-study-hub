// Settings page (workspace.html#settings): read-only profile, theme choice, sign out. Nothing else on purpose.
const THEME_OPTIONS = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];
const capitalise = (w) => w[0].toUpperCase() + w.slice(1);

function settingsView(user) {
  return `<div class="panel-head"><h1>Settings</h1><p>Your profile and how the Study Hub looks.</p></div>
    <div class="settings">
      <section class="hub-card set-card" aria-labelledby="set-profile">
        <h2 id="set-profile" class="section-title">Profile</h2>
        <div class="set-profile">${avatarHtml(user, "lg")}
          <dl><div><dt>Full name</dt><dd>${esc(user.name)}</dd></div><div><dt>Email</dt><dd>${esc(user.email ?? "")}</dd></div></dl></div>
        <p class="set-note">Contact your institute to change these details.</p>
      </section>

      <section class="hub-card set-card" aria-labelledby="set-look">
        <h2 id="set-look" class="section-title">Appearance</h2>
        <div class="seg" role="radiogroup" aria-labelledby="set-look">${THEME_OPTIONS.map((o) => `
          <button type="button" role="radio" class="seg-opt" data-theme-opt="${o.id}" aria-checked="false" tabindex="-1">
            <span class="swatch swatch-${o.id}" aria-hidden="true"></span>${o.label}</button>`).join("")}</div>
        <p class="set-note" data-sys aria-live="polite"></p>
      </section>

      <section class="hub-card set-card" aria-labelledby="set-account">
        <h2 id="set-account" class="section-title">Account</h2>
        <button class="btn-pill" type="button" data-signout>Sign out</button>
      </section>
    </div>`;
}

// Wires the page; returns a cleanup that unsubscribes from theme changes.
function mountSettings(el) {
  const opts = $$("[data-theme-opt]", el);
  const sys = $("[data-sys]", el);
  const draw = () => {
    const pref = Theme.preference();
    opts.forEach((b) => {
      const on = b.dataset.themeOpt === pref;
      b.setAttribute("aria-checked", on);
      b.tabIndex = on ? 0 : -1;
    });
    const device = capitalise(Theme.systemTheme());
    sys.textContent = pref === "system" ? `Following your device: ${device}` : `System would currently use: ${device}`;
  };
  $(".seg", el).addEventListener("click", (e) => { const b = e.target.closest("[data-theme-opt]"); if (b) Theme.set(b.dataset.themeOpt); });
  $(".seg", el).addEventListener("keydown", (e) => {
    const i = opts.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (i < 0 || step === undefined) return;
    e.preventDefault();
    const next = opts[(i + step + opts.length) % opts.length];
    Theme.set(next.dataset.themeOpt); // radios select as they move
    next.focus();
  });
  $("[data-signout]", el).addEventListener("click", signOut);
  draw();
  return Theme.onChange(draw);
}
