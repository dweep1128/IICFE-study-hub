// Handing in a deliverable (journey proof, required document, session upload slot): the control and the way a submission is shown.
//
// The UI talks only to `SubmissionStorage`. Today a submission is a pasted https link that the server stores in the Sheet (server/submissions.js).
// To store real files later (for example in Google Drive), replace SubmissionStorage (the input, `problem`, `send`) and nothing else changes:
// the component, the status display and every page that uses them stay as they are.
const SubmissionStorage = {
  inputType: "url",
  placeholder: "https://…",
  hint: "Paste a link to your file (a Google Drive or Docs share link works). It must start with https://",
  /** "" when the value looks fine. The server checks it again. */
  problem(value) {
    const v = value.trim();
    if (!v) return "Paste a link to your file.";
    try { if (new URL(v).protocol !== "https:") throw new Error(); } catch { return "Use a full link starting with https://"; }
    return "";
  },
  /** Sends the submission; resolves to the server's answer ({ submission, journey, ... }). */
  send: ({ uploadType, itemId, sessionNo }, value) =>
    api(`/api/courses/${Founders.COURSE_ID}/lab/submissions`, { method: "POST", body: { uploadType, itemId, ...(sessionNo != null && { sessionNo }), url: value.trim() } }),
};

const SUBMISSION_PILL = { submitted: ["is-active", "Submitted"], approved: ["is-ok", "Approved"], changes_requested: ["is-err", "Changes requested"] };
const when = (iso) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

/** Status pill, then the file's name and time, and the reviewer's note when changes were requested. `sub` is a submission view or null. */
function submissionStatusHtml(sub) {
  if (!sub) return '<span class="pt-tag is-neutral">Not started</span>';
  const [cls, label] = SUBMISSION_PILL[sub.status] ?? SUBMISSION_PILL.submitted;
  return `<div class="sub-status"><div class="sub-top"><span class="pt-tag ${cls}">${label}</span>${sub.version > 1 ? `<span class="sub-v">v${sub.version}</span>` : ""}</div>
    <p class="sub-file"><a href="${esc(sub.url)}" target="_blank" rel="noopener noreferrer">${esc(sub.fileName)}</a> · ${esc(when(sub.submittedAt))}</p>
    ${sub.status === "changes_requested" && sub.reviewNote ? `<p class="sub-note"><b>Reviewer note: </b>${esc(sub.reviewNote)}</p>` : ""}</div>`;
}

let uploaderSeq = 0;
/**
 * Mounts the control into `host`. ids: { uploadType, itemId, sessionNo? }; label names the item for screen readers; cta is the button text;
 * ghost makes it a quiet button; onSubmitted(answer) runs after the server accepted it. Returns { destroy }.
 */
function mountUploader(host, { uploadType, itemId, sessionNo, label, cta, ghost = false, onSubmitted }) {
  const id = `up-${++uploaderSeq}`;
  host.innerHTML = `<div class="up"><label class="sr-only" for="${id}">Link for ${esc(label)}</label>
    <div class="up-row"><input class="pt-field" id="${id}" type="${SubmissionStorage.inputType}" inputmode="url" autocomplete="off" spellcheck="false" placeholder="${esc(SubmissionStorage.placeholder)}" aria-describedby="${id}-m">
      <button type="button" class="${ghost ? "pt-ghost" : "btn-pill solid"}">${esc(cta)}</button></div>
    <p class="up-hint">${esc(SubmissionStorage.hint)}</p><p class="up-msg" id="${id}-m" aria-live="polite"></p></div>`;
  const input = $("input", host);
  const button = $("button", host);
  const msg = $(".up-msg", host);
  let busy = false;
  let alive = true;
  const say = (text, kind = "") => { msg.textContent = text; msg.className = `up-msg ${kind}`; msg.setAttribute("role", kind === "bad" ? "alert" : "status"); };

  async function submit() {
    if (busy) return;
    const problem = SubmissionStorage.problem(input.value);
    if (problem) { input.setAttribute("aria-invalid", "true"); return say(problem, "bad"); }
    input.removeAttribute("aria-invalid");
    busy = true; button.disabled = true; input.disabled = true; button.textContent = "Saving…"; say("");
    try {
      const answer = await SubmissionStorage.send({ uploadType, itemId, sessionNo }, input.value);
      if (!alive) return;
      input.value = "";
      say("Submitted.", "ok");
      onSubmitted?.(answer);
    } catch (e) {
      if (alive) say(e.message || "Couldn't submit. Please try again.", "bad");
    } finally {
      if (alive) { busy = false; button.disabled = false; input.disabled = false; button.textContent = cta; }
    }
  }
  button.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
  return { destroy() { alive = false; } };
}
