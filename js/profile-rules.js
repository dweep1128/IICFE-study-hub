// The startup profile's shape, limits, validation and completion score. ONE copy, loaded by the browser (the form's live meter and inline
// errors) and required by the server (server/lab.js), so the two can never disagree. Completion is always computed from the fields.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ProfileRules = factory();
})(this, function () {
  const STAGES = ["idea", "prototype", "mvp", "launched"];
  const STAGE_LABELS = { idea: "Idea", prototype: "Prototype", mvp: "MVP", launched: "Launched" };
  const LIMITS = { startupName: 60, short: 120, oneLineIdea: 140, problemStatement: 600, description: 2000, website: 300, teamSize: 12 };
  const FIELDS = ["startupName", "oneLineIdea", "problemStatement", "description", "stage", "yourName", "yourRole", "website"];
  const EMPTY_MEMBER = { name: "", role: "", contact: "" };

  const filled = (v) => String(v ?? "").trim().length > 0;
  const hasTeam = (p) => p.team.some((m) => filled(m.name) && filled(m.role));

  // Weights over the REQUIRED parts only (they add up to 100). Optional fields (description, website, contacts) never count.
  const REQUIRED = [
    { key: "startupName", weight: 20, done: (p) => filled(p.startupName) },
    { key: "problemStatement", weight: 20, done: (p) => filled(p.problemStatement) },
    { key: "oneLineIdea", weight: 15, done: (p) => filled(p.oneLineIdea) },
    { key: "team", weight: 15, done: hasTeam },
    { key: "stage", weight: 10, done: (p) => p.stage !== "" },
    { key: "yourName", weight: 10, done: (p) => filled(p.yourName) },
    { key: "yourRole", weight: 10, done: (p) => filled(p.yourRole) },
  ];
  const REQUIRED_KEYS = new Set(REQUIRED.map((r) => r.key));

  /** 0-100. The only place completion is decided. */
  const completion = (p) => (p ? REQUIRED.reduce((sum, r) => sum + (r.done(p) ? r.weight : 0), 0) : 0);

  /** The first-visit gate: both fields must be non-empty once trimmed. How complete the profile is plays no part. */
  const needsOnboarding = (p) => !p || !filled(p.startupName) || !filled(p.oneLineIdea);

  const str = (v) => (typeof v === "string" ? v.trim() : "");

  /** A clean profile from untrusted input (a form or a request body). Never throws. Blank team rows are dropped. */
  function toProfile(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const stage = str(r.stage).toLowerCase();
    const team = Array.isArray(r.team) ? r.team : [];
    return {
      startupName: str(r.startupName), oneLineIdea: str(r.oneLineIdea), problemStatement: str(r.problemStatement), description: str(r.description),
      stage: STAGES.includes(stage) ? stage : "", yourName: str(r.yourName), yourRole: str(r.yourRole), website: str(r.website),
      team: team
        .map((m) => (m && typeof m === "object" ? m : {}))
        .map((m) => ({ name: str(m.name), role: str(m.role), contact: str(m.contact) }))
        .filter((m) => m.name || m.role || m.contact),
    };
  }

  const isHttpUrl = (v) => { try { return ["http:", "https:"].includes(new URL(v).protocol); } catch { return false; } };

  /**
   * Errors that block a save, by field ("team.0.name" for team rows). A missing required field does NOT block: a part-filled profile
   * saves and the meter shows what is left. `rawStage` is what the form sent, so an unknown stage can be told apart from none.
   */
  function validate(p, rawStage = p.stage) {
    const e = {};
    const max = (key, limit) => { if (p[key].length > limit) e[key] = `Keep this under ${limit} characters.`; };
    max("startupName", LIMITS.startupName);
    max("oneLineIdea", LIMITS.oneLineIdea);
    max("problemStatement", LIMITS.problemStatement);
    max("description", LIMITS.description);
    max("yourName", LIMITS.short);
    max("yourRole", LIMITS.short);
    if (rawStage && !p.stage) e.stage = "Pick a stage from the list.";
    if (p.website && !isHttpUrl(p.website)) e.website = "Use a full link starting with https://";
    else max("website", LIMITS.website);
    if (p.team.length > LIMITS.teamSize) e.team = `Up to ${LIMITS.teamSize} team members.`;
    p.team.forEach((m, i) => {
      if (!m.name && !m.role && !m.contact) return; // the form's blank row is dropped on save, not an error
      if (!m.name) e[`team.${i}.name`] = "Add a name, or remove this row.";
      for (const k of ["name", "role", "contact"]) if (m[k].length > LIMITS.short) e[`team.${i}.${k}`] = `Keep this under ${LIMITS.short} characters.`;
    });
    return e;
  }

  return { STAGES, STAGE_LABELS, LIMITS, FIELDS, EMPTY_MEMBER, REQUIRED_KEYS, completion, needsOnboarding, toProfile, validate };
});
