import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_plan } from './gate-plan'
import { gate_test_fixture, type ExecaResult } from './gate-test-fixture'

// joshuafolkken/kit#1226: `josh gate --no-unit` runs the three static checks, because CI now runs the
// unit suite on a runner of its own. **The flag's whole risk is that something downstream reads a
// partial gate as a whole one**, and this suite is about the three places that could:
//
//   - the green-gate record, which `gate_skip` reuses to skip a later full `josh gate` outright;
//   - the in-flight marker, which tells `josh review:brief` a gate is covering this tree right now,
//     and so tells a review agent not to run the unit suite itself;
//   - the unit-run marker, which makes a sibling lane divide its vitest workers with this run.
//
// Each one is a claim about the unit suite. A `--no-unit` gate makes none of them, so it writes
// none of them — and the assertions below are the only thing standing between that and a gate which
// ran three checks while telling everything downstream it had run four.
//
// A separate file rather than more of `verification-gate.test.ts`, which is at its 300-line limit.

vi.mock('execa', () => ({
	execa: vi.fn(),
}))

// The real resolver probes the project; the gate's fan-out is what this suite is about, not which
// command the type check turns into.
vi.mock('./type-check-step', () => ({
	type_check_step: {
		resolve_type_check_args: async (): Promise<ReadonlyArray<string>> => ['josh', 'check'],
	},
}))

const { verification_gate } = await import('./verification-gate')
const { review_stamps } = await import('./review/review-stamps')
const { unit_worker_share } = await import('./unit-worker-share')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

const PASS = 0
const { as_execa_implementation, capture_stdout, fake_result } = gate_test_fixture
const RECORDS = gate_test_fixture.suite_records('no-unit')
const NO_UNIT: ReadonlyArray<string> = [verification_gate.NO_UNIT_FLAG]

function every_step_passes(): void {
	mocked_execa.mockImplementation(
		as_execa_implementation(async (_file: unknown, arguments_: unknown): Promise<ExecaResult> => {
			const sub_command = (arguments_ as ReadonlyArray<string>).at(-1) ?? ''

			return fake_result(PASS, `output of ${sub_command}`)
		}),
	)
}

// The gate also shells out to git to read the changed tree, so the calls are narrowed to the ones
// that are checks: each gate step runs `josh <target>`, and nothing else the gate spawns does.
const JOSH = 'josh'

function spawned_checks(): ReadonlyArray<string> {
	return mocked_execa.mock.calls
		.map((call) => (call[1] as ReadonlyArray<string>).join(' '))
		.filter((command) => command.startsWith(`${JOSH} `))
}

// The gate buffers and prints everything at once, so stdout is captured for every run here whether
// or not the assertion reads it.
async function run_gate(argv: ReadonlyArray<string>): Promise<number> {
	const stdout = capture_stdout()

	try {
		return await verification_gate.run_gate_command(argv, RECORDS)
	} finally {
		stdout.restore()
	}
}

beforeEach(() => {
	RECORDS.clear()
	vi.clearAllMocks()
	every_step_passes()
})

describe('josh gate --no-unit', () => {
	it('is a flag the gate consumes rather than an argument it refuses', async () => {
		expect(await run_gate(NO_UNIT)).toBe(0)
	})

	it('starts the three static checks and never the unit suite', async () => {
		await run_gate(NO_UNIT)

		expect(spawned_checks()).toHaveLength(gate_plan.STATIC_CHECKS.length)
		expect(spawned_checks().join('\n')).not.toContain(gate_plan.UNIT_LABEL)
	})

	it('still runs all four when the flag is absent', async () => {
		await run_gate([])

		expect(spawned_checks()).toHaveLength(gate_plan.GATE_CHECKS.length)
		expect(spawned_checks().join('\n')).toContain(gate_plan.UNIT_LABEL)
	})
})

// The record's meaning to `gate_skip` is "every check this repository gates on passed on exactly this
// tree". Writing it after three of four would let the next full `pnpm josh gate` be skipped on a tree
// whose unit suite nobody ran — a check reporting success without running, which is the state
// joshuafolkken/kit#1224 exists to refuse.
describe('a partial gate leaves no record a whole one would have left', () => {
	it('writes no green-gate record, so no later gate is skipped on its strength', async () => {
		const write = vi.spyOn(review_stamps.gate_stamp, 'write')

		await run_gate(NO_UNIT)

		expect(write).not.toHaveBeenCalled()
	})

	it('writes no in-flight marker, so no review is told the unit suite is covered', async () => {
		const write = vi.spyOn(review_stamps.in_flight_stamp, 'write')

		await run_gate(NO_UNIT)

		expect(write).not.toHaveBeenCalled()
	})

	it('claims no unit run, so no sibling lane throttles its workers for it', async () => {
		const claim = vi.spyOn(unit_worker_share, 'with_run_marker')

		await run_gate(NO_UNIT)

		expect(claim).not.toHaveBeenCalled()
	})

	// The positive control. Without it every assertion above would keep passing if the flag stopped
	// being read at all and the gate simply never claimed anything.
	it('claims the unit run on a whole gate', async () => {
		const claim = vi.spyOn(unit_worker_share, 'with_run_marker')

		await run_gate([])

		expect(claim).toHaveBeenCalled()
	})
})
