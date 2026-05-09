<template>
              <svg viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="240" height="200" rx="12" fill="#090909" stroke="#1a1a1a"/>
                <!-- left column: bot -->
                <rect x="20" y="35" width="88" height="110" rx="6" fill="#0d0d0d" stroke="#1e1e1e"/>
                <!-- robot head -->
                <rect x="44" y="50" width="40" height="30" rx="3" stroke="#ef4444" stroke-width="1.2" fill="none"/>
                <line x1="64" y1="50" x2="64" y2="44" stroke="#ef4444" stroke-width="1.2"/>
                <line x1="58" y1="44" x2="70" y2="44" stroke="#ef4444" stroke-width="1.2"/>
                <rect x="50" y="58" width="8" height="6" rx="1" stroke="#ef4444" stroke-width="1" fill="none"/>
                <rect x="70" y="58" width="8" height="6" rx="1" stroke="#ef4444" stroke-width="1" fill="none"/>
                <line x1="54" y1="72" x2="74" y2="72" stroke="#ef4444" stroke-width="1"/>
                <!-- bot label -->
                <text x="52" y="100" fill="#ef444480" font-size="8" font-family="monospace">BOT</text>
                <!-- verdict -->
                <text x="34" y="134" fill="#ef4444" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.4s" begin="1.2s" fill="freeze"/>✗ NOT HUMAN</text>

                <!-- right column: human -->
                <rect x="132" y="35" width="88" height="110" rx="6" fill="#0d1a0d" stroke="#1a3a1a"/>
                <!-- human figure -->
                <circle cx="176" cy="62" r="12" stroke="#22c55e" stroke-width="1.2" fill="none"/>
                <path d="M156 108 Q156 86 176 86 Q196 86 196 108" stroke="#22c55e" stroke-width="1.2" fill="none"/>
                <!-- human label -->
                <text x="158" y="122" fill="#22c55e80" font-size="8" font-family="monospace">HUMAN</text>
                <!-- verdict -->
                <text x="138" y="134" fill="#22c55e" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.4s" begin="1.5s" fill="freeze"/>✓ VERIFIED</text>

                <!-- scanning beam -->
                <rect x="20" y="35" width="200" height="4" rx="1" fill="#22c55e22" opacity="0">
                  <animate attributeName="opacity" values="0;1;1;0" dur="2.5s" repeatCount="indefinite"/>
                  <animate attributeName="y" values="35;145;145;35" dur="2.5s" repeatCount="indefinite"/>
                </rect>

                <!-- confidence bar -->
                <text x="20" y="163" fill="#666" font-size="7" font-family="monospace">confidence</text>
                <rect x="20" y="168" width="200" height="4" rx="2" fill="#111"/>
                <rect x="20" y="168" width="0" height="4" rx="2" fill="#22c55e">
                  <animate attributeName="width" values="0;148" dur="1s" begin="1.8s" fill="freeze"/>
                </rect>
                <text x="172" y="175" fill="#22c55e80" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="2.7s" fill="freeze"/>74%</text>
              </svg>
</template>
