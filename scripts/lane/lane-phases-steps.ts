import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_phases, type PhaseRow } from './lane-phases'
import { lane_stats } from './lane-stats'

// `josh lane:phases`'s two finer tables (joshuafolkken/kit#8291): each `run:chain` stage's and each
// `josh ship` step's median minutes and sample count across the lanes read. A sample is one run of
// the stage or step, not one lane, since `run:chain` runs several times per lane. The stages come
// from the `chain-stage` lines `run:chain` appends as each stage ends (joshuafolkken/kit#8286); the
// steps from the `stage` lines `josh ship` writes, whose `stage` is a `run_ship_stage.STAGE` value or
// `pre-detach` — the other `stage` lines (`ci-wait`, the CodeRabbit waits) are not ship steps.

type ChainStageEntry = Extract<LedgerEntry, { kind: typeof KIND.CHAIN_STAGE }>
type StageEntry = Extract<LedgerEntry, { kind: typeof KIND.STAGE }>

interface Sample {
	readonly name: string
	readonly ms: number
}

const { KIND, PRE_DETACH_STAGE } = lane_ledger
const SHIP_STEPS: ReadonlySet<string> = new Set([
	PRE_DETACH_STAGE,
	...Object.values(run_ship_stage.STAGE),
])
const UNIT = 'runs'

function is_chain_stage(entry: LedgerEntry): entry is ChainStageEntry {
	return entry.kind === KIND.CHAIN_STAGE
}

function is_ship_step(entry: LedgerEntry): entry is StageEntry {
	return entry.kind === KIND.STAGE && SHIP_STEPS.has(entry.stage)
}

function is_lane(entry: LedgerEntry, issues: ReadonlySet<number>): boolean {
	return 'issue' in entry && typeof entry.issue === 'number' && issues.has(entry.issue)
}

function chain_samples(
	entries: ReadonlyArray<LedgerEntry>,
	issues: ReadonlySet<number>,
): Array<Sample> {
	return entries
		.filter((entry): entry is ChainStageEntry => is_chain_stage(entry) && is_lane(entry, issues))
		.map((entry) => ({ name: entry.name, ms: entry.elapsed_ms }))
}

function ship_samples(
	entries: ReadonlyArray<LedgerEntry>,
	issues: ReadonlySet<number>,
): Array<Sample> {
	return entries
		.filter((entry): entry is StageEntry => is_ship_step(entry) && is_lane(entry, issues))
		.map((entry) => ({ name: entry.stage, ms: entry.elapsed_ms }))
}

function row_of(name: string, samples: ReadonlyArray<Sample>): Array<PhaseRow> {
	const values = samples.filter((sample) => sample.name === name).map((sample) => sample.ms)
	const median_ms = lane_stats.median(values)

	return median_ms === undefined ? [] : [{ phase: name, median_ms, samples: values.length }]
}

// One row per name, in the order the names first appear.
function rows_of(samples: ReadonlyArray<Sample>): Array<PhaseRow> {
	const names = [...new Set(samples.map((sample) => sample.name))]

	return names.flatMap((name) => row_of(name, samples))
}

// The earliest `chain-stage` line read, so a range before #8286 says where the records begin.
function first_recorded(entries: ReadonlyArray<LedgerEntry>): string | undefined {
	return entries
		.filter((entry) => is_chain_stage(entry))
		.map((entry) => entry.at)
		.toSorted((left, right) => Date.parse(left) - Date.parse(right))
		.at(0)
}

function table(title: string, rows: ReadonlyArray<PhaseRow>): string {
	return [`${title} (median, samples):`, ...rows.map((row) => lane_phases.line_of(row, UNIT))].join(
		'\n',
	)
}

function chain_text(entries: ReadonlyArray<LedgerEntry>, issues: ReadonlySet<number>): string {
	const rows = rows_of(chain_samples(entries, issues))
	if (rows.length > 0) return table('run:chain stages', rows)
	const first_at = first_recorded(entries)
	const since = first_at === undefined ? 'none in the ledger read' : `first recorded ${first_at}`

	return `run:chain stages: no chain-stage records for these lanes (${since})`
}

function ship_text(entries: ReadonlyArray<LedgerEntry>, issues: ReadonlySet<number>): string {
	const rows = rows_of(ship_samples(entries, issues))

	return rows.length > 0
		? table('josh ship steps', rows)
		: 'josh ship steps: no ship step records for these lanes'
}

function text(entries: ReadonlyArray<LedgerEntry>, issues: ReadonlyArray<number>): string {
	const wanted = new Set(issues)

	return [chain_text(entries, wanted), ship_text(entries, wanted)].join('\n')
}

const lane_phases_steps = { text }

export { lane_phases_steps }
