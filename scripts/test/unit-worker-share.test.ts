import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { unit_worker_share } from './unit-worker-share'

// joshuafolkken/kit#1515: six lanes each read "11 cores, take 7 workers" and put 42 workers on 11,
// because nothing in the sizing asked how many other unit runs were in flight. The division and the
// liveness rule are `unit-run-marker.test.ts`; what is pinned here is how the share counts this run,
// what reaches vitest, and the marker a run holds.

// The machine the surrounding measurements were taken on: Apple M3 Pro, 11 logical cores.
const MEASURED_CORES = 11
const RUN_ARGUMENTS = ['run']
const RUN_FAILURE = 'unit suite failed'

// The marker this process would write, read back. Named so the two `with_run_marker` cases below do
// not nest the read three calls deep inside an assertion.
function own_marker_pid(): number | undefined {
	return unit_worker_share.read_marker(unit_worker_share.marker_path())?.pid
}

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
