import { AsyncLocalStorage } from 'node:async_hooks'
import type { ShipLapRecord } from '#scripts/lane/lane-ledger-schema'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'

// The inner steps of a `josh ship` stage, each timed into the lane ledger as a lap, so `lane:breakdown`
// names what a stage spent its minutes on (joshuafolkken/kit#5294). The stage and the issue are held
// for the stage's whole run (`within`), so a step deep inside it — the scoped pair the preflight, the
// review rounds and the gate share — is timed without either being passed down to it. A step run
// outside a ship stage (the followup's own gate) has no stage to belong to and is not timed.

interface LapScope {
	issue: number
	stage: string
}

type LapSink = (lap: ShipLapRecord) => Promise<void>

// The names a lap is written under, read back by `lane:breakdown` and `lane:stats` as they are.
const STEP = {
	PRECONDITIONS: 'preconditions',
	SCOPED_PAIR: 'scoped pair',
	GATE: 'josh gate',
	OVERLAP_WAIT: 'overlap wait',
	LOCAL_COMMIT: 'local commit',
	MERGE: 'merge',
	PUSH: 'push',
	COMMIT: 'josh git',
} as const

const scope = new AsyncLocalStorage<LapScope>()

async function to_ledger(lap: ShipLapRecord): Promise<void> {
	await lane_ledger_write.record_ship_lap(lap)
}

async function within<T>(issue: string, stage: string, run: () => Promise<T>): Promise<T> {
	return await scope.run({ issue: Number(issue), stage }, run)
}

function lap_of(
	current: LapScope,
	step: string,
	started_ms: number,
	fallback: string | undefined,
): ShipLapRecord {
	const lap = { ...current, step, elapsed_ms: performance.now() - started_ms }

	return fallback === undefined ? lap : { ...lap, fallback }
}

// `note_of` reads a lap's `fallback` off the step's own result (`run-ship-scoped.ts`).
interface LapOptions<T> {
	sink?: LapSink
	note_of?: (result: T) => string | undefined
}

// A step that threw still cost the stage its time, so it is timed either way; the append is
// best-effort (`lane-ledger-write.ts`), so it never replaces the step's own error.
async function timed<T>(
	step: string,
	run: () => Promise<T>,
	{ sink = to_ledger, note_of }: LapOptions<T> = {},
): Promise<T> {
	const current = scope.getStore()

	if (current === undefined) return await run()

	const started_ms = performance.now()
	const noted: { fallback?: string | undefined } = {}

	try {
		const result = await run()

		noted.fallback = note_of?.(result)

		return result
	} finally {
		await sink(lap_of(current, step, started_ms, noted.fallback))
	}
}

const run_ship_lap = { STEP, timed, within }

export type { LapOptions, LapSink }
export { run_ship_lap }
