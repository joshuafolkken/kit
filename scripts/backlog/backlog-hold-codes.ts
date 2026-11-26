// The driver's ledger hold codes the writers build and `backlog-hold-text.ts` reads back (joshuafolkken/kit#7287).
// A leaf, so the stall notice and the board read them without importing the driver.

const OFFER_PREFIX = 'offer'
const HAND_BACK_PREFIX = 'hand-back'
const REASON_SEPARATOR = ':'
// The `hold` reason a pass held by a Claude usage limit records (`backlog-drive.ts`).
const USAGE_LIMIT_REASON = 'usage-limit'
// The `hold` reason a pass held by memory records (`backlog-drive-memory.ts`).
const MEMORY_REASON = 'memory'
// The `hold` reason a pass held by a `main:sync` a dirty primary checkout refused records
// (`run-merge-sync-held.ts`, joshuafolkken/kit#9034).
const MAIN_DIRTY_REASON = 'main-dirty'
// Before a hand-back mark's reason no driver recorded (`lane-hand-back-held.ts`).
const DRIVERLESS_PREFIX = 'driverless:'
// The offer verdict that started nothing because nothing could start (`backlog-drive.ts`).
const WATCH_VERDICT = 'watch'
// The hand-back reason of a window that closed after a `watch` offer: the backlog had drained
// (joshuafolkken/kit#7510), told apart from a window that closed mid-work.
const DRAINED_REASON = 'drained'
// The `wait` details of a named run (`backlog-drive-named.ts`, joshuafolkken/kit#8863): an `--only`
// run waits on its last named issue to close (`only`). `named:<N>` — a named issue in flight holding
// the free lanes — is no longer emitted, since the named issues run side by side
// (joshuafolkken/kit#8953); it is kept to read old logs.
const NAMED_WAIT = 'named'
const ONLY_WAIT = 'only'

const backlog_hold_codes = {
	DRAINED_REASON,
	DRIVERLESS_PREFIX,
	HAND_BACK_PREFIX,
	MAIN_DIRTY_REASON,
	MEMORY_REASON,
	NAMED_WAIT,
	OFFER_PREFIX,
	ONLY_WAIT,
	REASON_SEPARATOR,
	USAGE_LIMIT_REASON,
	WATCH_VERDICT,
}

export { backlog_hold_codes }
