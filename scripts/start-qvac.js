'use strict';

/**
 * start-qvac.js — starts the Qvac OpenAI-compatible inference server
 * for the POH brain Evaluator role.
 *
 * Uses @qvac/cli + @qvac/sdk with the model defined in qvac.config.json.
 * The server listens on QVAC_PORT (default: 11435) and is called by
 * brain.js via QVAC_URL=http://localhost:11435.
 *
 * Run:  yarn qvac  (or yarn start:qvac)
 * Auto: yarn dev:all / yarn start:all  (via launch.js ensureQvac)
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
