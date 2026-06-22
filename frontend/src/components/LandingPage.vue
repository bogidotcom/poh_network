<script setup>
const emit = defineEmits(['navigate'])
</script>

<template>
  <div class="landing-root">
    <!-- Navbar -->
    <header class="lp-nav">
      <div class="lp-nav-logo" @click="emit('navigate', 'landing')">
        <img src="/poh-icon.png" alt="POH" class="lp-logo-img" />
      </div>
      <nav class="lp-nav-links">
        <button class="lp-nav-btn" @click="emit('navigate', 'scanner')">Scanner</button>
        <button class="lp-nav-btn" @click="emit('navigate', 'skills')">Skills</button>
        <a class="lp-nav-btn lp-nav-btn--miner" href="https://miner.proofofhuman.ge" target="_blank" rel="noopener">
          Miner <span class="lp-ext">↗</span>
        </a>
      </nav>
    </header>

    <!-- Hero -->
    <section class="lp-hero">
      <div class="lp-hero-inner">

        <h1 class="lp-title">
          Decentralized <br>AI Compute Network<br />
        </h1>
        
        <div class="lp-hero-actions">
          <button class="lp-cta-secondary" @click="emit('navigate', 'scanner')">
            Open Scanner →
          </button>
          <a class="lp-cta-primary" href="https://miner.proofofhuman.ge" target="_blank" rel="noopener">
            Run a Miner ↗
          </a>
        </div>
      </div>
      <div class="lp-grid-bg" aria-hidden="true">
        <div class="lp-grid-line" v-for="i in 12" :key="i" />
      </div>
    </section>

    <!-- Feature cards -->
    <section class="lp-features">
      <div class="lp-feature-card">
        <div class="lp-feature-icon">⬡</div>
        <h3 class="lp-feature-title">Miner Network</h3>
        <p class="lp-feature-desc">
          Independent nodes compete to solve tasks for AI and earn POH rewards.
          Anyone can join. No permission required.
        </p>
      </div>
      <div class="lp-feature-card">
        <div class="lp-feature-icon">◎</div>
        <h3 class="lp-feature-title">On-Chain Brain</h3>
        <p class="lp-feature-desc">
          AI weights and verification logic live on the chain. Consensus
          determines truth — not a company, not a government.
        </p>
      </div>
      <div class="lp-feature-card">
        <div class="lp-feature-icon">◈</div>
        <h3 class="lp-feature-title">Open Skills</h3>
        <p class="lp-feature-desc">
          Third-party skills extend the network's capabilities. Submit a skill,
          earn rewards when miners run it.
        </p>
      </div>
    </section>

    <!-- Footer -->
    <footer class="lp-footer">
      <a href="https://t.me/poh_network_group" target="_blank" rel="noopener" class="lp-footer-link">Telegram</a>
      <a href="https://x.com/poh_network" target="_blank" rel="noopener" class="lp-footer-link">X / Twitter</a>
      <a href="https://drive.google.com/file/d/1677szgNnIN68pvmQ1VhPvvOPRepAC4lp/view?usp=sharing" target="_blank" rel="noopener" class="lp-footer-link">Deck</a>
    </footer>
  </div>
</template>

<style scoped>
.landing-root {
  min-height: 100vh;
  background: #000;
  color: #fff;
  display: flex;
  flex-direction: column;
  font-family: 'Iceland', sans-serif;
}

/* ── Navbar ─────────────────────────────────────────── */
.lp-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.1rem 2rem;
  border-bottom: 1px solid #111;
  position: sticky;
  top: 0;
  background: #000;
  z-index: 100;
}

.lp-nav-logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  user-select: none;
}

.lp-logo-img {
  width: 64px;
  height: 64px;
}

.lp-logo-text {
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  color: #fff;
}

.lp-nav-links {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.lp-nav-btn {
  background: transparent;
  color: #aaa;
  border: 1px solid #1e1e1e;
  padding: 0.45rem 1rem;
  border-radius: 6px;
  font-family: inherit;
  font-size: 1.5rem;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.15s, border-color 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.lp-nav-btn:hover {
  color: #fff;
  border-color: #333;
}

.lp-nav-btn--miner {
  color: #22c55e;
  border-color: #1a3a27;
}

.lp-nav-btn--miner:hover {
  border-color: #22c55e;
}

.lp-ext {
  font-size: 1.5rem;
  opacity: 0.8;
}

/* ── Hero ─────────────────────────────────────────────── */
.lp-hero {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10rem 2rem 10rem;
  overflow: hidden;
  min-height: 60vh;
}

.lp-hero-inner {
  position: relative;
  z-index: 2;
  max-width: 680px;
  text-align: center;
}

.lp-tag {
  display: inline-block;
  border: 1px solid #1e1e1e;
  color: #22c55e;
  font-size: 1.25rem;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  padding: 0.35rem 0.85rem;
  border-radius: 4px;
  margin-bottom: 4rem;
}

.lp-title {
  font-size: clamp(2rem, 5vw, 3.4rem);
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.01em;
  margin-bottom: 3rem;
  color: #fff;
}

.lp-sub {
  font-size: 1.25rem;
  color: #666;
  line-height: 1.7;
  max-width: 520px;
  margin: 0 auto 5cqmin;
}

.lp-hero-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.lp-cta-primary {
  background: #22c55e;
  color: #000;
  border: none;
  padding: 0.8rem 1.8rem;
  border-radius: 6px;
  font-family: inherit;
  font-size: 1.25rem;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s;
  letter-spacing: 0.03em;
  text-decoration: none;
}

.lp-cta-primary:hover {
  opacity: 0.88;
}

.lp-cta-secondary {
  background: transparent;
  color: #aaa;
  border: 1px solid #1e1e1e;
  padding: 0.8rem 1.8rem;
  border-radius: 6px;
  font-family: inherit;
  font-size: 1.25rem;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.15s, border-color 0.15s;
}

.lp-cta-secondary:hover {
  color: #fff;
  border-color: #333;
}

/* Subtle grid background */
.lp-grid-bg {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  pointer-events: none;
  z-index: 1;
}

.lp-grid-line {
  border-right: 1px solid #0c0c0c;
}

/* ── Feature cards ───────────────────────────────────── */
.lp-features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1px;
  background: #111;
  border-top: 1px solid #111;
  border-bottom: 1px solid #111;
}

.lp-feature-card {
  background: #000;
  padding: 2.5rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.lp-feature-icon {
  font-size: 1.6rem;
  color: #22c55e;
  line-height: 1;
}

.lp-feature-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #fff;
  letter-spacing: 0.03em;
}

.lp-feature-desc {
  font-size: 1.25rem;
  color: #555;
  line-height: 1.65;
}

/* ── Stat strip ──────────────────────────────────────── */
.lp-stat-strip {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 1.5rem;
  padding: 2rem;
  border-bottom: 1px solid #111;
}

.lp-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
}

.lp-stat-label {
  font-size: 0.7rem;
  color: #444;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.lp-stat-value {
  font-size: 1.25rem;
  color: #aaa;
}

.lp-stat-sep {
  color: #222;
  font-size: 1.2rem;
}

/* ── Footer ──────────────────────────────────────────── */
.lp-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  padding: 2rem;
}

.lp-footer-link {
  color: #333;
  font-size: 0.8rem;
  text-decoration: none;
  transition: color 0.15s;
}

.lp-footer-link:hover {
  color: #888;
}
</style>
