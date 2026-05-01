'use strict';

const MAX_CONCURRENT_JOBS = 2;  // jobs running simultaneously
const WALLET_CONCURRENCY  = 5;  // wallets processed in parallel within a job
const JOB_TTL_MS = 2 * 60 * 60 * 1000; // prune completed jobs after 2h

const _jobs  = {};
const _queue = [];
let   _running = 0;

function createJob(inputs, processFn) {
  const id = crypto.randomUUID();
  _jobs[id] = {
    id,
    status:      'queued',
    total:       inputs.length,
    done:        0,
    results:     [],
    errors:      [],
    createdAt:   Date.now(),
    completedAt: null,
  };
  _queue.push({ id, inputs, processFn });
  _tick();
  return id;
}

function getJob(id) {
  return _jobs[id] || null;
}

function _tick() {
  _pruneOldJobs();
  while (_running < MAX_CONCURRENT_JOBS && _queue.length > 0) {
    const item = _queue.shift();
    _running++;
    // Re-enter tick when a job finishes so queued jobs start immediately
    _processJob(item).finally(() => { _running--; _tick(); });
  }
}

async function _processJob({ id, inputs, processFn }) {
  const job = _jobs[id];
  if (!job) return;
  job.status = 'running';

  for (let i = 0; i < inputs.length; i += WALLET_CONCURRENCY) {
    const batch   = inputs.slice(i, i + WALLET_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(input => processFn(input)));

    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value != null) {
        const items = Array.isArray(r.value) ? r.value : [r.value];
        job.results.push(...items);
      } else if (r.status === 'rejected') {
        job.errors.push(r.reason?.message || 'unknown error');
      }
      job.done++;
    }
  }

  job.status      = 'done';
  job.completedAt = Date.now();
}

function _pruneOldJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const id of Object.keys(_jobs)) {
    if (_jobs[id].completedAt && _jobs[id].completedAt < cutoff) delete _jobs[id];
  }
}

module.exports = { createJob, getJob };
