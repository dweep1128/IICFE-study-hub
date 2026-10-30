const form = $("[data-signin-form]");
const emailInput = $("#email");
const passwordInput = $("#password");
const errorEl = $("[data-error]");
const submitBtn = $("button[type=submit]", form);

// Already signed in? Skip the form.
Auth.me().then((user) => { if (user) location.replace("workspace.html"); });

const SUBMIT_LABEL = submitBtn.textContent;
$("[data-help-link]").href = DATA.site.nav.find((l) => l.label === "Contact").href;

// Show / Hide password
const pwToggle = $(".pw-toggle");
pwToggle.addEventListener("click", () => {
  const show = passwordInput.type === "password";
  passwordInput.type = show ? "text" : "password";
  pwToggle.textContent = show ? "Hide" : "Show";
  pwToggle.setAttribute("aria-pressed", show);
});

const fail = (msg, field) => { errorEl.textContent = msg; field.focus(); };

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email) return fail("Please enter your email.", emailInput);
  if (!password) return fail("Please enter your password.", passwordInput);

  submitBtn.disabled = true; // prevents double submits (and burning the rate limit)
  submitBtn.textContent = "Signing in…";
  const result = await Auth.login(email, password);
  if (result.ok) return location.assign("workspace.html");
  submitBtn.disabled = false;
  submitBtn.textContent = SUBMIT_LABEL;
  passwordInput.value = "";
  fail(result.error, passwordInput);
});
