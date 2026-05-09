<template>
            <svg viewBox="0 0 420 320" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="10" y="10" width="400" height="230" rx="14" fill="#090909" stroke="#1a1a1a"/>
              <!-- Signals in -->
              <text x="28" y="42" fill="#808080" font-size="9" font-family="monospace">SIGNALS</text>
              <rect x="28" y="52" width="140" height="22" rx="4" fill="#0d1a0d" stroke="#1a3a1a"/>
              <text x="36" y="67" fill="#22c55e" font-size="9" font-family="monospace">✓ ETH balance</text>
              <rect x="28" y="78" width="140" height="22" rx="4" fill="#0d1a0d" stroke="#1a3a1a"/>
              <text x="36" y="93" fill="#22c55e" font-size="9" font-family="monospace">✓ ENS registered</text>
              <rect x="28" y="104" width="140" height="22" rx="4" fill="#1a0d0d" stroke="#3a1a1a"/>
              <text x="36" y="119" fill="#ef4444" font-size="9" font-family="monospace">✗ Galxe profile</text>
              <rect x="28" y="130" width="140" height="22" rx="4" fill="#0d1a0d" stroke="#1a3a1a"/>
              <text x="36" y="145" fill="#22c55e" font-size="9" font-family="monospace">✓ PAXG holder</text>
              <rect x="28" y="156" width="140" height="22" rx="4" fill="#0d1a0d" stroke="#1a3a1a"/>
              <text x="36" y="171" fill="#22c55e" font-size="9" font-family="monospace">✓ Farcaster</text>
              <!-- Arrow to AI -->
              <path d="M168 130 Q210 130 210 130" stroke="#222" stroke-width="1.5" marker-end="url(#arr)"/>
              <defs>
                <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#808080"/>
                </marker>
              </defs>
              <!-- AI node -->
              <circle cx="215" cy="130" r="0" fill="#111" stroke="#222">
                <animate attributeName="r" values="0;22" dur="0.4s" begin="0.5s" fill="freeze"/>
              </circle>
              <text x="210" y="126" fill="#fff" font-size="8" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.8s" fill="freeze"/>AI
              </text>
              <text x="199" y="138" fill="#808080" font-size="7" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.8s" fill="freeze"/>thinking</text>
              <!-- Thinking dots -->
              <!-- <circle cx="202" cy="148" r="2" fill="#808080" opacity="0">
                <animate attributeName="opacity" values="0;0;1;0" dur="1.2s" begin="0.9s" repeatCount="indefinite"/>
              </circle>
              <circle cx="210" cy="148" r="2" fill="#808080" opacity="0">
                <animate attributeName="opacity" values="0;0;0;1;0" dur="1.2s" begin="0.9s" repeatCount="indefinite"/>
              </circle>
              <circle cx="218" cy="148" r="2" fill="#808080" opacity="0">
                <animate attributeName="opacity" values="0;0;0;0;1;0" dur="1.2s" begin="0.9s" repeatCount="indefinite"/>
              </circle> -->
              <!-- Verdict card -->
              <rect x="250" y="72" width="148" height="120" rx="8" fill="#0f1f0f" stroke="#1a4a1a" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.4s" begin="2.2s" fill="freeze"/>
              </rect>
              <text x="264" y="96" fill="#22c55e" font-size="11" font-weight="600" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="2.4s" fill="freeze"/>HUMAN
              </text>
              <text x="264" y="114" fill="#808080" font-size="8" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="2.5s" fill="freeze"/>confidence</text>
              <!-- Confidence bar -->
              <rect x="264" y="120" width="112" height="6" rx="3" fill="#111" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.1s" begin="2.6s" fill="freeze"/>
              </rect>
              <rect x="264" y="120" width="0" height="6" rx="3" fill="#22c55e" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.1s" begin="2.6s" fill="freeze"/>
                <animate attributeName="width" values="0;87" dur="0.8s" begin="2.6s" fill="freeze"/>
              </rect>
              <text x="264" y="146" fill="#fff" font-size="7.5" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="2.7s" fill="freeze"/>87% · 4/5 signals pass</text>
              <text x="264" y="162" fill="#808080" font-size="7" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="2.8s" fill="freeze"/>PAXG holder is</text>
              <text x="264" y="174" fill="#808080" font-size="7" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="2.8s" fill="freeze"/>strongest signal.</text>
            </svg>
</template>
