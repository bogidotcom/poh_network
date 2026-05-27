<template>
  <svg viewBox="0 0 440 340" fill="none" xmlns="http://www.w3.org/2000/svg">

    <!-- ── Background panel ── -->
    <rect x="8" y="8" width="424" height="324" rx="14" fill="#090909" stroke="#1c1c1c"/>

    <!-- ── Signal card (what the community is voting on) ── -->
    <rect x="24" y="22" width="392" height="66" rx="8" fill="#0d0d0d" stroke="#1e1e1e"/>
    <text x="38" y="40" fill="#4b5563" font-size="8" font-family="monospace" letter-spacing="0.1em">DETECTION SIGNAL</text>
    <text x="38" y="57" fill="#d1d5db" font-size="11" font-family="sans-serif" font-weight="600">Owns an ENS domain (.eth name registered)</text>
    <text x="38" y="73" fill="#6366f1" font-size="8" font-family="monospace">evm  ·  chainId 1  ·  ENS Registry  ·  balanceOf &gt; 0</text>
    <!-- Score pill -->
    <rect x="348" y="32" width="54" height="20" rx="10" fill="#0f2010" stroke="#1a3a1a"/>
    <text x="375" y="46" fill="#22c55e" font-size="9" font-family="monospace" text-anchor="middle">+4.2 ↑</text>

    <!-- ── Voter rows ── -->
    <!-- Row 1 -->
    <g opacity="1">
      <circle cx="44" cy="116" r="10" fill="#1a1a2e" stroke="#2d2d4a"/>
      <text x="44" y="120" fill="#818cf8" font-size="8" font-family="monospace" text-anchor="middle">0x</text>
      <text x="62"  y="119" fill="#9ca3af" font-size="9" font-family="monospace">0xd8dA…045  ·  stake 2.0×</text>
      <rect x="314" y="107" width="64" height="20" rx="5" fill="#0a1f0a" stroke="#1a3a1a"/>
      <text x="346" y="121" fill="#22c55e" font-size="10" font-family="monospace" text-anchor="middle">✓ human</text>
    </g>

    <!-- Row 2 -->
    <g opacity="1">
      <circle cx="44" cy="148" r="10" fill="#1e1a2e" stroke="#35294a"/>
      <text x="44" y="152" fill="#a78bfa" font-size="8" font-family="monospace" text-anchor="middle">0x</text>
      <text x="62"  y="151" fill="#9ca3af" font-size="9" font-family="monospace">0x4b20…02db  ·  stake 1.4×</text>
      <rect x="314" y="139" width="64" height="20" rx="5" fill="#0a1f0a" stroke="#1a3a1a"/>
      <text x="346" y="153" fill="#22c55e" font-size="10" font-family="monospace" text-anchor="middle">✓ human</text>
    </g>

    <!-- Row 3 (animated — vote appearing) -->
    <g>
      <circle cx="44" cy="180" r="10" fill="#1a1e2e" stroke="#2a304a"/>
      <text x="44" y="184" fill="#60a5fa" font-size="8" font-family="monospace" text-anchor="middle">0x</text>
      <text x="62"  y="183" fill="#9ca3af" font-size="9" font-family="monospace">0xa692…e1a  ·  stake 1.1×</text>
      <!-- vote button fading in -->
      <rect x="314" y="171" width="64" height="20" rx="5" fill="#0a1f0a" stroke="#1a3a1a" opacity="0">
        <animate attributeName="opacity" values="0;0;1;1" dur="3s" begin="1.4s" repeatCount="indefinite" repeatDur="5s"/>
      </rect>
      <text x="346" y="185" fill="#22c55e" font-size="10" font-family="monospace" text-anchor="middle" opacity="0">
        ✓ human
        <animate attributeName="opacity" values="0;0;1;1" dur="3s" begin="1.4s" repeatCount="indefinite" repeatDur="5s"/>
      </text>
    </g>

    <!-- Row 4 (pending) -->
    <g opacity="0.5">
      <circle cx="44" cy="212" r="10" fill="#111" stroke="#222"/>
      <text x="44" y="216" fill="#4b5563" font-size="8" font-family="monospace" text-anchor="middle">0x</text>
      <text x="62"  y="215" fill="#6b7280" font-size="9" font-family="monospace">0x3f5c…c7C5  ·  stake 0.9×</text>
      <rect x="314" y="203" width="64" height="20" rx="5" fill="#111" stroke="#222"/>
      <text x="346" y="217" fill="#4b5563" font-size="9" font-family="monospace" text-anchor="middle">pending…</text>
    </g>

    <!-- ── Divider ── -->
    <line x1="24" y1="236" x2="416" y2="236" stroke="#141414"/>

    <!-- ── Consensus result bar ── -->
    <text x="38"  y="256" fill="#6b7280" font-size="8" font-family="monospace">consensus score</text>
    <text x="390" y="256" fill="#22c55e" font-size="9" font-family="monospace" text-anchor="end">HUMAN SIGNAL</text>

    <!-- Bar track -->
    <rect x="38" y="262" width="364" height="6" rx="3" fill="#111"/>
    <!-- Static filled portion -->
    <rect x="38" y="262" width="224" height="6" rx="3" fill="#22c55e"/>
    <!-- Animated increment as row 3 vote arrives -->
    <rect x="262" y="262" width="0" height="6" rx="3" fill="#22c55e" opacity="0">
      <animate attributeName="opacity" values="0;0;1;1" dur="3s" begin="1.4s" repeatCount="indefinite" repeatDur="5s"/>
      <animate attributeName="width"   values="0;0;28;28"  dur="3s" begin="1.4s" repeatCount="indefinite" repeatDur="5s"/>
    </rect>
    <!-- Score number -->
    <text x="38" y="284" fill="#4b5563" font-size="8" font-family="monospace">0</text>
    <text x="402" y="284" fill="#4b5563" font-size="8" font-family="monospace" text-anchor="end">10</text>
    <text x="220" y="284" fill="#22c55e" font-size="9" font-family="monospace" text-anchor="middle" opacity="1">
      +4.2
      <animate attributeName="textContent" values="+4.2;+4.2;+5.3;+5.3" dur="3s" begin="1.6s" repeatCount="indefinite" repeatDur="5s"/>
    </text>

    <!-- ── Vote count footer ── -->
    <text x="38"  y="314" fill="#374151" font-size="8" font-family="monospace">23 votes cast</text>
    <text x="402" y="314" fill="#374151" font-size="8" font-family="monospace" text-anchor="end">avg weight 1.4×</text>

    <!-- ── Glowing dot — live indicator ── -->
    <circle cx="398" y="42" r="4" fill="#22c55e" opacity="0.8">
      <animate attributeName="opacity" values="0.8;0.2;0.8" dur="2s" repeatCount="indefinite"/>
    </circle>
    <text x="388" y="46" fill="#22c55e" font-size="7" font-family="monospace" text-anchor="end">LIVE</text>
  </svg>
</template>
