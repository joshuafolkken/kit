// The driver's ledger hold codes the writers build and `backlog-hold-text.ts` reads back (joshuafolkken/kit#7287).
// A leaf, so the stall notice and the board read them without importing the driver.

const OFFER_PREFIX = 'offer'
const HAND_BACK_PREFIX = 'hand-back'
const REASON_SEPARATOR = ':'
// The `hold` reason a pass held by a Claude usage limit records (`backlog-drive.ts`).
const USAGE_LIMIT_REASON = 'usage-limit'
// The `hold` reason a pass held by memory records (`backlog-drive-memory.ts`).
const MEMORY_REASON = 'memory'
// Before a hand-back mark's reason no driver recorded (`lane-hand-back-held.ts`).
const DRIVERLESS_PREFIX = 'driverless:'

const backlog_hold_codes = {
	DRIVERLESS_PREFIX,
	HAND_BACK_PREFIX,
	MEMORY_REASON,
	OFFER_PREFIX,
	REASON_SEPARATOR,
	USAGE_LIMIT_REASON,
}

export { backlog_hold_codes }
