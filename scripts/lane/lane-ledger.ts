import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { stamped_memo } from '#scripts/lib/stamped-memo'
import { lane_ledger_schema, type LedgerEntry } from './lane-ledger-schema'
import { lane_ledger_write } from './lane-ledger-write'

// The measurement ledger read back: every line `lane-ledger-write.ts` appended, for `josh lane:stats`,
// `lane:breakdown`, `run:board` and the other measurements. The writers import that leaf, never this
// module, so a change to the reading reaches only the suites that read (joshuafolkken/kit#5202).

const { entry_schema } = lane_ledger_schema
const { LINE_SEPARATOR } = lane_ledger_write

function parse_line(line: string): LedgerEntry | undefined {
	return entry_schema.safeParse(json_value.parse_or_undefined(line)).data
}

function is_present(entry: LedgerEntry | undefined): entry is LedgerEntry {
	return entry !== undefined
}

function parse_entries(path: string): ReadonlyArray<LedgerEntry> {
	const raw = stamp_file.read_stamp_text(path)

	if (raw === undefined) return []

	return raw
		.split(LINE_SEPARATOR)
		.map((line) => parse_line(line.trim()))
		.filter(is_present)
}

// Each ledger's entries, parsed again only once the file itself has changed (joshuafolkken/kit#4263).
const parsed_ledgers = stamped_memo.create<ReadonlyArray<LedgerEntry>>()

// Every entry, oldest first. A malformed line — a write cut short — is skipped rather than making the
// whole ledger unreadable, and an absent or unowned file is an empty ledger.
function read_entries(path: string): ReadonlyArray<LedgerEntry> {
	return parsed_ledgers.of(path, stamped_memo.file_stamp(path), () => parse_entries(path))
}

// The names a reader looks entries up by and the ledger it reads, the writer's own.
const {
	CI_WAIT_STAGE,
	CODERABBIT_RATE_LIMIT_STAGE,
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
	RoundOneEntry,
	RoundTwoEntry,
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
