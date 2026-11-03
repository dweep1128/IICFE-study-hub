// Landing page only: once the session is known, every [data-auth] link points at the workspace (same rule as the other pages).
Auth.me().then((user) => {
  if (!user) return;
  const { label, href } = Auth.link(user);
  document.querySelectorAll("[data-auth]").forEach((a) => {
    a.href = href;
    a.querySelector("[data-auth-label]").textContent = label;
  });
});
