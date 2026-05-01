'use strict';

/**
 * Tests for src/utils/jobQueue.js
 * Run: node tests/jobQueue.test.js
 */

const assert = require('assert');
const { createJob, getJob } = require('../src/utils/jobQueue');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {

// ── createJob / getJob ────────────────────────────────────────────────────────

console.log('\nJob lifecycle');

await test('createJob returns a string ID', async () => {
  const id = createJob(['a'], async () => 'result');
  assert.strictEqual(typeof id, 'string');
  assert.ok(id.length > 0);
});

await test('getJob returns null for unknown ID', async () => {
  assert.strictEqual(getJob('nonexistent-id'), null);
});

await test('job starts as queued or running', async () => {
  const id = createJob(['x'], async () => null);
  const job = getJob(id);
  assert.ok(['queued', 'running'].includes(job.status));
  assert.strictEqual(job.total, 1);
  assert.strictEqual(job.done, 0);
});

// ── Processing ────────────────────────────────────────────────────────────────

console.log('\nProcessing');

await test('completes a single-item job', async () => {
  const id = createJob(['addr1'], async (input) => [{ input, result: true }]);
  await sleep(200);
  const job = getJob(id);
  assert.strictEqual(job.status, 'done');
  assert.strictEqual(job.done, 1);
  assert.strictEqual(job.results.length, 1);
  assert.strictEqual(job.results[0].input, 'addr1');
});

await test('completes a multi-item job', async () => {
  const inputs = ['a1', 'a2', 'a3', 'a4', 'a5'];
  const id = createJob(inputs, async (input) => [{ input, result: true }]);
  await sleep(300);
  const job = getJob(id);
  assert.strictEqual(job.status, 'done');
  assert.strictEqual(job.done, 5);
  assert.strictEqual(job.results.length, 5);
});

await test('tracks done count incrementally', async () => {
  const id = createJob(['x1', 'x2', 'x3'], async (input) => {
    await sleep(50);
    return [{ input, result: false }];
  });
  await sleep(80);
  const mid = getJob(id);
  assert.ok(mid.done > 0, `expected done > 0, got ${mid.done}`);
  await sleep(300);
  assert.strictEqual(getJob(id).done, 3);
});

await test('handles processFn errors gracefully', async () => {
  const id = createJob(['ok', 'fail', 'ok2'], async (input) => {
    if (input === 'fail') throw new Error('boom');
    return [{ input, result: true }];
  });
  await sleep(300);
  const job = getJob(id);
  assert.strictEqual(job.status, 'done');
  assert.strictEqual(job.done, 3);
  assert.ok(job.errors.length > 0);
  assert.ok(job.results.length >= 2);
});

await test('processes results from array-returning processFn', async () => {
  const id = createJob(['w1'], async () => [
    { input: 'w1', methodId: 'm1', result: true },
    { input: 'w1', methodId: 'm2', result: false },
  ]);
  await sleep(200);
  const job = getJob(id);
  assert.strictEqual(job.results.length, 2);
});

// ── Concurrency ───────────────────────────────────────────────────────────────

console.log('\nConcurrency');

await test('runs at most MAX_CONCURRENT_JOBS simultaneously', async () => {
  let concurrent = 0;
  let maxSeen    = 0;

  const slow = async (input) => {
    concurrent++;
    maxSeen = Math.max(maxSeen, concurrent);
    await sleep(100);
    concurrent--;
    return [{ input, result: true }];
  };

  // Create 4 jobs (MAX is 2) — each with 1 slow wallet
  const ids = Array.from({ length: 4 }, () => createJob(['w'], slow));
  await sleep(600);

  for (const id of ids) assert.strictEqual(getJob(id).status, 'done');
  assert.ok(maxSeen <= 2, `Expected max 2 concurrent jobs, got ${maxSeen}`);
});

await test('second job starts after first finishes when at capacity', async () => {
  const order = [];
  const make = (tag) => createJob(['w'], async () => {
    await sleep(80);
    order.push(tag);
    return null;
  });

  // Fill both slots
  make('A'); make('B');
  // This one should queue
  const id3 = make('C');

  await sleep(400);
  assert.strictEqual(getJob(id3).status, 'done');
  // C must come after at least one of A or B
  assert.ok(order.indexOf('C') > 0, `C ran before A or B: ${order}`);
});

// ── Result ────────────────────────────────────────────────────────────────────

console.log('\nResult shape');

await test('job has expected fields when done', async () => {
  const id  = createJob(['addr'], async () => [{ input: 'addr', result: true }]);
  await sleep(200);
  const job = getJob(id);
  assert.ok('id'          in job);
  assert.ok('status'      in job);
  assert.ok('total'       in job);
  assert.ok('done'        in job);
  assert.ok('results'     in job);
  assert.ok('errors'      in job);
  assert.ok('createdAt'   in job);
  assert.ok('completedAt' in job);
  assert.ok(job.completedAt >= job.createdAt);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

})();
