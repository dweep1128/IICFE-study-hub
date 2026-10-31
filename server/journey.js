// The Founder's Lab journey: 7 stages of deliverables (definition in founders-lab-journey.json) and the rules that derive each stage's
// status from what a student has ticked. Pure functions only (no Sheets, no Express), so the rules are easy to test and live in ONE place:
// the browser never recomputes a stage, it draws what the API returns.
const definition = require("./founders-lab-journey.json");

const STAGES = definition.stages;
const ALL_ITEMS = new Map(STAGES.flatMap((s) => s.deliverables.map((d) => [d.id, { ...d, stageId: s.id }])));
const RECENT_ACTIVITY_LIMIT = 6;

/**
 * Derives done / current / locked from the ticks. Only REQUIRED items decide a stage. The first stage with open required items is
 * current; every stage after it is locked, even if its own items are all ticked (the journey is sequential).
 * `checked`: itemId -> boolean.
 */
function stagesWithStatus(checked) {
  let currentAssigned = false;
  return STAGES.map((stage) => {
    const required = stage.deliverables.filter((d) => d.required);
    const doneCount = required.filter((d) => checked[d.id]).length;
    const isDone = required.length > 0 && doneCount === required.length;
    let status;
    if (currentAssigned) status = "locked";
    else if (isDone) status = "done";
    else { status = "current"; currentAssigned = true; }
    return { ...stage, status, completion: { doneCount, totalCount: required.length } };
  });
}

/**
 * Everything the Overview, My Journey and the sidebar widget draw.
 * `rows`: this student's checklist rows ({ itemId, checked, answer, checkedDate });
 * `proofs`: itemId -> the latest submission view for each upload item (see submissions.js).
 * An upload item is done when it has a submission that a reviewer has not sent back (a link counts as soon as it is submitted);
 * a tick written into the sheet by hand never counts.
 */
function buildJourney(rows, proofs = {}) {
  const checked = {};
  const answers = {};
  const dates = {};
  for (const r of rows) {
    if (r.itemId in checked || !ALL_ITEMS.has(r.itemId)) continue; // the first row for an item wins
    checked[r.itemId] = /^(true|yes|y|1)$/i.test(String(r.checked).trim());
    if (r.answer) answers[r.itemId] = r.answer;
    if (r.checkedDate) dates[r.itemId] = r.checkedDate;
  }
  for (const [id, item] of ALL_ITEMS) if (item.kind === "upload") checked[id] = !!proofs[id] && proofs[id].status !== "changes_requested";

  const stages = stagesWithStatus(checked);
  const doneStages = stages.filter((s) => s.status === "done").length;
  const current = stages.find((s) => s.status === "current") ?? stages[stages.length - 1];
  const open = current.deliverables.find((d) => d.required && !checked[d.id]);
  const activity = Object.entries(checked)
    .filter(([id, on]) => on && dates[id] && ALL_ITEMS.get(id).kind !== "upload")
    .map(([id]) => ({ id, title: `Completed: ${ALL_ITEMS.get(id).label}`, date: dates[id] }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, RECENT_ACTIVITY_LIMIT);

  return {
    stages: stages.map((s) => ({
      id: s.id, n: s.n, label: s.label, status: s.status, completion: s.completion,
      deliverables: s.deliverables.map((d) => ({ ...d, checked: !!checked[d.id], answer: answers[d.id] ?? "", ...(d.kind === "upload" && { proof: proofs[d.id] ?? null }) })),
    })),
    doneStages,
    totalStages: stages.length,
    percent: Math.round((doneStages / stages.length) * 100),
    currentId: current.id,
    nextAction: open ? { id: open.id, label: open.label, hint: open.hint, stageLabel: current.label } : null,
    activity,
    revenueTarget: definition.revenueTarget,
  };
}

module.exports = { STAGES, ALL_ITEMS, stagesWithStatus, buildJourney };
