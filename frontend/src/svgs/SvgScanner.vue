<template>
            <svg viewBox="0 0 420 320" fill="none" xmlns="http://www.w3.org/2000/svg">
              <!-- Card background -->
              <rect x="10" y="10" width="400" height="300" rx="14" fill="#090909" stroke="#1a1a1a"/>
              <!-- Input bar -->
              <rect x="28" y="30" width="310" height="36" rx="7" fill="#111" stroke="#222"/>
              <text x="42" y="53" fill="#808080" font-size="11" font-family="monospace">6bvB3PTz48wozyPJeuTB77axexWu9MfU...</text>
              <rect x="346" y="30" width="52" height="36" rx="7" fill="#161616" stroke="#222"/>
              <text x="355" y="53" fill="#666" font-size="11" font-family="monospace">Scan</text>
              <!-- Divider -->
              <line x1="28" y1="80" x2="392" y2="80" stroke="#161616"/>
              <!-- Method rows — animated in sequence -->
              <g class="scan-row-1">
                <rect x="28" y="90" width="364" height="28" rx="5" fill="#0d0d0d"/>
                <circle cx="42" cy="104" r="4" fill="#22c55e"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.4s" fill="freeze"/></circle>
                <text x="54" y="108" fill="#808080" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.4s" fill="freeze"/>SOL balance &gt; 0.01</text>
                <text x="346" y="108" fill="#22c55e" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.4s" fill="freeze"/>✓</text>
              </g>
              <g class="scan-row-2">
                <rect x="28" y="122" width="364" height="28" rx="5" fill="#0d0d0d"/>
                <circle cx="42" cy="136" r="4" fill="#22c55e"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.75s" fill="freeze"/></circle>
                <text x="54" y="140" fill="#808080" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.75s" fill="freeze"/>SNS name registered</text>
                <text x="346" y="140" fill="#22c55e" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.75s" fill="freeze"/>✓</text>
              </g>
              <g>
                <rect x="28" y="154" width="364" height="28" rx="5" fill="#0d0d0d"/>
                <circle cx="42" cy="168" r="4" fill="#ef4444"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.05s" fill="freeze"/></circle>
                <text x="54" y="172" fill="#808080" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.05s" fill="freeze"/>Farcaster profile</text>
                <text x="340" y="172" fill="#ef4444" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.05s" fill="freeze"/>✗</text>
              </g>
              <g>
                <rect x="28" y="186" width="364" height="28" rx="5" fill="#0d0d0d"/>
                <circle cx="42" cy="200" r="4" fill="#22c55e"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.35s" fill="freeze"/></circle>
                <text x="54" y="204" fill="#808080" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.35s" fill="freeze"/>Galxe identity</text>
                <text x="346" y="204" fill="#22c55e" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.35s" fill="freeze"/>✓</text>
              </g>
              <g>
                <rect x="28" y="218" width="364" height="28" rx="5" fill="#0d0d0d"/>
                <circle cx="42" cy="232" r="4" fill="#22c55e"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.6s" fill="freeze"/></circle>
                <text x="54" y="236" fill="#808080" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.6s" fill="freeze"/>Artrade tokenised real-world art marketplace...</text>
                <text x="346" y="236" fill="#22c55e" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.6s" fill="freeze"/>✓</text>
              </g>
              <!-- Verdict badge -->
              <rect x="28" y="260" width="364" height="38" rx="8" fill="#0f1f0f" stroke="#1a4a1a">
                <animate attributeName="opacity" values="0;1" dur="0.4s" begin="2s" fill="freeze"/>
                <animate attributeName="stroke" values="#111;#22c55e;#1a4a1a" dur="0.6s" begin="2s" fill="freeze"/>
              </rect>
              <text x="115" y="284" fill="#22c55e" font-size="13" font-weight="600" font-family="monospace">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="2.1s" fill="freeze"/>
                HUMAN · 87% confidence
              </text>
            </svg>
</template>
