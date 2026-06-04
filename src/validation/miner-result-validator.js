/**
 * Miner Result Validator (used by the main backend)
 *
 * Re-validates results coming from the network before accepting them.
 * Should stay in sync with the logic in poh-miner-network/src/validation/result-validator.js
 */

async function validateMinerResult(result) {
  const errors = [];

  if (!result) {
    return { isValid: false, errors: ['No result provided'] };
  }

  if (!result.verdict) errors.push('Missing verdict');
  if (!result.methodsHash) errors.push('Missing methodsHash');

  const signalsCount = result.signalsUsed?.length || result.methodsCount || 0;
  if (signalsCount < 20) {
    errors.push(`Too few signals evaluated: only ${signalsCount}`);
  }

  // TODO: In the future also check against live signals from /miner/signals/live

  return {
    isValid: errors.length === 0,
    errors,
  };
}

module.exports = { validateMinerResult };
