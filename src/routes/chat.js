'use strict';
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const brain   = require('../utils/brain');

const MINER_NODE_URL = process.env.MINER_NODE_URL || 'http://localhost:3456';

async function fetchSkillsFromMiner() {
  try {
    const r = await axios.get(`${MINER_NODE_URL}/api/skills`, { timeout: 3000 });
    return Array.isArray(r.data) ? r.data : (r.data?.skills || []);
  } catch {
    return [];
  }
}

// GET /chat/skills — list skills with context summaries
router.get('/skills', async (req, res) => {
  const skills = await fetchSkillsFromMiner();
  const contexts = brain.loadSkillContexts(skills);
  res.json({ skills: contexts });
});

// POST /chat/route — route message to skill or general chat
router.post('/route', async (req, res) => {
  const { message, budget = 500, wallet } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  try {
    const skills       = await fetchSkillsFromMiner();
    const skillContexts = brain.loadSkillContexts(skills);
    const route        = await brain.routeMessage(message, skillContexts);

    if (!route?.skillId) {
      const reply = `I can help you run skills on the PoH network. Try asking about a wallet address or Farcaster profile. ${route?.reason ? '(' + route.reason + ')' : ''}`;
      return res.json({ type: 'chat', reply });
    }

    const job = {
      type:    'skill',
      skillId: route.skillId,
      payload: route.input || {},
      maxBudget: Number(budget),
    };
    if (wallet) job.requesterAddress = wallet;

    const jobRes = await axios.post(`${MINER_NODE_URL}/job`, job, {
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });

    return res.json({
      type:    'job',
      jobId:   jobRes.data.jobId,
      skillId: route.skillId,
      input:   route.input,
      reason:  route.reason,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /chat/job/:id/result — proxy to miner node job result
router.get('/job/:id/result', async (req, res) => {
  try {
    const r = await axios.get(`${MINER_NODE_URL}/job/${req.params.id}/result`, { timeout: 6000 });
    res.status(r.status).json(r.data);
  } catch (err) {
    res.status(err.response?.status || 502).json({ error: err.message });
  }
});

// POST /chat/interpret — convert raw skill result to human-readable reply
router.post('/interpret', async (req, res) => {
  const { skillId, result, userMessage, context } = req.body;
  if (!skillId || result === undefined) return res.status(400).json({ error: 'skillId and result are required' });

  try {
    let skillContext = context || '';
    if (!skillContext) {
      const skills = await fetchSkillsFromMiner();
      const skill  = skills.find(s => s.id === skillId);
      skillContext  = skill?.context || '';
    }

    const reply = await brain.interpretSkillResult({
      skillId,
      result,
      context: skillContext,
      userMessage: userMessage || '',
    });
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
