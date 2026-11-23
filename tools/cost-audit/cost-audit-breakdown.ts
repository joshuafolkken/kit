import { lane_breakdown, type Breakdown } from '#scripts/lane/lane-breakdown'
import type { LedgerEntry } from '#scripts/lane/lane-ledger'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

// Each lane's breakdown for `josh cost:audit`, built from the records that lane can reach rather than
// the whole history (joshuafolkken/kit#8757): `lane_breakdown.of` filters its input by Issue a dozen
// times over, so handing it the full ledger once per Issue made the audit scale with Issues × ledger.
//
// **The records a lane reaches** are those of its own Issue and of every Issue its events name — a
// yield note names its holder, whose merge and done event end the yield — plus every event naming no
// Issue and every host event (sleep, offline), which each lane's net time takes out. A ledger entry
// naming no Issue number (`startup`, `load`, over half the ledger) is left out: every ledger reader of
// the breakdown matches `entry.issue` against the lane's number. That set is a superset of what the breakdown reads, so each
// breakdown equals the one the full history gives.

const NAMED_ISSUE = /#([1-9]\d*)\b/gu
const { EVENT_KIND } = run_event_stream
const HOST_KINDS: ReadonlySet<string> = new Set([
	EVENT_KIND.SLEEP,
	EVENT_KIND.OFFLINE,
	EVENT_KIND.OFFLINE_TICK,
	EVENT_KIND.ONLINE,
])

// The key every lane reads: events naming no Issue and host events. Issue numbers start at 1.
const SHARED = 0

type Indexed<T> = readonly [number, T]
type Groups<T> = ReadonlyMap<number | undefined, ReadonlyArray<Indexed<T>>>

// The ledger entries keyed by their Issue (`undefined` for an entry naming none) and the events keyed
// by every Issue they name (`SHARED` too for one every lane reads), each with its position, plus the
// Issues each event names, in event order.
interface Partition {
	entries: Groups<LedgerEntry>
	events: Groups<RunEvent>
	named: ReadonlyArray<ReadonlySet<number>>
}

function named_issues(event: RunEvent): ReadonlySet<number> {
	return new Set([...event.text.matchAll(NAMED_ISSUE)].map((match) => Number(match[1])))
}

function entry_keys(entry: LedgerEntry): Array<number | undefined> {
	// A startup entry's issue is the launch's text, not an Issue number.
	const issue = 'issue' in entry ? entry.issue : undefined

	return [typeof issue === 'number' ? issue : undefined]
}

function event_keys(event: RunEvent, named: ReadonlySet<number>): Array<number> {
	const is_shared = named.size === 0 || HOST_KINDS.has(event.kind)

	return is_shared ? [SHARED, ...named] : [...named]
}

// Each record with its position under every key `keys_of` gives it, in record order.
function grouped<T>(
	records: ReadonlyArray<T>,
	keys_of: (record: T, index: number) => ReadonlyArray<number | undefined>,
): Groups<T> {
	const groups = new Map<number | undefined, Array<Indexed<T>>>()
	const keyed = records.flatMap((record, index) =>
		keys_of(record, index).map((key) => [key, [index, record]] as const),
	)

	for (const [key, pair] of keyed) {
		const group = groups.get(key) ?? []

		group.push(pair)
		groups.set(key, group)
	}

	return groups
}

function partition_of(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
): Partition {
	const named = events.map((event) => named_issues(event))

	function event_of(event: RunEvent, index: number): Array<number> {
		return event_keys(event, named[index] ?? new Set())
	}

	return { entries: grouped(entries, entry_keys), events: grouped(events, event_of), named }
}

// `issue` and every Issue an event naming it names too.
function related_issues(issue: number, partition: Partition): ReadonlySet<number> {
	const naming = partition.events.get(issue) ?? []
	const named = naming.flatMap(([index]) => [...(partition.named[index] ?? [])])

	return new Set([issue, ...named])
}

// The records under `keys`, each once, in their original order.
function gathered<T>(groups: Groups<T>, keys: ReadonlyArray<number>): Array<T> {
	const pairs = keys.flatMap((key) => groups.get(key) ?? [])

	return [...new Map(pairs)].toSorted((left, right) => left[0] - right[0]).map((pair) => pair[1])
}

function breakdown_of(issue: number, partition: Partition): Breakdown | undefined {
	const related = [...related_issues(issue, partition)]
	const reached = gathered(partition.events, [SHARED, ...related])

	return lane_breakdown.of(gathered(partition.entries, related), reached, issue)
}

// Each Issue's breakdown; an Issue the ledger holds no dispatch and merge of has none.
function of_issues(
	issues: ReadonlyArray<number>,
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
): Map<number, Breakdown> {
	const partition = partition_of(entries, events)
	const pairs = issues.map((issue) => [issue, breakdown_of(issue, partition)] as const)

	return new Map(pairs.filter((pair): pair is [number, Breakdown] => pair[1] !== undefined))
}

const cost_audit_breakdown = { of_issues }

export { cost_audit_breakdown }
