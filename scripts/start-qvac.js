'use strict';

/**
 * start-qvac.js — SUPERSEDED
 *
 * brain.js now uses @qvac/sdk directly (loadModel + completion) so no
 * separate `qvac serve openai` process is needed. This script is kept
 * only as a manual fallback if you want to expose an OpenAI-compatible
 * endpoint on a different port for external tools.
 *
 * To disable the in-process SDK path and force Ollama-only mode:
 *   QVAC_DISABLED=1 node src/server.js
 *
 * To change the SDK model:
 *   QVAC_SDK_MODEL=QWEN3_1_7B_INST_Q4 node src/server.js
 */

require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

const port = process.env.LLAMA_PORT || '11435'; // reuse LLAMA_PORT or default
const host = '127.0.0.1';
const configPath = path.join(__dirname, '..', 'qvac.config.json');

const args = [
  'serve', 'openai',
  '--port', port,
  '--host', host,
  '--config', configPath,
  '--model', 'evaluator',
  '--verbose',
];

console.log(`[qvac] Starting: qvac ${args.join(' ')}`);

const proc = spawn('qvac', args, {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});

proc.on('error', err => {
  if (err.code === 'ENOENT') {
    console.error('[qvac] "qvac" binary not found. Install: npm install -g @qvac/cli');
  } else {
    console.error('[qvac] Failed to start:', err.message);
  }
  process.exit(1);
});

proc.on('exit', code => process.exit(code ?? 0));
process.on('SIGINT',  () => proc.kill('SIGINT'));
process.on('SIGTERM', () => proc.kill('SIGTERM'));
