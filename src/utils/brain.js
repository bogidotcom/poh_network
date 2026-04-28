'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ── Model config ──────────────────────────────────────────────────────────────
// Override per-role via env. All default to OLLAMA_MODEL so it works out-of-box.
const OLLAMA_URL       = process.env.OLLAMA_URL        || 'http://localhost:11434';
const BASE_MODEL       = process.env.OLLAMA_MODEL      || 'llama3.2';
const EVALUATOR_MODEL  = process.env.EVALUATOR_MODEL   || BASE_MODEL; // DeepSeek R1
const LEARNER_MODEL    = process.env.LEARNER_MODEL     || BASE_MODEL; // Qwen 2.5
const COMPILER_MODEL   = process.env.COMPILER_MODEL    || BASE_MODEL; // Mixtral

const BRAIN_STATE_PATH = path.join(__dirname, '../../data/brain_state.md');
const DATASET_PATH     = path.join(__dirname, '../../data/dataset.json');
const WEIGHTS_PATH     = path.join(__dirname, '../../data/weights.json');

// ── Ollama request queue (serializes all calls — Ollama is single-instance) ───
let _ollamaQueue = Promise.resolve();

function queueOllama(fn) {
  _ollamaQueue = _ollamaQueue.then(fn, fn);
  return _ollamaQueue;
}

// Kept for the analyzeHumanness busy-check (prevents stacking verdict requests)
let ollamaBusy = false;

// ── Persistence helpers ───────────────────────────────────────────────────────

function getBrainState() {
  if (!fs.existsSync(BRAIN_STATE_PATH)) return '';
  return fs.readFileSync(BRAIN_STATE_PATH, 'utf-8');
}

function saveBrainState(content) {
  fs.writeFileSync(BRAIN_STATE_PATH, content, 'utf-8');
}

function getWeights() {
  if (!fs.existsSync(WEIGHTS_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf-8')); }
  catch { return {}; }
}

function saveWeights(w) {
  fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(w, null, 2));
}


// ── Ollama call (per model) ───────────────────────────────────────────────────

async function ollamaChat(prompt, { model = BASE_MODEL, maxTokens = 512, timeLimit = 30000, jsonMode = false } = {}) {
  return queueOllama(async () => {
    ollamaBusy = true;
    try {
      const body = {
        model,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: maxTokens },
      };
      if (jsonMode) body.format = 'json';
      const res = await axios.post(`${OLLAMA_URL}/api/generate`, body, { timeout: timeLimit });
      return res.data.response?.trim() || '';
    } catch (err) {
      console.error('[brain] Ollama call failed:', err.message);
      return null;
    } finally {
      ollamaBusy = false;
    }
  });
}

// ── JSON extraction ───────────────────────────────────────────────────────────
// Handles DeepSeek <think>...</think> blocks, markdown code fences, and bare JSON.

function extractJSON(text) {
  if (!text) return null;
  // Strip DeepSeek chain-of-thought tags
  let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // Find the first complete {...} block
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); }
  catch {
    // Try to recover truncated JSON by finding the last valid close
    const s = match[0];
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] === '}') {
        try { return JSON.parse(s.slice(0, i + 1)); } catch { continue; }
      }
    }
    return null;
  }
}

async function ollamaChatJSON(prompt, requiredKeys, opts = {}) {
  const raw = await ollamaChat(prompt, { ...opts, jsonMode: true });
  let parsed = extractJSON(raw);

  if (!parsed || requiredKeys.some(k => !(k in parsed))) {
    console.warn('[brain] Invalid JSON output, retrying...');
    const retry = await ollamaChat(
      `${prompt}\n\nIMPORTANT: Respond with ONLY a valid JSON object. Required fields: ${requiredKeys.join(', ')}. No other text.`,
      { ...opts, jsonMode: true }
    );
    parsed = extractJSON(retry);
  }

  return parsed;
}

// ── Stability suffix (appended to every evaluator prompt) ─────────────────────
// ── 1. EVALUATOR — analyzeHumanness ──────────────────────────────────────────

async function analyzeHumanness(address, methodResults, methods) {
  if (ollamaBusy) {
    console.log('[brain] Ollama busy — skipping verdict for', address);
    return { verdict: 'PENDING', confidence: 0, reasoning: 'Brain is busy, try again shortly' };
  }

  const weights = getWeights();

  // Top 5 signals by community score
  const signals = methodResults
    .slice()
    .sort((a, b) => {
      const sa = methods.find(m => m.id === a.methodId)?.score ?? 0;
      const sb = methods.find(m => m.id === b.methodId)?.score ?? 0;
      return Math.abs(sb) - Math.abs(sa);
    })
    .slice(0, 5)
    .map(r => {
      const m = methods.find(m => m.id === r.methodId);
      return {
        name: r.description,
        result: r.result,
        community_score: m?.score ?? 0,
        weight: weights[r.methodId] ?? 1.0
      };
    });

  const methodWeightsStr = signals
    .map(s => `  "${s.name}": ${s.weight}`)
    .join(',\n');

  const signalsStr = JSON.stringify(signals, null, 2);

  const prompt = `You are a signal evaluation engine for a Proof of Human system.
Analyze the signals below and decide if wallet ${address} is human or bot.

Signals:
${signalsStr}

Method weights:
{
${methodWeightsStr}
}

Rules:
- Only use the signals provided. Do not guess.
- If signals conflict or are too weak, use verdict UNCERTAIN.
- confidence must be between 0.0 and 1.0.
- reasoning must explain which signals drove the decision and why.

Return a single JSON object. Example of correct output:
{"verdict":"HUMAN","confidence":0.72,"reasoning":"3 of 5 signals passed including high-weight on-chain activity. One conflict on REST endpoint reduced confidence."}

Now return the JSON for wallet ${address}:`;

  const result = await ollamaChatJSON(
    prompt,
    ['verdict', 'confidence', 'reasoning'],
    { model: EVALUATOR_MODEL, maxTokens: 400, timeLimit: 40000 }
  );

  if (!result) return { verdict: 'UNKNOWN', confidence: 0, reasoning: 'Brain offline or invalid output' };

  // ── Double-pass verification ──────────────────────────────────────────────
  const verifyPrompt = `Review this wallet verdict and correct it if wrong.

Wallet: ${address}
Signals: ${signalsStr}
Previous verdict: ${JSON.stringify(result)}

Is the verdict consistent with the signals? Is confidence justified?
Return the final JSON verdict (same format, corrected if needed):
{"verdict":"HUMAN or AI or UNCERTAIN","confidence":0.0_to_1.0,"reasoning":"actual explanation of what the signals showed"}`;

  const verified = await ollamaChatJSON(
    verifyPrompt,
    ['verdict', 'confidence', 'reasoning'],
    { model: EVALUATOR_MODEL, maxTokens: 400, timeLimit: 30000 }
  );

  const final = verified || result;

  return {
    verdict: (final.verdict || 'UNKNOWN').toUpperCase(),
    confidence: Math.min(1, Math.max(0, parseFloat(final.confidence) || 0.5)),
    reasoning: final.reasoning || '',
    signal_contributions: final.signal_contributions || {},
    conflicts: final.conflicts || []
  };
}

// ── 2. LEARNER — onVote (weight update) ──────────────────────────────────────

async function onVote(method, voteType, vote, stakeWeight, feedback = null) {
  const voteContext = {
    description: 'Is the description accurate?',
    method:      'Can this detect human behavior?',
    risk:        'Can an AI fake this?'
  }[voteType] || voteType;

  const currentWeights = getWeights();
  const currentWeight  = currentWeights[method.id] ?? 1.0;

  const feedbackLine = feedback
    ? `Voter reasoning: "${feedback.slice(0, 200)}"`
    : 'Voter reasoning: (none provided)';

  const prompt = `A detection method was voted on. Should its weight go up or down?

Method: ${method.description}
Current weight: ${currentWeight}
Vote question: ${voteContext}
Vote: ${vote ? 'YES (good signal)' : 'NO (bad signal)'}
Voter stake: ${stakeWeight.toFixed(3)}
${feedbackLine}

Reply with ONLY this JSON (new_weight must be within 0.05 of current weight ${currentWeight}):
{"new_weight": ${currentWeight}}`;

  const result = await ollamaChatJSON(
    prompt,
    ['new_weight'],
    { model: LEARNER_MODEL, maxTokens: 60, timeLimit: 20000 }
  );

  const updated = { ...currentWeights };
  if (result?.new_weight != null) {
    const proposed = parseFloat(result.new_weight) || currentWeight;
    // Hard-enforce ±0.05 drift cap regardless of what the LLM returned
    const clamped = Math.min(3.0, Math.max(0.1,
      Math.min(currentWeight + 0.05, Math.max(currentWeight - 0.05, proposed))
    ));
    updated[method.id] = clamped;
  } else {
    // LLM failed — apply a simple heuristic directly
    const delta = (vote ? 1 : -1) * 0.02 * Math.min(stakeWeight * 10, 1);
    updated[method.id] = Math.min(3.0, Math.max(0.1, currentWeight + delta));
  }
  saveWeights(updated);
  console.log(`[brain] Weight updated for "${method.description}": ${currentWeight} → ${updated[method.id].toFixed(3)}`);

  // Append compact note to brain state
  const voteLabel = vote ? 'YES' : 'NO';
  const current = getBrainState();
  const note = `\n\n### Vote: ${method.description} | ${voteContext} → ${voteLabel} (stake: ${stakeWeight.toFixed(3)}) — ${new Date().toISOString()}`;
  saveBrainState((current + note).trim());
}

// ── 3. onNewMethod — strict assessment ───────────────────────────────────────

async function onNewMethod(method) {
  const prompt = `SYSTEM:
You are evaluating a new detection method for a Proof of Human network.
Be technical and concise. Max 2 sentences.

METHOD:
Type: ${method.type}
Description: ${method.description}
Address/URL: ${method.address || 'N/A'}
Method: ${method.method || 'N/A'}
Expression: ${method.expression || 'N/A'}

TASK:
Assess: Is this a reliable human-vs-bot signal? What edge cases could fool it?

OUTPUT (STRICT JSON):
{
  "useful": true,
  "risk": "none | low | medium | high",
  "assessment": "one sentence"
}`;

  const result = await ollamaChatJSON(
    prompt,
    ['useful', 'assessment'],
    { model: EVALUATOR_MODEL, maxTokens: 250, timeLimit: 30000 }
  );

  const assessment = result?.assessment || '(no assessment)';
  const risk       = result?.risk || 'unknown';
  console.log(`[brain] New method "${method.description}" — risk: ${risk} — ${assessment}`);

  const current = getBrainState();
  const note = `\n\n### Method Added: ${method.description} (risk: ${risk}) — ${new Date().toISOString()}\n${assessment}`;
  saveBrainState((current + note).trim());

  return result;
}

// ── 4. COMPILER — consolidate ─────────────────────────────────────────────────

async function consolidate() {
  const dataset = fs.existsSync(DATASET_PATH)
    ? JSON.parse(fs.readFileSync(DATASET_PATH, 'utf-8'))
    : [];

  const scanRecords = dataset.filter(d => d.instruction.startsWith('Verification'));
  const voteRecords = dataset.filter(d => d.instruction.startsWith('Voter'));

  if (scanRecords.length === 0 && voteRecords.length === 0) {
    console.log('[brain] Consolidation skipped — no data yet');
    return;
  }

  const weights   = getWeights();
  const topMethods = Object.entries(weights)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([id, w]) => `${id}: weight ${w.toFixed(2)}`);

  const weakMethods = Object.entries(weights)
    .sort(([, a], [, b]) => a - b)
    .slice(0, 3)
    .map(([id, w]) => `${id}: weight ${w.toFixed(2)}`);

  const recentScans = scanRecords.slice(-8)
    .map(r => `${r.instruction.replace('Verification response for ', '').slice(0, 50)} → ${r.output}`)
    .join('\n');

  const recentVotes = voteRecords.slice(-8)
    .map(r => `${r.instruction.slice(0, 40)} | ${r.input.slice(0, 30)} → ${r.output}`)
    .join('\n');

  const currentBrain = getBrainState();

  const prompt = `SYSTEM:
You are generating a compact system state.
You are NOT creative.
You ONLY summarize statistically supported facts.
Max 400 words.

INPUT:
Top Methods (by weight):
${topMethods.join('\n') || 'none'}

Weak Methods:
${weakMethods.join('\n') || 'none'}

Recent Scans:
${recentScans || 'none'}

Recent Votes:
${recentVotes || 'none'}

Previous State (truncated):
${currentBrain.slice(0, 300) || 'none'}

TASK:
Write a precise system summary.

STYLE:
- technical
- concise
- no repetition
- no speculation`;

  console.log('[brain] Consolidating knowledge...');
  const newBrainState = await ollamaChat(prompt, {
    model: COMPILER_MODEL,
    maxTokens: 300,
    timeLimit: 60000
  });

  if (newBrainState) {
    saveBrainState(`# Brain State — Last updated: ${new Date().toISOString()}\n\n${newBrainState}`);
    console.log('[brain] Consolidation complete.');
  }
}

// ── 5. validateDescription ────────────────────────────────────────────────────
async function validateDescription(description) {
  const prompt = `You are validating a method description submitted to a Proof of Human detection network.
The description must clearly explain what on-chain or API signal is being checked and why it indicates human activity.

Description to evaluate: "${description.slice(0, 300)}"

Reject if: random characters, placeholder text (test, asdf, foo, hello world), too vague (< 5 meaningful words), no clear signal described, or clearly not about human detection.
Accept if: it describes a specific on-chain or off-chain signal, API endpoint, or behavior pattern relevant to distinguishing humans from bots.

Reply with ONLY this JSON:
{"valid": true, "reason": "one sentence"}
or
{"valid": false, "reason": "one sentence explaining what's wrong"}`;

  const result = await ollamaChatJSON(
    prompt,
    ['valid', 'reason'],
    { model: EVALUATOR_MODEL, maxTokens: 80, timeLimit: 20000 }
  );
  return result || { valid: false, reason: 'Validation unavailable — try again shortly' };
}

module.exports = { analyzeHumanness, onNewMethod, onVote, consolidate, getWeights, validateDescription };
