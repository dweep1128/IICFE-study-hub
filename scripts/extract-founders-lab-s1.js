#!/usr/bin/env node
// One-off: turns the partner pages in content/founders-lab/s1/ into content/founders-lab/s1/session.json.
// The four HTML files are only ever READ. Wording is copied, never retyped: text comes out of the HTML (inline <b>/<i> kept),
// and the activity configs are taken from the page's own `window.ACTS`, `WHY`, `HATS` and `SPOTS` literals.
//
// Run:  node scripts/extract-founders-lab-s1.js
// It exits non-zero and lists the problem if a count is off, a schema check fails or any source word did not make it across.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC_DIR = path.join(__dirname, "..", "content", "founders-lab", "s1");
const NOTES_FILE = "FoundersLab_S1_1_Study_Notes.html";
const ACTS_FILE = "FoundersLab_S1_2_Activities.html";
const PRACTICE_FILE = "FoundersLab_S1_3_Practice_Test.html";
const FINAL_FILE = "FoundersLab_S1_4_Real_Test.html"; // file name keeps its old name; the UI calls it the Final Exam
const OUT_FILE = path.join(SRC_DIR, "session.json");
const SCHEMA_VERSION = 1;

// ---- values the brief fixes (not in the source pages) -----------------------------------------------------------------
const CREDIT = "Founders Lab x Maharaja Sawai Bhawani Singh School x IICFE Singapore";
const EXPECTED_XP = { n1: 10, n2: 15, n3: 10, n4: 20, n5: 20, n6: 25, n7: 25, n8: 10, n9: 15 };
// Scoring as coded in the original page's engines (streak counts the current card, so "after 2" is `streak > 2`).
const SCORING = {
  wheel: { ideaPts: 10, reuPts: 5 },
  sorter: { correctPts: 10, streakBonus: 5, streakAfter: 2, fastBonus: 20 },
  speed: { basePts: 10, streakBonus: 5, streakFrom: 3 },
  ladder: { rungPts: 10 },
};
// Shown when a wrong rung option is picked: the original engine falls back to this line (the data has no per-option text).
const WRONG_RUNG_TEXT = "That blames someone or goes off track. Look for the cause.";
const HAT_TONE = { W: "white", R: "red", B: "black", Y: "yellow", G: "green", U: "blue" };
const EXPECT = { sections: 9, doneable: 9, quickchecks: 2, flips: 3, hats: 6, spots: 8, glossary: 8, takeaways: 5,
  games: 4, sorterCards: 12, hatComments: 12, puzzles: 3, wheelItems: 8, practiceQs: 10, finalQs: 10 };
const OPTIONS_PER_QUESTION = 4;
const KEY_SENTENCE = /Finish all four games to unlock[^.]*\.[^.]*\./; // the source's "unlock a key" sentence (dropped on purpose)

const problems = []; // anything we could not parse cleanly: listed, never guessed
const note = (m) => problems.push(m);

// ---- tiny HTML helpers -------------------------------------------------------------------------------------------------
const ENT = { "&middot;": "·", "&times;": "×", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (e) => ENT[e] ?? (note(`unknown entity ${e}`), e));
// Keeps only <b> and <i> (the formatting the source uses) and tidies whitespace.
const rich = (s) => decode(s.replace(/<(?!\/?(?:b|i)>)[^>]*>/g, "")).replace(/\s+/g, " ").trim();
const plain = (s) => rich(s).replace(/<\/?[bi]>/g, "");
const all = (html, re) => [...html.matchAll(re)];
const first = (html, re, what) => {
  const m = html.match(re);
  if (!m) { note(`missing ${what}`); return ""; }
  return m[1];
};
const stripBase64 = (s) => s.replace(/base64,[A-Za-z0-9+/=]{200,}/g, "base64,");

function evalLiterals(html, names) {
  // The pages declare these as plain literals (`var WHY={...};`), so evaluating just those statements in an empty sandbox is safe.
  const out = {};
  for (const name of names) {
    const m = html.match(new RegExp(`(?:var |window\\.)${name}=([\\s\\S]*?);[ \\t]*\\r?\\n`));
    if (!m) { note(`missing literal ${name}`); continue; }
    out[name] = vm.runInNewContext(`(${m[1]})`, Object.create(null));
  }
  return out;
}

// ---- block builders ----------------------------------------------------------------------------------------------------
const paragraphs = (html) => all(html, /<p(?: class="(lead|muted)")?(?: [^>]*)?>([\s\S]*?)<\/p>/g)
  .map((m) => ({ type: "paragraph", style: m[1] ?? "body", html: rich(m[2]) }));
const labelled = (re, html) => all(html, re).map((m) => ({ label: plain(m[1]), title: plain(m[2]), html: rich(m[3]) }));
const callout = (html) => {
  const m = html.match(/<div class="callout"><span class="mono">([\s\S]*?)<\/span>([\s\S]*?)<\/div>/);
  return m ? [{ type: "callout", label: plain(m[1]), html: rich(m[2]) }] : [];
};
const quickchecks = (html) => all(html, /<div class="qc" data-a="(\d+)" data-why="([^"]*)">\s*<div class="q">([\s\S]*?)<\/div>\s*<div class="opts">([\s\S]*?)<\/div>/g)
  .map((m) => ({ type: "quickcheck", question: rich(m[3]), options: all(m[4], /<button>([\s\S]*?)<\/button>/g).map((o) => rich(o[1])),
    correct: Number(m[1]), why: rich(m[2]) }));

const SECTION_PARSERS = {
  n1: (h) => [
    { type: "lead", html: rich(first(h, /<p class="lead">([\s\S]*?)<\/p>/, "n1 lead")) },
    { type: "list", items: all(h, /<li>([\s\S]*?)<\/li>/g).map((m) => rich(m[1])) },
  ],
  n2: (h) => [
    ...paragraphs(first(h, /<div class="stk prose">([\s\S]*?)<\/div>\s*<div class="grid2"/, "n2 intro card")),
    { type: "stories", items: labelled(/<div class="stk (?:pink|lilac) prose"><span class="mono">([\s\S]*?)<\/span><h3[^>]*>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p><\/div>/g, h) },
    ...quickchecks(h),
  ],
  n3: (h) => [
    ...paragraphs(first(h, /<div class="stk sun prose">([\s\S]*?)<\/div>\s*<div class="grid3"/, "n3 intro card")),
    { type: "steps", items: labelled(/<div class="stk prose"><span class="mono">(Step \d)<\/span><h3[^>]*>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p><\/div>/g, h) },
  ],
  n4: (h) => [
    { type: "flips", items: all(h, /<button class="flip"[\s\S]*?<span class="hint">(\w) &middot; tap to flip<\/span><h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p><\/div>\s*<div class="b">([\s\S]*?)<\/div>\s*<\/div><\/button>/g)
      .map((m) => ({ letter: m[1], title: plain(m[2]), front: rich(m[3]),
        back: all(m[4], /<p(?: class="(muted)")?><b>([\s\S]*?):<\/b> ([\s\S]*?)<\/p>/g).map((b) => ({ label: plain(b[2]), muted: b[1] === "muted", html: rich(b[3]) })) })) },
    ...callout(h),
    ...quickchecks(h),
  ],
  n5: (h, lit) => [
    ...paragraphs(first(h, /<div class="stk prose">([\s\S]*?)<\/div>/, "n5 intro card")),
    { type: "whyLadder", start: lit.WHY.start, steps: lit.WHY.steps.map((s) => ({ question: s.q, answer: s.a })), root: lit.WHY.root },
  ],
  n6: (h, lit) => {
    const idea = h.match(/<p class="muted"[^>]*>(Our test idea:) <b>([\s\S]*?)<\/b> ([\s\S]*?)<\/p>/);
    if (!idea) note("n6: test-idea line not found");
    return [
      ...paragraphs(first(h, /<div class="stk prose">([\s\S]*?)<\/div>/, "n6 intro card")),
      { type: "hats", ideaLabel: idea ? plain(idea[1]) : "", idea: idea ? plain(idea[2]) : "",
        items: lit.HATS.map((x) => ({ id: x.c.toLowerCase(), name: x.c, focus: x.k, text: x.t })) },
    ];
  },
  n7: (h, lit) => [
    ...paragraphs(first(h, /<div class="stk sun prose">([\s\S]*?)<\/div>/, "n7 intro card")),
    { type: "spots", items: lit.SPOTS.map((x) => ({ name: x.n, problem: x.p, who: x.w, sparks: x.i })) },
    ...callout(h),
  ],
  n8: (h) => [{ type: "glossary", items: all(first(h, /<div class="gloss">([\s\S]*)$/, "glossary"), /<div><b>([\s\S]*?)<\/b>([\s\S]*?)<\/div>/g)
    .map((m) => ({ term: plain(m[1]), html: rich(m[2]) })) }],
  n9: (h) => [
    { type: "takeaways", items: all(first(h, /<div class="takes">([\s\S]*?)<\/div>\s*<div class="stk pink/, "takeaways"), /<div><p>([\s\S]*?)<\/p><\/div>/g).map((m) => rich(m[1])) },
    ...all(h, /<div class="stk pink prose"[^>]*><span class="mono">([\s\S]*?)<\/span><h3[^>]*>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p><\/div>/g)
      .map((m) => ({ type: "note", label: plain(m[1]), title: plain(m[2]), html: rich(m[3]) })),
  ],
};

// ---- notes + session ---------------------------------------------------------------------------------------------------
function extractNotes(html) {
  const lit = evalLiterals(html, ["WHY", "HATS", "SPOTS"]);
  const sections = all(html, /<section class="sec" id="(n\d)" data-xp="(\d+)">([\s\S]*?)<\/section>/g).map((m) => {
    const [, id, xp, body] = m;
    const tag = plain(first(body, /<span class="tag">([\s\S]*?)<\/span>/, `${id} tag`));
    const title = plain(first(body, /<h2>([\s\S]*?)<\/h2>/, `${id} title`));
    const parse = SECTION_PARSERS[id];
    if (!parse) { note(`no parser for section ${id}`); return null; }
    return { id, tag, title, xp: Number(xp), // the original page has no "Got it" on the Mission brief; the native view gives it one (xp 10, optional for completion)
    doneable: true, required: id !== "n1", blocks: parse(body, lit), _src: body };
  }).filter(Boolean);
  return sections;
}

function extractSession(html) {
  const card = first(html, /<div class="sesscard">([\s\S]*?)<\/div><div class="mentors">/, "session card");
  const items = Object.fromEntries(all(card, /<span class="mono">([\s\S]*?)<\/span><b>([\s\S]*?)<\/b>/g).map((m) => [plain(m[1]).toLowerCase(), plain(m[2])]));
  const mentors = all(first(html, /<div class="mentors">([\s\S]*?)<\/div><\/div><div class="xpbar"/, "mentors") + "</div>",
    /<div class="mentor">[\s\S]*?<b>([\s\S]*?)<\/b><small>([\s\S]*?)<\/small>/g).map((m) => ({ name: plain(m[1]), role: plain(m[2]) }));
  const h1 = first(html, /<h1>([\s\S]*?)<\/h1>/, "h1");
  const kicker = plain(first(html, /<span class="mono muted">([\s\S]*?)<\/span><h1>/, "kicker")).split("·")[0].trim();
  return { id: "s1", number: 1, title: plain(h1), subtitle: kicker, date: items.date, time: items.time, venue: items.venue, mentors, credit: CREDIT };
}

// ---- activities --------------------------------------------------------------------------------------------------------
function extractActivities(html) {
  const { ACTS } = evalLiterals(html, ["ACTS"]);
  const staticPart = html.slice(0, html.indexOf("<script>"));
  const team = staticPart.match(/<label for="teamName">([\s\S]*?)<\/label><input[^>]*placeholder="([^"]*)"/);
  const intro = first(staticPart, /<div class="stk sun" style="margin-top:18px">[\s\S]*?<\/div><p style="margin-top:10px">([\s\S]*?)<\/p><\/div>/, "activities intro");

  const common = (g) => ({ id: g.id, type: g.type, no: Number(g.ico), title: g.title, blurb: g.blurb, meta: g.meta });
  const games = ACTS.games.map((g) => {
    switch (g.type) {
      case "wheel": return { ...common(g), rounds: g.rounds, seconds: g.seconds, maxIdeas: g.maxIdeas, scoring: SCORING.wheel,
        items: g.items.map((x) => ({ label: x.s, text: x.t, example: x.eg })) };
      case "sorter": return { ...common(g), fastSecs: g.fastSecs, scoring: SCORING.sorter,
        bins: g.bins.map((b) => ({ key: b.k, label: b.label, sub: b.sub })),
        cards: g.cards.map((c) => ({ text: c.t, bin: c.k, why: c.why })) };
      case "speed": return { ...common(g), how: g.how, seconds: g.seconds, scoring: SCORING.speed,
        options: g.options.map((o) => ({ key: o.k, label: o.label, tone: HAT_TONE[o.k] })),
        items: g.items.map((x) => ({ text: x.t, answer: x.k, why: x.why })) };
      case "ladder": return { ...common(g), scoring: SCORING.ladder, wrongText: WRONG_RUNG_TEXT,
        puzzles: g.scenarios.map((s) => ({ start: s.start, root: s.root,
          rungs: s.rungs.map((r) => ({ question: r.q, options: r.opts, correct: r.a, why: r.why })) })) };
      default: note(`unknown game type ${g.type}`); return null;
    }
  }).filter(Boolean);

  return {
    // The source intro promises a key for finishing the games. The Study Hub has no keys: the Final Exam opens when Resources and the
    // Practice Test are done, so that one sentence is swapped for the new rule.
    intro: rich(intro).replace(KEY_SENTENCE, "Finish all four games to count towards the Final Exam."),
    team: { label: team ? plain(team[1]) : "", placeholder: team ? decode(team[2]) : "" },
    games,
  };
}

// ---- tests (window.TEST in the practice and real-test pages) -----------------------------------------------------------
// Wording is copied as-is (plain text, not HTML). The source pages' unlock keys are deliberately NOT copied; minutes are kept for the timer.
function extractTest(html, mode) {
  const T = evalLiterals(html, ["TEST"]).TEST;
  if (!T) return null;
  if (T.mode !== mode) note(`tests.${mode}: source page says mode "${T.mode}"`);
  return { minutes: T.minutes, qs: (T.qs ?? []).map((x) => ({ q: x.q, o: x.o, a: x.a, why: x.why })) };
}
function validateTest(name, t, want) {
  const bad = (m) => note(`schema: tests.${name} ${m}`);
  if (!t) return bad("is missing");
  if (!isNum(t.minutes) || t.minutes <= 0) bad("minutes is missing or malformed");
  if (t.qs.length !== want) bad(`has ${t.qs.length} questions, expected ${want}`);
  t.qs.forEach((x, i) => {
    const at = `qs[${i}]`;
    if (!isStr(x.q)) bad(`${at}.q is missing`);
    if (!Array.isArray(x.o) || x.o.length !== OPTIONS_PER_QUESTION || !x.o.every(isStr)) bad(`${at}.o is not ${OPTIONS_PER_QUESTION} non-empty options`);
    if (!Number.isInteger(x.a) || x.a < 0 || x.a >= OPTIONS_PER_QUESTION) bad(`${at}.a is not a valid option index`);
    if (!isStr(x.why)) bad(`${at}.why is missing`);
  });
}

// ---- schema check (no dependency: a tiny per-block-type shape table) --------------------------------------------------
const isStr = (v) => typeof v === "string" && v.length > 0;
const isStrArr = (v) => Array.isArray(v) && v.length > 0 && v.every(isStr);
const arrOf = (shape) => (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x && Object.entries(shape).every(([k, t]) => t(x[k])));
const isNum = (v) => Number.isInteger(v);
const isBool = (v) => typeof v === "boolean";
const BLOCKS = {
  lead: { html: isStr }, list: { items: isStrArr }, paragraph: { style: isStr, html: isStr },
  stories: { items: arrOf({ label: isStr, title: isStr, html: isStr }) },
  steps: { items: arrOf({ label: isStr, title: isStr, html: isStr }) },
  flips: { items: arrOf({ letter: isStr, title: isStr, front: isStr, back: arrOf({ label: isStr, muted: isBool, html: isStr }) }) },
  callout: { label: isStr, html: isStr }, note: { label: isStr, title: isStr, html: isStr },
  quickcheck: { question: isStr, options: (v) => isStrArr(v) && v.length === 3, correct: isNum, why: isStr },
  whyLadder: { start: isStr, steps: arrOf({ question: isStr, answer: isStr }), root: isStr },
  hats: { ideaLabel: isStr, idea: isStr, items: arrOf({ id: isStr, name: isStr, focus: isStr, text: isStr }) },
  spots: { items: arrOf({ name: isStr, problem: isStr, who: isStr, sparks: isStr }) },
  glossary: { items: arrOf({ term: isStr, html: isStr }) }, takeaways: { items: isStrArr },
};
const GAMES = {
  wheel: { rounds: isNum, seconds: isNum, maxIdeas: isNum, items: arrOf({ label: isStr, text: isStr, example: isStr }) },
  sorter: { fastSecs: isNum, bins: arrOf({ key: isStr, label: isStr, sub: isStr }), cards: arrOf({ text: isStr, bin: isStr, why: isStr }) },
  speed: { how: isStr, seconds: isNum, options: arrOf({ key: isStr, label: isStr, tone: isStr }), items: arrOf({ text: isStr, answer: isStr, why: isStr }) },
  ladder: { puzzles: arrOf({ start: isStr, root: isStr, rungs: arrOf({ question: isStr, options: isStrArr, correct: isNum, why: isStr }) }) },
};
function validate(doc) {
  const bad = (m) => note(`schema: ${m}`);
  const check = (where, obj, shape) => { for (const [k, t] of Object.entries(shape)) if (!t(obj[k])) bad(`${where}.${k} is missing or malformed`); };
  check("session", doc.session, { id: isStr, title: isStr, subtitle: isStr, date: isStr, time: isStr, venue: isStr, credit: isStr, mentors: arrOf({ name: isStr, role: isStr }) });
  for (const s of doc.notes) {
    check(`notes.${s.id}`, s, { id: isStr, tag: isStr, title: isStr, xp: isNum, doneable: isBool, required: isBool, blocks: (v) => Array.isArray(v) && v.length > 0 });
    for (const b of s.blocks) BLOCKS[b.type] ? check(`notes.${s.id}.${b.type}`, b, BLOCKS[b.type]) : bad(`notes.${s.id} has unknown block type ${b.type}`);
    if (s.xp !== EXPECTED_XP[s.id]) bad(`notes.${s.id} xp ${s.xp} != ${EXPECTED_XP[s.id]}`);
  }
  for (const g of doc.activities.games) {
    check(`games.${g.id}`, g, { id: isStr, title: isStr, blurb: isStr, meta: isStrArr });
    check(`games.${g.id}`, g, GAMES[g.type]);
  }
  for (const b of doc.notes.flatMap((s) => s.blocks).filter((x) => x.type === "quickcheck")) if (b.correct < 0 || b.correct >= b.options.length) bad("quickcheck.correct out of range");
  for (const g of doc.activities.games.filter((x) => x.type === "ladder")) for (const r of g.puzzles.flatMap((p) => p.rungs)) if (r.correct >= r.options.length) bad("ladder.correct out of range");
}

// ---- wording check: every word on the source page must be in the JSON (or be UI chrome the renderer supplies) ---------
// Source pages say "Real Test"; our copy says "Final Exam" (rename), so compare both sides after the same rename.
const tokens = (s) => decode(s.replace(/<[^>]*>/g, " ")).replace(/real test/gi, "final exam").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const bag = (words) => words.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map());
const strings = (v) => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.entries(v).filter(([k]) => k !== "_src").flatMap(([, x]) => strings(x)) : []);
function missingWords(srcHtml, jsonValue, chrome) {
  const have = bag(tokens(strings(jsonValue).join(" ")));
  for (const [w, n] of bag(tokens(chrome.join(" ")))) have.set(w, (have.get(w) ?? 0) + n);
  const lost = [];
  for (const [w, n] of bag(tokens(srcHtml))) if ((have.get(w) ?? 0) < n) lost.push(`${w} x${n - (have.get(w) ?? 0)}`);
  return lost;
}
// Labels and hints that are page chrome (the renderer owns them), not session content.
const NOTES_CHROME = ["Got it", "Tap each card to flip it.", "tap to flip tap to flip tap to flip", 'Tap "Next why" to dig deeper', "Next why", "Start again",
  "Mark each part Got it to fill your XP bar.", "Pick a hat", "Tap any hat above.", "Tap a hat to see what it says.", "Problem spotted", "Tap a spot on the street.", "Session card"];
const ACTS_CHROME = ["1 2 3 4", "Team Your team Points 0 Streak 0 Games 0/4", "Game 1 Game 2 Game 3 Game 4", "Play Play Play Play", "Done Done Done Done",
  "Reset team score"];
// Source copy that is dropped on purpose, read from the page itself: the key box under the games and the intro's key sentence.
const droppedKeyCopy = (html) => [html.slice(html.indexOf('<div class="keybox">'), html.indexOf("<footer")), html.match(KEY_SENTENCE)?.[0] ?? ""];

// ---- main --------------------------------------------------------------------------------------------------------------
const read = (f) => stripBase64(fs.readFileSync(path.join(SRC_DIR, f), "utf8"));
const notesHtml = read(NOTES_FILE);
const actsHtml = read(ACTS_FILE);
const sections = extractNotes(notesHtml);
const doc = {
  schema: SCHEMA_VERSION,
  session: extractSession(notesHtml),
  notes: sections.map(({ _src, ...s }) => s),
  activities: extractActivities(actsHtml),
  tests: { practice: extractTest(read(PRACTICE_FILE), "practice"), final: extractTest(read(FINAL_FILE), "real") },
};
// The session card sits inside the notes page header, so check it together with the sections.
validate(doc);
validateTest("practice", doc.tests.practice, EXPECT.practiceQs);
validateTest("final", doc.tests.final, EXPECT.finalQs);
const sharedQs = (doc.tests.practice?.qs ?? []).filter((a) => (doc.tests.final?.qs ?? []).some((b) => b.q === a.q));
if (sharedQs.length) note(`tests: practice and final share ${sharedQs.length} question(s); they must be separate sets`);

// counts vs the originals (counted straight from the HTML, independent of the parsers above)
const blocks = (t) => doc.notes.flatMap((s) => s.blocks).filter((b) => b.type === t);
const games = Object.fromEntries(doc.activities.games.map((g) => [g.type, g]));
const counts = {
  sections: [doc.notes.length, EXPECT.sections, (notesHtml.match(/<section class="sec"/g) ?? []).length],
  doneable: [doc.notes.filter((s) => s.doneable).length, EXPECT.doneable, (notesHtml.match(/class="done-btn"/g) ?? []).length + 1], // +1: Mission brief, see above
  quickchecks: [blocks("quickcheck").length, EXPECT.quickchecks, (notesHtml.match(/class="qc"/g) ?? []).length],
  flipCards: [blocks("flips").flatMap((b) => b.items).length, EXPECT.flips, (notesHtml.match(/class="flip"/g) ?? []).length],
  hats: [blocks("hats").flatMap((b) => b.items).length, EXPECT.hats, lit(notesHtml, "HATS")],
  spots: [blocks("spots").flatMap((b) => b.items).length, EXPECT.spots, lit(notesHtml, "SPOTS")],
  glossary: [blocks("glossary").flatMap((b) => b.items).length, EXPECT.glossary, (sections.find((x) => x.id === "n8")._src.match(/<div><b>/g) ?? []).length],
  takeaways: [blocks("takeaways").flatMap((b) => b.items).length, EXPECT.takeaways, (notesHtml.match(/<div><p><b>/g) ?? []).length],
  games: [doc.activities.games.length, EXPECT.games, (actsHtml.match(/<section class="game"/g) ?? []).length],
  wheelItems: [games.wheel?.items.length, EXPECT.wheelItems, lit(actsHtml, "ACTS", /"s":/g)],
  sorterCards: [games.sorter?.cards.length, EXPECT.sorterCards, lit(actsHtml, "ACTS", /"why": "[^"]*"\}/g, "sort")],
  hatComments: [games.speed?.items.length, EXPECT.hatComments, null],
  ladderPuzzles: [games.ladder?.puzzles.length, EXPECT.puzzles, null],
  practiceQuestions: [doc.tests.practice?.qs.length, EXPECT.practiceQs, null],
  finalQuestions: [doc.tests.final?.qs.length, EXPECT.finalQs, null],
};
function lit(html, name, re, _part) { // count entries in a source literal without trusting the parser under test
  const l = evalLiterals(html, [name])[name];
  if (name === "HATS" || name === "SPOTS") return l?.length ?? null;
  return re ? l.games.find((g) => g.type === "wheel").items.length : null;
}
counts.sorterCards[2] = evalLiterals(actsHtml, ["ACTS"]).ACTS.games.find((g) => g.type === "sorter").cards.length;
counts.hatComments[2] = evalLiterals(actsHtml, ["ACTS"]).ACTS.games.find((g) => g.type === "speed").items.length;
counts.practiceQuestions[2] = evalLiterals(read(PRACTICE_FILE), ["TEST"]).TEST?.qs.length; // counted again straight from the source literal
counts.finalQuestions[2] = evalLiterals(read(FINAL_FILE), ["TEST"]).TEST?.qs.length;
counts.ladderPuzzles[2] = evalLiterals(actsHtml, ["ACTS"]).ACTS.games.find((g) => g.type === "ladder").scenarios.length;
for (const [k, [got, want, src]] of Object.entries(counts)) if (got !== want || (src != null && got !== src)) note(`count ${k}: json ${got}, expected ${want}, source ${src}`);

for (const s of sections) {
  const lost = missingWords(s._src, doc.notes.find((n) => n.id === s.id), NOTES_CHROME);
  if (lost.length) note(`notes ${s.id}: source words not in JSON: ${lost.join(", ")}`);
}
const sessionLost = missingWords(notesHtml.slice(notesHtml.indexOf('<div class="hero">'), notesHtml.indexOf('<section class="sec" id="n1"')),
  { session: doc.session, sub: "Study Notes", hero: "SESSION 01 Your XP 0 XP Mark each part Got it to fill your XP bar. Spot problems, dig to the root, test your idea and look at it from six sides. Everything from Session 1 in one place.", n: "Session card" }, NOTES_CHROME);
const heroCopy = first(notesHtml, /<p class="sub">([\s\S]*?)<\/p>/, "notes hero subtitle");
const actsHero = first(actsHtml, /<p class="sub">([\s\S]*?)<\/p>/, "activities hero subtitle");
// the final sentence points at the original page's "Got it" buttons; ours say "Mark as done", so it stays out of the data
  doc.session.notesIntro = rich(heroCopy).replace(/\s*Mark each part[^.]*\.$/, "");
doc.activities.subtitle = rich(actsHero);
const actsLost = missingWords(actsHtml.slice(actsHtml.indexOf('<div class="hero">'), actsHtml.indexOf("<footer")), doc.activities,
  [...ACTS_CHROME, ...droppedKeyCopy(actsHtml), "SESSION 01 Startup Ideation Activities Where Ideas Come From", doc.session.title, doc.session.subtitle]);
if (actsLost.length) note(`activities: source words not in JSON: ${actsLost.join(", ")}`);


// leftover markup inside strings must be inline <b>/<i> only
for (const s of strings(doc)) if (/<(?!\/?(?:b|i)>)[a-z]/i.test(s)) note(`unexpected markup in: ${s.slice(0, 60)}`);

if (problems.length) {
  console.error("NOT written. Could not parse cleanly:\n - " + problems.join("\n - "));
  process.exit(1);
}
fs.writeFileSync(OUT_FILE, JSON.stringify(doc, null, 2) + "\n");
console.log(`wrote ${path.relative(process.cwd(), OUT_FILE)}`);
console.table(Object.fromEntries(Object.entries(counts).map(([k, [got, want, src]]) => [k, { json: got, expected: want, source: src ?? "-" }])));
console.log(`questions: ${blocks("quickcheck").length} quick checks + ${games.ladder.puzzles.flatMap((p) => p.rungs).length} ladder rungs; ` +
  `cards: ${blocks("flips").flatMap((b) => b.items).length} flip + ${games.sorter.cards.length} sorter; xp total ${doc.notes.reduce((n, s) => n + s.xp, 0)} (all sections)`);
