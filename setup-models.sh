#!/bin/bash
# =============================================
# POH VPS Model Setup Script (for QVAC)
# Run: bash setup-models.sh
# Tailored for 8 CPU / 32GB RAM VPS using QVAC
# =============================================

set -e

echo "=== POH Model Setup for QVAC VPS ==="

# Recommended models based on your hardware (32GB RAM, 8 CPU, no GPU)
# Using Q4_K_M quants for best speed/quality balance
MODELS=(
  "qwen2.5:14b"     # Fast model - primary for brain
  "qwen2.5:32b"     # Heavy model - for difficult cases (monitor RAM!)
)

if ! command -v qvac &> /dev/null; then
    echo "❌ Error: 'qvac' command not found in PATH."
    echo "   Install QVAC on your VPS first."
    echo "   See: https://qvac.tether.io or your QVAC installation docs."
    exit 1
fi

echo "Checking QVAC models..."

for model in "${MODELS[@]}"; do
    echo ""
    echo "→ Checking for: $model"

    # QVAC CLI varies by version. Try common commands.
    INSTALLED=false

    if qvac models list 2>/dev/null | grep -qi "$model"; then
        INSTALLED=true
    elif qvac list 2>/dev/null | grep -qi "$model"; then
        INSTALLED=true
    fi

    if [ "$INSTALLED" = true ]; then
        echo "   ✅ $model already installed"
    else
        echo "   ⬇️  $model not found. Attempting to pull..."
        if qvac pull "$model" 2>&1; then
            echo "   ✅ Successfully pulled $model"
        else
            echo "   ⚠️  Pull command may have a different syntax for your QVAC version."
            echo "      Common alternatives to try manually:"
            echo "        qvac pull $model"
            echo "        qvac model pull $model"
            echo "        qvac download $model"
            echo ""
            echo "   Please check your QVAC version with 'qvac --version' and adjust."
            # Don't exit - allow partial success
        fi
    fi
done

echo ""
echo "=== Model setup script finished ==="
echo "Recommended next steps:"
echo "1. Copy .env.example to .env and edit values (especially FEE_RECIPIENT, RPC keys)"
echo "2. Start QVAC: qvac serve openai --port 11435"
echo "3. Start backend: node src/server.js"
echo ""
echo "If models failed to install, run the pull commands manually for your QVAC version."