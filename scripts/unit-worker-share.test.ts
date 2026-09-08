import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { process_identity } from './josh/process-identity'
import { process_identity_fixture } from './josh/process-identity-fixture'
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
// The pids no live process holds and the start time none can have — `process-identity-fixture.ts` for
// why each is the value it is.
const { DEAD_PID, FOREIGN_START, GROUP_PID, NEGATIVE_PID } = process_identity_fixture

const DEAD_MARKER = `${unit_worker_share.RUN_PREFIX}dead.json`
const ALIVE_MARKER = `${unit_worker_share.RUN_PREFIX}alive.json`
const RECYCLED_MARKER = `${unit_worker_share.RUN_PREFIX}recycled.json`
const RUN_ARGUMENTS = ['run']
const RUN_FAILURE = 'unit suite failed'

function probe_directory(): string {
	return mkdtempSync(path.join(tmpdir(), PROBE_PREFIX))
}

// The count for a path under a directory this run just created, so it cannot exist. A fixed name
// under `os.tmpdir()` would be absent only for as long as no other unit suite on the machine
// happened to name it (joshuafolkken/kit#1517).
function count_under_absent_child(): number {
	const directory = probe_directory()

	try {
		return unit_worker_share.live_run_count(path.join(directory, 'absent'))
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

function write_marker(directory: string, name: string, payload: unknown): void {
	writeFileSync(path.join(directory, name), JSON.stringify(payload))
}

// The marker this process would write, read back. Named so the two `with_run_marker` cases below do
// not nest the read three calls deep inside an assertion.
function own_marker_pid(): number | undefined {
	return unit_worker_share.read_marker(unit_worker_share.marker_path())?.pid
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
	// **The second row is the one that is not obvious, and it is deliberate** (joshuafolkken/kit#1245).
	// A marker recording no start time — written before the field existed, or on a platform that cannot
	// report one — is a live pid nobody can identify, and it still counts. That is the opposite of what
	// the in-flight gate marker's readers do with the same answer, because what being wrong costs
	// differs: here it costs this run a narrower share of the machine, while the other direction puts
	// six unit suites on eleven cores.
	it.each([
		['names a process that is still alive', process_identity.own_fields()],
		['records a pid but no start time', { pid: process.pid }],
	])('counts a marker that %s', (_label: string, payload: unknown) => {
		const directory = probe_directory()

		try {
			write_marker(directory, ALIVE_MARKER, payload)

			expect(unit_worker_share.live_run_count(directory)).toBe(1)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})
})

describe('unit_worker_share.live_run_count — who does not', () => {
	// The leak this rule exists for. A run killed outright leaves its file behind, and counting it
	// would hold every later run at one worker until somebody swept the temp directory by hand.
	//
	// `0` and `-1` are the second case rather than variants of it: neither is a dead process, they are
	// the caller's own process group and another group, and a bare `process.kill` probe reports both as
	// alive — so a corrupt marker would throttle the machine permanently.
	it.each([[DEAD_PID], [GROUP_PID], [NEGATIVE_PID]])(
		'ignores a marker recording pid %i',
		(pid: number) => {
			const directory = probe_directory()

			try {
				write_marker(directory, DEAD_MARKER, { pid })

				expect(unit_worker_share.live_run_count(directory)).toBe(0)
			} finally {
				rmSync(directory, { recursive: true, force: true })
			}
		},
	)
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

	// **Sweeping only ever collected the phantoms whose pid had not yet been reissued**, which is the
	// half the comment above could not deliver (joshuafolkken/kit#1245). From the moment the operating
	// system handed that number to something else, the pid-only probe answered "alive", the marker was
	// counted rather than swept, and every solo run on the machine stayed at one worker for good. The
	// recorded start time is what tells the reissued process from the one that wrote the file.
	it('counts out and removes the marker of a pid that was reissued', () => {
		const directory = probe_directory()

		try {
			write_marker(directory, RECYCLED_MARKER, {
				pid: process.pid,
				process_start: FOREIGN_START,
			})

			expect(unit_worker_share.live_run_count(directory)).toBe(0)
			expect(existsSync(path.join(directory, RECYCLED_MARKER))).toBe(false)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})
})

describe('unit_worker_share.live_run_count — what it leaves alone', () => {
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
		expect(count_under_absent_child()).toBe(0)
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
