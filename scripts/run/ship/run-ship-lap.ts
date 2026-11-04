import { AsyncLocalStorage } from 'node:async_hooks'
import type { ShipLapRecord } from '#scripts/lane/lane-ledger-schema'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { z } from 'zod'

// The inner steps of a `josh ship` stage, each timed into the lane ledger as a lap, so `lane:breakdown`
// names what a stage spent its minutes on (joshuafolkken/kit#5294). The stage and the issue are held
// for the stage's whole run (`within`), so a step deep inside it — the scoped pair the preflight, the
// review rounds and the gate share — is timed without either being passed down to it. A step run
// outside a ship stage (the followup's own gate) has no stage to belong to and is not timed.
// A scope with a parent — `josh git` under the ship's commit, or `run:entry` — names each lap
// `<parent> › <step>`, and crosses into a child process through `ENVIRONMENT_KEY`, so the hooks git
// runs are timed under the step that spawned them (joshuafolkken/kit#5831).

// A `JOSH_SHIP_*` mark, so the unit suite blanks it with the rest (`tools/test/unit-projects.ts`).
const ENVIRONMENT_KEY = 'JOSH_SHIP_LAP_SCOPE'
const PARENT_SEPARATOR = ' › '
const STARTUP_STEP = 'startup'

const lap_scope_schema = z.object({
	issue: z.number(),
	stage: z.string(),
	parent: z.string().optional(),
})

type LapScope = z.infer<typeof lap_scope_schema>

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

async function within<T>(
	issue: string,
	stage: string,
	run: () => Promise<T>,
	parent?: string,
): Promise<T> {
	return await scope.run({ issue: Number(issue), stage, parent }, run)
}

// The scope a parent process handed down, `undefined` when none or unreadable.
function inherited(): LapScope | undefined {
	const text = process.env[ENVIRONMENT_KEY]
	if (text === undefined || text === '') return undefined

	try {
		return lap_scope_schema.safeParse(JSON.parse(text)).data
	} catch {
		return undefined
	}
}

function current_scope(): LapScope | undefined {
	return scope.getStore() ?? inherited()
}

// The environment that times a child process's steps under `parent`, `{}` outside any scope.
function environment(parent: string): Record<string, string> {
	const current = current_scope()
	if (current === undefined) return {}

	return {
		[ENVIRONMENT_KEY]: JSON.stringify({ issue: current.issue, stage: current.stage, parent }),
	}
}

// What a step's own result adds to its lap: why a check read the whole branch, and which run of the
// scoped pair it was, why it ran again, how many files it was named over or why a merge could not
// split (`run-ship-scoped.ts`), and the tree a gate reused.
type LapNote = Pick<
	ShipLapRecord,
	'fallback' | 'rerun' | 'reused_tree' | 'runs' | 'named' | 'unsplit' | 'is_reused'
>

function lap_of(current: LapScope, step: string, started_ms: number, note: LapNote): ShipLapRecord {
	const { parent, ...place } = current
	const name = parent === undefined ? step : `${parent}${PARENT_SEPARATOR}${step}`

	return { ...place, step: name, elapsed_ms: performance.now() - started_ms, ...note }
}

function no_note(): LapNote {
	return {}
}

interface LapOptions<T> {
	sink?: LapSink
	note_of?: (result: T) => LapNote
	// `false` for a git hook: its process starts inside the `josh git` step that ran git, so a startup
	// lap of its own would be counted twice beside the parent's.
	startup?: boolean
}

const startup = { recorded: false }

// A child process's first lap under the scope it inherited is preceded by its own startup — from
// `timeOrigin` until that lap, the tsx load among it — so the parent's lap is explained by its
// children (joshuafolkken/kit#5896). A scope this process opened with `within` started no process.
async function record_startup(current: LapScope, sink: LapSink, is_wanted: boolean): Promise<void> {
	if (!is_wanted || startup.recorded || scope.getStore() !== undefined) return
	startup.recorded = true

	await sink(lap_of(current, STARTUP_STEP, 0, {}))
}

// A step that threw still cost the stage its time, so it is timed either way; the append is
// best-effort (`lane-ledger-write.ts`), so it never replaces the step's own error.
async function timed<T>(
	step: string,
	run: () => Promise<T>,
	{ sink = to_ledger, note_of = no_note, startup: with_startup }: LapOptions<T> = {},
): Promise<T> {
	const current = current_scope()

	if (current === undefined) return await run()

	await record_startup(current, sink, with_startup !== false)
	const started_ms = performance.now()
	const noted: { note: LapNote } = { note: {} }

	try {
		const result = await run()

		noted.note = note_of(result)

		return result
	} finally {
		await sink(lap_of(current, step, started_ms, noted.note))
	}
}

const run_ship_lap = { ENVIRONMENT_KEY, STARTUP_STEP, STEP, environment, timed, within }

export type { LapNote, LapOptions, LapSink }
export { run_ship_lap }
