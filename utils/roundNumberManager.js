// Shared round number manager to ensure unique sequential round numbers
// across all round creation operations

let currentRoundNumber = 0;

/**
 * Get and increment the next round number
 * @returns {number} The next unique round number
 */
export function getNextRoundNumber() {
    currentRoundNumber++;
    return currentRoundNumber;
}

/**
 * Reset round number (useful for testing)
 */
export function resetRoundNumber() {
    currentRoundNumber = 0;
}

/**
 * Get current round number without incrementing
 */
export function getCurrentRoundNumber() {
    return currentRoundNumber;
}
