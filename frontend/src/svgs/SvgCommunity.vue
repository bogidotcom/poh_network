<template>
            <svg viewBox="0 0 420 320" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="10" y="10" width="400" height="300" rx="14" fill="#090909" stroke="#1a1a1a"/>
              <!-- Method card -->
              <rect x="28" y="28" width="364" height="160" rx="9" fill="#0d0d0d" stroke="#1e1e1e"/>
              <text x="44" y="52" fill="#666" font-size="9" font-family="monospace">METHOD #47</text>
              <text x="44" y="70" fill="#ddd" font-size="12" font-family="sans-serif">Artrade tokenised real-world art marketplace on Solana</text>
              <text x="44" y="88" fill="#808080" font-size="9" font-family="monospace">balanceOf(address) &gt; 0  ·  Ethereum</text>
              <!-- Score bar -->
              <text x="44" y="112" fill="#808080" font-size="8" font-family="monospace">community score</text>
              <rect x="44" y="118" width="220" height="5" rx="2" fill="#111"/>
              <rect x="44" y="118" width="148" height="5" rx="2" fill="#22c55e" id="score-bar"/>
              <text x="274" y="122" fill="#22c55e" font-size="8" font-family="monospace">+6.7</text>
              <!-- Vote buttons -->
              <rect x="44" y="148" width="82" height="30" rx="6" fill="#0a1f0a" stroke="#1a3a1a"/>
              <text x="66" y="168" fill="#22c55e" font-size="11" font-family="monospace">✓ Human</text>
              <rect x="134" y="148" width="74" height="30" rx="6" fill="#111" stroke="#222"/>
              <text x="149" y="168" fill="#ef4444" font-size="11" font-family="monospace">✗ Skip</text>
              <!-- Animated vote + score update -->
              <rect x="44" y="148" width="82" height="30" rx="6" fill="#22c55e" opacity="0">
                <animate attributeName="opacity" values="0;0.18;0" dur="0.6s" begin="1.8s" repeatCount="indefinite" repeatDur="6s"/>
              </rect>
              <rect x="44" y="118" width="0" height="5" rx="2" fill="#22c55e" opacity="0">
                <animate attributeName="opacity" values="0;1;1;0" dur="3s" begin="2.2s" repeatCount="indefinite" repeatDur="6s"/>
                <animate attributeName="width" values="148;164;164;148" dur="3s" begin="2.2s" repeatCount="indefinite" repeatDur="6s"/>
              </rect>
              <!-- Feedback textarea -->
              <rect x="28" y="202" width="364" height="50" rx="7" fill="#080808" stroke="#161616"/>
              <text x="44" y="224" fill="#808080" font-size="9" font-family="monospace">Interest in the real world art marketplace...</text>
              <!-- Submit row -->
              <text x="44" y="272" fill="#808080" font-size="9" font-family="monospace">342 votes cast  ·  stake weight: 1.4×</text>
              <rect x="330" y="256" width="62" height="26" rx="6" fill="#161616" stroke="#222"/>
              <text x="341" y="273" fill="#888" font-size="9" font-family="monospace">Next →</text>
            </svg>
</template>
