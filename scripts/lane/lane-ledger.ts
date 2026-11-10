import type { LedgerEntry } from './lane-ledger-schema'
import { lane_ledger_tail } from './lane-ledger-tail'
import { lane_ledger_write } from './lane-ledger-write'

// The measurement ledger read back: every line `lane-ledger-write.ts` appended, for `josh lane:stats`,
// `lane:breakdown`, `run:board` and the other measurements. The writers import that leaf, never this
// module, so a change to the reading reaches only the suites that read (joshuafolkken/kit#5202).

// Every entry, oldest first. A malformed line — a write cut short — is skipped rather than making the
// whole ledger unreadable, and an absent or unowned file is an empty ledger. An unchanged file is not
// parsed again (joshuafolkken/kit#4263), and an appended one only past what was parsed
// (joshuafolkken/kit#7012).
function read_entries(path: string): ReadonlyArray<LedgerEntry> {
	return lane_ledger_tail.read(path)
}

// The names a reader looks entries up by and the ledger it reads, the writer's own.
const {
	CI_WAIT_STAGE,
	CODERABBIT_RATE_LIMIT_STAGE,
	CODERABBIT_RETRIGGER_STAGE,
	CODERABBIT_WAIT_STAGE,
	KIND,
	PRE_DETACH_STAGE,
	ROUND_ONE_REUSED,
	target,
	target_of,
} = lane_ledger_write

const lane_ledger = {
	CI_WAIT_STAGE,
	CODERABBIT_RATE_LIMIT_STAGE,
	CODERABBIT_RETRIGGER_STAGE,
	CODERABBIT_WAIT_STAGE,
	KIND,
	PRE_DETACH_STAGE,
	ROUND_ONE_REUSED,
	read_entries,
	target,
	target_of,
}

export type {
	CoreWaitEntry,
	CoreWaitRecord,
	DispatchEntry,
	GateCheckRecord,
	GateEntry,
	HeldEntry,
	LaneStateChangeEntry,
	LedgerEntry,
	LoadEntry,
	MergeEntry,
	OfferableEntry,
	OverlapEntry,
	OverlapRecord,
	PushMissEntry,
	RoundOneEntry,
	RoundTwoEntry,
	ShipLapEntry,
	SplitFiledEntry,
	SplitNoticeEntry,
	StageEntry,
	StopEntry,
	StopRecord,
	TestPinnedEntry,
	TestPinnedRecord,
	TestRelatedEntry,
	TestRelatedRecord,
	UnitFileRecord,
	UnitFilesEntry,
	UnplannedNoticeEntry,
} from './lane-ledger-schema'
export { lane_ledger }
