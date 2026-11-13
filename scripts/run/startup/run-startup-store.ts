import { randomUUID } from 'node:crypto'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_carry } from '#scripts/run/carry/run-carry'
import type { StartupEntry, StartupScope } from './run-startup-schema'

async function carried_identity(issue?: string): Promise<StartupScope | undefined> {
	const repository = await run_carry.repository_directory()
	if (repository === undefined) return undefined
	const read = run_carry.read_carry(run_carry.carry_path(repository))
	if (read.kind !== 'carried') return undefined

	return {
		run: `${repository}:${read.carry.started_at}`,
		attempt: randomUUID(),
		destination: lane_ledger_write.target_of(repository),
		...(issue !== undefined && { issue }),
	}
}

async function identity(issue?: string): Promise<StartupScope | undefined> {
	try {
		if (process.env['VITEST'] !== undefined) return undefined

		return await carried_identity(issue)
	} catch {
		return undefined
	}
}

async function record(entry: StartupEntry, destination?: string): Promise<void> {
	await lane_ledger_write.record(entry, destination)
}

interface StartupSummary {
	start: StartupEntry
	status: 'done' | 'failed' | 'waiting' | 'incomplete'
	elapsed_ms: number | undefined
	api: Record<string, number>
	cache: Record<string, number>
}

function counts(rows: ReadonlyArray<StartupEntry>, edge: 'api' | 'cache'): Record<string, number> {
	const result: Record<string, number> = {}

	for (const row of rows) {
		if (row.edge !== edge) continue
		const key = row.metric ?? 'unknown'

		result[key] = (result[key] ?? 0) + 1
	}

	return result
}

function is_terminal(
	row: StartupEntry,
): row is StartupEntry & { edge: 'done' | 'failed' | 'waiting' } {
	return row.edge === 'done' || row.edge === 'failed' || row.edge === 'waiting'
}

function summary(start: StartupEntry, rows: ReadonlyArray<StartupEntry>): StartupSummary {
	const ending = rows.find(is_terminal)

	return {
		start,
		status: ending?.edge ?? 'incomplete',
		elapsed_ms: ending?.elapsed_ms,
		api: counts(rows, 'api'),
		cache: counts(rows, 'cache'),
	}
}

// Direct counts only; parent durations include children and must not be added to them.
function by_span(entries: ReadonlyArray<StartupEntry>): Map<string, Array<StartupEntry>> {
	const groups = new Map<string, Array<StartupEntry>>()

	for (const row of entries) {
		const group = groups.get(row.id) ?? []

		group.push(row)
		groups.set(row.id, group)
	}

	return groups
}

function summarize(entries: ReadonlyArray<StartupEntry>): Array<StartupSummary> {
	const groups = by_span(entries)

	return entries
		.filter((row) => row.edge === 'start')
		.map((start) => summary(start, groups.get(start.id) ?? []))
}

function timestamp(row: StartupEntry): number {
	return row.at_ms ?? Date.parse(row.at)
}

function before_end(
	row: StartupEntry,
	other: StartupEntry,
	endings: ReadonlyMap<string, number>,
): boolean {
	const end = endings.get(other.id)

	return end !== undefined && timestamp(row) < end
}

function overlaps(
	left: StartupEntry,
	right: StartupEntry,
	endings: ReadonlyMap<string, number>,
): boolean {
	if (left.id === right.id || left.key !== right.key) return false

	return before_end(left, right, endings) && before_end(right, left, endings)
}

// A fill is a miss being computed, not a second cache lookup. Overlapping fills on the same hashed
// key are concurrent misses, including separate processes; no deduplication or lock is introduced.
function concurrent_misses(entries: ReadonlyArray<StartupEntry>): Array<StartupEntry> {
	const fills = entries.filter((row) => row.edge === 'cache' && row.metric === 'fill')
	const endings = new Map(entries.filter(is_terminal).map((row) => [row.id, timestamp(row)]))

	return fills.filter((row) => fills.some((other) => overlaps(row, other, endings)))
}

const run_startup_store = { identity, record, summarize, concurrent_misses }
export type { StartupSummary }
export { run_startup_store }
