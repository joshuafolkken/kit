import type { LedgerEntry } from './lane-ledger'

// The ledger samples an observation wait can name (`issue-observation-gate.ts`), counted over every
// early-push line (joshuafolkken/kit#7503). A line recorded before it carried `slots` never counts.
const MULTI_SLOT_EARLY_PUSH = 'multi-slot-early-push'
const PUSHED = 'pushed'
const MULTI_SLOT_MINIMUM = 2

// Early pushes that reached the remote from a round with more than one review slot.
function multi_slot_pushed(entries: ReadonlyArray<LedgerEntry>): number {
	return entries.filter(
		(entry) =>
			entry.kind === 'early-push' &&
			entry.result === PUSHED &&
			(entry.slots ?? 0) >= MULTI_SLOT_MINIMUM,
	).length
}

const lane_early_push_count = { MULTI_SLOT_EARLY_PUSH, multi_slot_pushed }

export { lane_early_push_count }
