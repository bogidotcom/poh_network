<template>
              <svg viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="240" height="200" rx="12" fill="#090909" stroke="#1a1a1a"/>
                <!-- grid lines -->
                <line x1="20" y1="40"  x2="220" y2="40"  stroke="#1a1a1a" stroke-width="1"/>
                <line x1="20" y1="80"  x2="220" y2="80"  stroke="#1a1a1a" stroke-width="1"/>
                <line x1="20" y1="120" x2="220" y2="120" stroke="#1a1a1a" stroke-width="1"/>
                <line x1="20" y1="160" x2="220" y2="160" stroke="#1a1a1a" stroke-width="1"/>
                <!-- label -->
                <!-- candle 1 — bot wash trade (red) -->
                <line x1="48"  y1="55"  x2="48"  y2="45"  stroke="#ef4444" stroke-width="1.5">
                  <animate attributeName="y1" values="100;55" dur="0.4s" begin="0.2s" fill="freeze"/>
                  <animate attributeName="y2" values="100;45" dur="0.4s" begin="0.2s" fill="freeze"/>
                </line>
                <rect x="40" y="60" width="16" height="35" rx="1" fill="#1a0808" stroke="#ef4444" stroke-width="1.2">
                  <animate attributeName="y" values="95;60" dur="0.4s" begin="0.2s" fill="freeze"/>
                  <animate attributeName="height" values="0;35" dur="0.4s" begin="0.2s" fill="freeze"/>
                </rect>
                <line x1="48"  y1="95"  x2="48"  y2="108" stroke="#ef4444" stroke-width="1.5">
                  <animate attributeName="y1" values="100;95"  dur="0.2s" begin="0.5s" fill="freeze"/>
                  <animate attributeName="y2" values="100;108" dur="0.2s" begin="0.5s" fill="freeze"/>
                </line>
                <!-- candle 2 — bot (red) -->
                <line x1="80" y1="50" x2="80" y2="42" stroke="#ef4444" stroke-width="1.5">
                  <animate attributeName="y1" values="100;50" dur="0.4s" begin="0.45s" fill="freeze"/>
                  <animate attributeName="y2" values="100;42" dur="0.4s" begin="0.45s" fill="freeze"/>
                </line>
                <rect x="72" y="55" width="16" height="40" rx="1" fill="#1a0808" stroke="#ef4444" stroke-width="1.2">
                  <animate attributeName="y" values="95;55" dur="0.4s" begin="0.45s" fill="freeze"/>
                  <animate attributeName="height" values="0;40" dur="0.4s" begin="0.45s" fill="freeze"/>
                </rect>
                <line x1="80" y1="95" x2="80" y2="110" stroke="#ef4444" stroke-width="1.5">
                  <animate attributeName="y1" values="100;95"  dur="0.2s" begin="0.75s" fill="freeze"/>
                  <animate attributeName="y2" values="100;110" dur="0.2s" begin="0.75s" fill="freeze"/>
                </line>
                <!-- candle 3 — real (green) -->
                <line x1="112" y1="72" x2="112" y2="58" stroke="#22c55e" stroke-width="1.5">
                  <animate attributeName="y1" values="100;72" dur="0.4s" begin="0.7s" fill="freeze"/>
                  <animate attributeName="y2" values="100;58" dur="0.4s" begin="0.7s" fill="freeze"/>
                </line>
                <rect x="104" y="76" width="16" height="28" rx="1" fill="#0d1a0d" stroke="#22c55e" stroke-width="1.2">
                  <animate attributeName="y" values="100;76" dur="0.4s" begin="0.7s" fill="freeze"/>
                  <animate attributeName="height" values="0;28" dur="0.4s" begin="0.7s" fill="freeze"/>
                </rect>
                <line x1="112" y1="104" x2="112" y2="115" stroke="#22c55e" stroke-width="1.5">
                  <animate attributeName="y1" values="100;104" dur="0.2s" begin="0.9s" fill="freeze"/>
                  <animate attributeName="y2" values="100;115" dur="0.2s" begin="0.9s" fill="freeze"/>
                </line>
                <!-- candle 4 — real (green) -->
                <line x1="144" y1="65" x2="144" y2="52" stroke="#22c55e" stroke-width="1.5">
                  <animate attributeName="y1" values="100;65" dur="0.4s" begin="0.9s" fill="freeze"/>
                  <animate attributeName="y2" values="100;52" dur="0.4s" begin="0.9s" fill="freeze"/>
                </line>
                <rect x="136" y="70" width="16" height="32" rx="1" fill="#0d1a0d" stroke="#22c55e" stroke-width="1.2">
                  <animate attributeName="y" values="100;70" dur="0.4s" begin="0.9s" fill="freeze"/>
                  <animate attributeName="height" values="0;32" dur="0.4s" begin="0.9s" fill="freeze"/>
                </rect>
                <line x1="144" y1="102" x2="144" y2="112" stroke="#22c55e" stroke-width="1.5">
                  <animate attributeName="y1" values="100;102" dur="0.2s" begin="1.1s" fill="freeze"/>
                  <animate attributeName="y2" values="100;112" dur="0.2s" begin="1.1s" fill="freeze"/>
                </line>
                <!-- candle 5 — real (green) -->
                <line x1="176" y1="58" x2="176" y2="46" stroke="#22c55e" stroke-width="1.5">
                  <animate attributeName="y1" values="100;58" dur="0.4s" begin="1.1s" fill="freeze"/>
                  <animate attributeName="y2" values="100;46" dur="0.4s" begin="1.1s" fill="freeze"/>
                </line>
                <rect x="168" y="62" width="16" height="38" rx="1" fill="#0d1a0d" stroke="#22c55e" stroke-width="1.2">
                  <animate attributeName="y" values="100;62" dur="0.4s" begin="1.1s" fill="freeze"/>
                  <animate attributeName="height" values="0;38" dur="0.4s" begin="1.1s" fill="freeze"/>
                </rect>
                <line x1="176" y1="100" x2="176" y2="115" stroke="#22c55e" stroke-width="1.5">
                  <animate attributeName="y1" values="100;100" dur="0.2s" begin="1.3s" fill="freeze"/>
                  <animate attributeName="y2" values="100;115" dur="0.2s" begin="1.3s" fill="freeze"/>
                </line>
                <!-- scan line sweep -->
                <line x1="20" y1="30" x2="20" y2="165" stroke="#22c55e44" stroke-width="1">
                  <animate attributeName="x1" values="20;220;220" dur="2s" begin="0s" repeatCount="indefinite"/>
                  <animate attributeName="x2" values="20;220;220" dur="2s" begin="0s" repeatCount="indefinite"/>
                </line>
                <!-- bot label -->
                <text x="32" y="140" fill="#ef444480" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.8s" fill="freeze"/>BOT</text>
                <text x="64" y="140" fill="#ef444480" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.9s" fill="freeze"/>BOT</text>
                <text x="98" y="140" fill="#22c55e80" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.1s" fill="freeze"/>REAL</text>
                <text x="130" y="140" fill="#22c55e80" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.2s" fill="freeze"/>REAL</text>
                <text x="162" y="140" fill="#22c55e80" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.3s" fill="freeze"/>REAL</text>
                <!-- baseline -->
                <line x1="20" y1="160" x2="220" y2="160" stroke="#888" stroke-width="1"/>
              </svg>
</template>
