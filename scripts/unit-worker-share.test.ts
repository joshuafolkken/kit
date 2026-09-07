import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unit_worker_share } from './unit-worker-share'

// joshuafolkken/kit#1515: six lanes each read "11 cores, take 7 workers" and put 42 workers on 11,
// because nothing in the sizing asked how many other unit runs were in flight. What is pinned here is
// the arithmetic of the share and the liveness rule that decides who is counted — a leaked marker
// holding every later run at one worker would be worse than the oversubscription it replaces.

// The machine the surrounding measurements were taken on: Apple M3 Pro, 11 logical cores.
const MEASURED_CORES = 11
// What `epicrun` runs at, and the count the field measurement was taken under.
const LANE_COUNT = 6
const PROBE_PREFIX = 'josh-unit-share-test-'
// Above every platform's pid ceiling, so it names a process that cannot exist rather than one that
// happens not to right now.
const DEAD_PID = 2 ** 22
// Not a process at all: `process.kill(0, …)` addresses the caller's own process group and would
// otherwise answer "alive" for a marker nothing wrote.
const GROUP_PID = 0

const DEAD_MARKER = `${unit_worker_share.RUN_PREFIX}dead.json`
const RUN_ARGUMENTS = ['run']
const RUN_FAILURE = 'unit suite failed'

function probe_directory(): string {
	return mkdtempSync(path.join(tmpdir(), PROBE_PREFIX))
}

function write_marker(directory: string, name: string, payload: unknown): void {
	writeFileSync(path.join(directory, name), JSON.stringify(payload))
}

// The marker this process would write, read back. Named so the two `with_run_marker` cases below do
// not nest the read three calls deep inside an assertion.
function own_marker_pid(): number | undefined {
	return unit_worker_share.read_marker_pid(unit_worker_share.marker_path())
}

describe('unit_worker_share.resolve_unit_workers', () => {
	// The property the whole change rests on: a solo run is told nothing, so the gate applies its own
	// core reservation and the pre-push hook passes no flag — exactly what both did before.
	it('leaves a run that is alone on the machine exactly as it was', () => {
		expect(unit_worker_share.resolve_unit_workers(MEASURED_CORES, 1)).toBeUndefined()
	})

	// 11 cores across the six lanes the field measurement was taken under. Vitest was opening seven
	// workers per lane there, at a load average of 14.97.
	it('divides the machine between the lanes that are actually running', () => {
		expect(unit_worker_share.resolve_unit_workers(MEASURED_CORES, LANE_COUNT)).toBe(1)
		expect(unit_worker_share.resolve_unit_workers(MEASURED_CORES, 2)).toBe(5)
	})

	// A share of zero would run no test and report the suite green — the one arithmetic result that is
	// worse than any oversubscription.
	it('never hands out a share of nothing', () => {
		expect(unit_worker_share.resolve_unit_workers(2, 99)).toBe(unit_worker_share.MIN_WORKERS)
	})

	// More runs never means a wider share: a curve that rose anywhere would be read as a measurement
	// error on whichever machine hit it.
	it('never widens as more runs join', () => {
		const shares = Array.from({ length: 12 }, (_unused, runs) =>
			unit_worker_share.resolve_unit_workers(MEASURED_CORES, runs + 1),
		).map((share) => share ?? MEASURED_CORES)

		expect(shares).toEqual([...shares].toSorted((left, right) => right - left))
	})
})

describe('unit_worker_share.live_run_count — who counts as running', () => {
	it('counts a marker whose process is still alive', () => {
		const directory = probe_directory()

		try {
			write_marker(directory, `${unit_worker_share.RUN_PREFIX}alive.json`, { pid: process.pid })

			expect(unit_worker_share.live_run_count(directory)).toBe(1)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})

	// The leak this rule exists for. A run killed outright leaves its file behind, and counting it
	// would hold every later run at one worker until somebody swept the temp directory by hand.
	//
	// `0` is the second case rather than a variant of it: it is not a dead process but the caller's own
	// process group, which a bare `process.kill` probe reports as alive — so a corrupt marker would
	// throttle the machine permanently.
	it.each([[DEAD_PID], [GROUP_PID]])('ignores a marker recording pid %i', (pid: number) => {
		const directory = probe_directory()

		try {
			write_marker(directory, DEAD_MARKER, { pid })

			expect(unit_worker_share.live_run_count(directory)).toBe(0)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})
})

describe('unit_worker_share.live_run_count — sweeping what it counted out', () => {
	// **Skipping the phantom is not enough, and this is the assertion that says so.** A pid is reissued
	// eventually, and from the moment it is, a leaked marker counts as a live run for good — holding
	// every solo run on the machine at one worker. Reading is therefore also sweeping.
	it('removes the marker of a process that is gone', () => {
		const directory = probe_directory()

		try {
			write_marker(directory, DEAD_MARKER, { pid: DEAD_PID })
			unit_worker_share.live_run_count(directory)

			expect(existsSync(path.join(directory, DEAD_MARKER))).toBe(false)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})

	// **A marker that could not be read is left where it is.** `read_stamp_text` answers `undefined`
	// for a file another account owns as readily as for a corrupt one, and unlinking on that answer
	// raises `EPERM` from a path with no `catch` between it and the gate's plan line — aborting the run
	// over somebody else's file, which is worse than the leak the sweep exists for.
	it('leaves a marker it could not read rather than deleting it', () => {
		const directory = probe_directory()

		try {
			writeFileSync(path.join(directory, DEAD_MARKER), 'not json')

			expect(unit_worker_share.live_run_count(directory)).toBe(0)
			expect(existsSync(path.join(directory, DEAD_MARKER))).toBe(true)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})

	it('ignores a file that is not a marker at all', () => {
		const directory = probe_directory()

		try {
			write_marker(directory, 'something-else.json', { pid: process.pid })

			expect(unit_worker_share.live_run_count(directory)).toBe(0)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})

	// A temp directory that cannot be read answers "no other run", which leaves behavior as it was.
	// Being wrong in this direction costs wall time; being wrong in the other throttles a solo run.
	it('answers no other run when the directory cannot be read', () => {
		const absent = path.join(tmpdir(), 'josh-absent-1515')

		expect(unit_worker_share.live_run_count(absent)).toBe(0)
	})
})

// The arithmetic half of the nesting handoff. `with_run_marker`'s half is pinned below; this is the
// half that decides the number, and regressing it to always add one would halve every gate's unit
// share on a busy machine with the whole suite still green (joshuafolkken/kit#1515).
describe('unit_worker_share.current_share — counting this run once', () => {
	const outer_flag = process.env[unit_worker_share.NESTED_KEY]

	function set_nesting(is_nested: boolean): void {
		process.env[unit_worker_share.NESTED_KEY] = is_nested ? '1' : ''
	}

	afterEach(() => {
		process.env[unit_worker_share.NESTED_KEY] = outer_flag ?? ''
	})

	// The top-level case: the marker is not written yet, so this run is the one the count is missing.
	it('adds this run to the ones already in flight', () => {
		set_nesting(false)

		expect(unit_worker_share.current_share(MEASURED_CORES, 1)).toBe(5)
	})

	// Inside `josh gate` the parent wrote the marker before this process existed, so it is already in
	// the count. Adding one here would say two runs where there is one — and on a machine the gate
	// leaves uncapped, a four-core CI runner among them, that alone narrows a solo run.
	it('counts a nested run once, not twice', () => {
		set_nesting(true)

		expect(unit_worker_share.current_share(MEASURED_CORES, 1)).toBeUndefined()
		expect(unit_worker_share.current_share(MEASURED_CORES, 2)).toBe(5)
	})
})

describe('unit_worker_share.worker_arguments — what reaches vitest', () => {
	it('passes the share as the flag vitest reads', () => {
		expect(unit_worker_share.worker_arguments(RUN_ARGUMENTS, 3)).toEqual(['--maxWorkers=3'])
	})

	it('adds nothing when this run is alone', () => {
		expect(unit_worker_share.worker_arguments(RUN_ARGUMENTS, undefined)).toEqual([])
	})

	// A number the caller typed is theirs. `pnpm josh test:unit --maxWorkers=4` is a person saying what
	// they want, and `josh gate` passes its own cap for a reason this module cannot see. `--max-workers`
	// is here because vitest accepts it as the same option: recognizing only one spelling would let the
	// share be appended after the caller's number and win.
	it.each([['--maxWorkers=4'], ['--maxWorkers'], ['--max-workers=4'], ['--max-workers']])(
		'leaves a caller-supplied %s alone',
		(supplied: string) => {
			expect(unit_worker_share.worker_arguments([...RUN_ARGUMENTS, supplied], 3)).toEqual([])
		},
	)
})

// What the marker is for: it has to be readable while the suite is running, and gone the moment it is
// not. `await` first so the read happens after `with_run_marker` has handed control to the run.
async function report_own_marker(): Promise<number | undefined> {
	await Promise.resolve()

	return own_marker_pid()
}

describe('unit_worker_share.with_run_marker — announcing this run to the others', () => {
	// **This suite is itself a unit run, and may be running inside `josh gate`** — which sets the
	// nesting flag for its children, so without this the cases below would assert one thing when run
	// through the gate and another when run alone. Each starts from a cleared flag and the outer value
	// is put back, so the gate's own run keeps whatever it set.
	const outer_flag = process.env[unit_worker_share.NESTED_KEY]

	beforeEach(() => {
		process.env[unit_worker_share.NESTED_KEY] = ''
	})

	afterEach(() => {
		process.env[unit_worker_share.NESTED_KEY] = outer_flag ?? ''
	})

	it('holds a marker for as long as the run lasts and clears it after', async () => {
		const seen = await unit_worker_share.with_run_marker(report_own_marker)

		expect(seen).toBe(process.pid)
		expect(own_marker_pid()).toBeUndefined()
	})

	// `finally`, so a suite that threw does not leave its marker for the pid test to sweep later.
	it('clears the marker when the run throws', async () => {
		await expect(
			unit_worker_share.with_run_marker(async () => {
				await Promise.resolve()
				throw new Error(RUN_FAILURE)
			}),
		).rejects.toThrow(RUN_FAILURE)

		expect(own_marker_pid()).toBeUndefined()
	})

	// The window two lanes launched together fall into: `josh gate` marks itself, then spawns
	// `josh test:unit`, and a second marker for the same run would count it twice — halving a solo run
	// on a machine the gate leaves uncapped (joshuafolkken/kit#1515).
	it('writes no second marker for a run already inside one', async () => {
		const nested = await unit_worker_share.with_run_marker(
			async () => await unit_worker_share.with_run_marker(report_own_marker),
		)

		expect(nested).toBe(process.pid)
		expect(own_marker_pid()).toBeUndefined()
	})
})
