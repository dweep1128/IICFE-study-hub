// Course chatbot: keyword search over the course's own Guidance, Modules and Resources.
// If ANTHROPIC_API_KEY is set, Claude answers from the best-matching items instead.
const MAX_SOURCES = 3;
const MAX_SNIPPET_CHARS = 380;
const CLAUDE_CONTEXT_CHARS = 9000;
const CLAUDE_MAX_TOKENS = 500;
const CLAUDE_TIMEOUT_MS = 15000;
const TITLE_WEIGHT = 3;
const DEFAULT_MODEL = "claude-haiku-5-5";

const STOP = new Set("the a an and or of to in on for is are was were be how do does did what when where which who why can i my me we you your it this that with about from at as by".split(" "));
const tokens = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));

// docs: [{ title, text }]  ->  matches sorted by score, zero-score items dropped
function rank(docs, question) {
  const q = tokens(question);
  return docs
    .map((d) => {
      const title = tokens(d.title);
      const body = tokens(d.text);
      const score = q.reduce((sum, w) => sum + (title.includes(w) ? TITLE_WEIGHT : 0) + (body.includes(w) ? 1 : 0), 0);
      return { ...d, score };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score);
}

function bestSnippet(text, question) {
  const q = tokens(question);
  const sentences = String(text).split(/(?<=[.!?])\s+/).filter(Boolean);
  const scored = sentences.map((s, i) => ({ s, i, hits: tokens(s).filter((w) => q.includes(w)).length }));
  const picked = scored.sort((a, b) => b.hits - a.hits).slice(0, 2).sort((a, b) => a.i - b.i).map((x) => x.s).join(" ");
  return picked.length > MAX_SNIPPET_CHARS ? picked.slice(0, MAX_SNIPPET_CHARS).trimEnd() + "…" : picked;
}

const GREETING_RE = /^\s*(hi|hello|hey|good (morning|afternoon|evening))\b/i;
const NO_MATCH = "I couldn't find that in this course's guide, modules or resources yet. Try asking about the study plan, exam technique, or a module topic, and your tutor can help with anything else.";

function keywordAnswer(question, docs) {
  if (GREETING_RE.test(question) && tokens(question).length === 0) {
    return { answer: "Hi! I can answer questions using this course's guide, modules and resources. What would you like to know?", sources: [] };
  }
  const hits = rank(docs, question).slice(0, MAX_SOURCES);
  if (!hits.length) return { answer: NO_MATCH, sources: [] };
  const [top, second] = hits;
  let answer = `Here's what I found in "${top.title}": ${bestSnippet(top.text, question)}`;
  if (second) answer += ` You might also find "${second.title}" useful.`;
  return { answer, sources: hits.map((h) => h.title) };
}

async function claudeAnswer(question, docs) {
  const hits = rank(docs, question).slice(0, MAX_SOURCES + 2);
  const context = hits.map((h) => `## ${h.title}\n${h.text}`).join("\n\n").slice(0, CLAUDE_CONTEXT_CHARS);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.CHAT_MODEL || DEFAULT_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      system: "You are a friendly study assistant for an ACCA course. Answer ONLY from the course material provided. If it does not contain the answer, say so briefly and suggest asking the tutor. Keep answers under 120 words, plain text, no markdown.",
      messages: [{ role: "user", content: `Course material:\n${context || "(none matched)"}\n\nStudent question: ${question}` }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
  const data = await res.json();
  const answer = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!answer) throw new Error("Empty answer from Claude");
  return { answer, sources: hits.slice(0, MAX_SOURCES).map((h) => h.title) };
}

async function answerQuestion(question, docs) {
  if (process.env.ANTHROPIC_API_KEY) {
    try { return await claudeAnswer(question, docs); } catch (err) { console.error("[chat] Claude failed, using keyword mode:", err.message); }
  }
  return keywordAnswer(question, docs);
}

module.exports = { answerQuestion, keywordAnswer };
