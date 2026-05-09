<template>
            <svg viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="240" height="200" rx="12" fill="#090909" stroke="#1a1a1a"/>
              <text x="20" y="22" fill="#666" font-size="8" font-family="monospace">SDK · TOOLING</text>

              <!-- request block -->
              <rect x="14" y="30" width="100" height="76" rx="5" fill="#0d0d0d" stroke="#1e1e1e"/>
              <text x="20" y="43" fill="#3b82f6" font-size="6.5" font-family="monospace">POST /checker</text>
              <text x="20" y="55" fill="#ffffff30" font-size="6" font-family="monospace">{</text>
              <text x="26" y="65" fill="#ffffff40" font-size="6" font-family="monospace">"input":</text>
              <text x="26" y="74" fill="#22c55e80" font-size="6" font-family="monospace">"0xd8dA6B…"</text>
              <text x="26" y="83" fill="#ffffff40" font-size="6" font-family="monospace">"apiKey": "…"</text>
              <text x="20" y="92" fill="#ffffff30" font-size="6" font-family="monospace">}</text>

              <!-- arrow -->
              <line x1="118" y1="68" x2="130" y2="68" stroke="#3b82f660" stroke-width="1.2" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.8s" fill="freeze"/>
              </line>
              <polygon points="130,64 136,68 130,72" fill="#3b82f660" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.8s" fill="freeze"/>
              </polygon>
              <!-- animated packet -->
              <circle cx="118" cy="68" r="2.5" fill="#3b82f6" opacity="0">
                <animate attributeName="opacity" values="0;1;1;0" dur="0.6s" begin="1.0s" repeatCount="indefinite"/>
                <animate attributeName="cx" values="118;134;134" dur="0.6s" begin="1.0s" repeatCount="indefinite"/>
              </circle>

              <!-- response block -->
              <rect x="136" y="30" width="90" height="76" rx="5" fill="#0d1a0d" stroke="#22c55e" stroke-width="0.8" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.2s" fill="freeze"/>
              </rect>
              <text x="142" y="43" fill="#22c55e80" font-size="6.5" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.2s" fill="freeze"/>200 OK</text>
              <text x="142" y="55" fill="#ffffff30" font-size="6" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.3s" fill="freeze"/>{</text>
              <text x="148" y="65" fill="#22c55e" font-size="6" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.4s" fill="freeze"/>"HUMAN"</text>
              <text x="148" y="74" fill="#ffffff50" font-size="6" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.5s" fill="freeze"/>0.87</text>
              <text x="148" y="83" fill="#ffffff30" font-size="6" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.6s" fill="freeze"/>9 signals</text>
              <text x="142" y="92" fill="#ffffff30" font-size="6" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.7s" fill="freeze"/>}</text>

              <!-- SDK rows -->
              <text x="14" y="124" fill="#444" font-size="6" font-family="monospace">AVAILABLE SDKs</text>

              <rect x="14" y="130" width="64" height="18" rx="3" fill="#111" stroke="#1e1e1e" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.2s" begin="1.8s" fill="freeze"/>
              </rect>
              <text x="24" y="142" fill="#f7df1e80" font-size="7" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.2s" begin="1.8s" fill="freeze"/>JS / TS</text>

              <rect x="84" y="130" width="64" height="18" rx="3" fill="#111" stroke="#1e1e1e" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.2s" begin="2.0s" fill="freeze"/>
              </rect>
              <text x="97" y="142" fill="#3b82f680" font-size="7" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.2s" begin="2.0s" fill="freeze"/>Python</text>

              <rect x="154" y="130" width="72" height="18" rx="3" fill="#111" stroke="#1e1e1e" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.2s" begin="2.2s" fill="freeze"/>
              </rect>
              <text x="165" y="142" fill="#00ADD880" font-size="7" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.2s" begin="2.2s" fill="freeze"/>Go / Rust</text>

              <!-- bottom: REST note -->
              <text x="14" y="168" fill="#ffffff20" font-size="6.5" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.4s" begin="2.4s" fill="freeze"/>or raw REST — no SDK needed</text>
              <text x="14" y="180" fill="#22c55e40" font-size="6.5" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.4s" begin="2.5s" fill="freeze"/>proofofhuman.ge</text>
            </svg>
</template>
