// Competitions: a catalogue the programme team keeps in the LabCompetitions tab (read-only for students, `active` = TRUE publishes a row)
// plus each student's own status and star per competition (LabCompetitionEntries). Pure helpers.
const STATUSES = ["open", "applied", "result", "closed"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

const isTrue = (v) => /^(true|yes|y|1|x)$/i.test(String(v ?? "").trim());
const isoDay = (v) => { const s = String(v ?? "").trim(); return ISO_DAY.test(s) ? s.slice(0, 10) : s; };
// Staff edit this tab by hand, so never hand a javascript: (or other) link to the browser.
const safeHttp = (v) => (/^https?:\/\//i.test(String(v ?? "").trim()) ? String(v).trim() : "");

/**
 * The competitions a student sees: the active catalogue rows with their own entry merged in, soonest deadline first.
 * With no entry yet a competition is "open" until its deadline passes, then "closed".
 */
function listFor(catalog, entries, today) {
  const mine = new Map(entries.map((e) => [e.compId, e]));
  return catalog
    .filter((c) => c.compId && c.name && isTrue(c.active))
    .map((c) => {
      const deadline = isoDay(c.deadline);
      const entry = mine.get(c.compId);
      const hasStatus = STATUSES.includes(String(entry?.status ?? ""));
      return {
        id: c.compId, name: c.name, org: c.org ?? "", about: c.about ?? "", eligibility: c.eligibility ?? "",
        eventDate: isoDay(c.eventDate), deadline, prize: c.prize ?? "", url: safeHttp(c.url),
        status: hasStatus ? entry.status : deadline && deadline < today ? "closed" : "open",
        saved: isTrue(entry?.saved),
      };
    })
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
}

module.exports = { STATUSES, listFor, isTrue };
