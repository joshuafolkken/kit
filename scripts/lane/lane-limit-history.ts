import { lane_capacity, type LimitChoice } from './lane-capacity'
import { lane_ledger_kind } from './lane-ledger-kind'
import type { LedgerEntry, LimitEntry } from './lane-ledger-schema'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_limit_override } from './lane-limit-override'
import { lane_stats, type StatsWindow } from './lane-stats'

// The lane limit's history in the lane ledger: one `limit` line each time a run starts and each time
// `lane:limit` changes it, so `lane:stats` labels a period the limit moved in with every limit it
// held — `3→4` — rather than the one it reads now (joshuafolkken/kit#6139).

const { KIND } = lane_ledger_kind
const CHANGE_SEPARATOR = '→'

// Written best-effort; an unreadable limit writes nothing.
async function record(choice: LimitChoice, path?: string): Promise<void> {
	if (choice.kind !== 'limit') return

	const at = new Date().toISOString()

	await lane_ledger_write.record({ kind: KIND.LIMIT, at, limit: choice.limit }, path)
}

// The limit this process reads — the run's override, else the limit it started with, else
// `JOSH_LANE_LIMIT`.
async function record_current(path?: string): Promise<void> {
	await record(await lane_capacity.lane_limit(), path)
}

// The limit a run starts under: kept on its carry record, so a later `lane:limit --reset` restores it
// whatever a shell's `.env` reads by then (joshuafolkken/kit#6166), and written to the ledger.
async function record_launch(path?: string): Promise<void> {
	const choice = lane_capacity.environment_limit()

	if (choice.kind === 'limit') await lane_limit_override.write_launch(choice.limit)

	await record(choice, path)
}

function is_limit(entry: LedgerEntry): entry is LimitEntry {
	return entry.kind === KIND.LIMIT
}

// The limit in force when the window opens — the last one written before it — then each one written
// inside it, a repeat of the one before dropped.
function limits_in(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): Array<number> {
	const limits = entries.filter((entry) => is_limit(entry))
	const opening = limits.findLast((entry) => Date.parse(entry.at) < window.since_ms)
	const inside = lane_stats.in_window(limits, window)
	const held = [...(opening === undefined ? [] : [opening]), ...inside].map((entry) => entry.limit)

	return held.filter((limit, index) => index === 0 || limit !== held[index - 1])
}

async function current_label(): Promise<string> {
	const choice = await lane_capacity.lane_limit()

	return choice.kind === 'limit' ? String(choice.limit) : lane_stats.MISSING
}

// `lane:stats`'s `JOSH_LANE_LIMIT` cell: `--limit` outright, else the window's limits joined by `→`,
// else — no `limit` line reaches the window — the limit this process reads.
async function label(
	given: string | undefined,
	entries: ReadonlyArray<LedgerEntry>,
	window: StatsWindow,
): Promise<string> {
	if (given !== undefined) return given

	const limits = limits_in(entries, window)

	return limits.length === 0 ? await current_label() : limits.map(String).join(CHANGE_SEPARATOR)
}

const lane_limit_history = { label, record_current, record_launch }

export { lane_limit_history }
