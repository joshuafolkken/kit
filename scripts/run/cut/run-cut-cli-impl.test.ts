import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_cut } from './run-cut'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'

const {
	BRANCH,
	CONTEXT_UNDER,
	ISSUE,
	WITH_HANDOFF,
	emit,
	existing_cut,
	find_open_lane,
	is_reviewer,
	launch,
	session_verdict,
	state,
	target,
	verdict,
} = run_cut_cli_fixture

run_cut_cli_fixture.install()

const FAILURE_EXIT_CODE = 1

describe('the implementation cut needs its handoff', () => {
	// joshuafolkken/kit#2484: a cut with no instruction relaunched a successor its own resume then
	// refused `incomplete`, so the child was parked. The cut is refused instead, relaunching nothing.
	it('refuses an --impl cut without a handoff and relaunches nothing', async () => {
		const code = await run_cut_cli.run(['--impl', ISSUE])

		expect([code, verdict()]).toStrictEqual([FAILURE_EXIT_CODE, run_cut_cli.BAD_HANDOFF_VERDICT])
		expect(run_cut.read_cut(target()).kind).toBe('none')
		expect(launch).not.toHaveBeenCalled()
	})
})

describe('the retired setup-phase cut', () => {
	// joshuafolkken/kit#2489: the unconditional setup cut is retired, so `--setup` is a usage error that
	// records and relaunches nothing rather than a cut taken under another name.
	it('refuses --setup without recording or relaunching anything', async () => {
		const code = await run_cut_cli.run(['--setup', ISSUE])

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(run_cut.read_cut(target()).kind).toBe('none')
		expect(launch).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#2760: a `fullrun` held in its own checkout — no lane — took no implementation cut,
// so its context grew without a bound. The hold naming the issue is what lets it cut, relaunching
// nothing: the session a person is watching hands the run on with the resume command instead.
function held_by(issue: string | undefined): void {
	find_open_lane.mockResolvedValue(undefined)
	state.mockResolvedValue({
		branch: BRANCH,
		is_dirty: true,
		is_held: issue !== undefined,
		held_issue: issue,
	})
}

describe('the implementation cut outside a lane', () => {
	it('records the cut for a run held for this issue and relaunches nothing', async () => {
		held_by(ISSUE)

		const code = await run_cut_cli.run(['--impl', ISSUE, ...WITH_HANDOFF])

		expect([code, verdict()]).toStrictEqual([0, run_cut_cli.CUT_VERDICT])
		expect(run_cut.read_cut(target()).kind).toBe('carried')
		expect(launch).not.toHaveBeenCalled()
	})

	it('resumes that cut back into implementation in the fresh session', async () => {
		held_by(ISSUE)
		await run_cut_cli.run(['--impl', ISSUE, ...WITH_HANDOFF])
		session_verdict.mockReturnValue(CONTEXT_UNDER)

		await run_cut_cli.run(['--resume', ISSUE])

		expect(verdict()).toBe(run_cut_cli.RESUME_IMPL_VERDICT)
	})

	// The session that took the cut stays open outside a lane, so retyping `fullrun #N` there resumed it
	// over the threshold and the next edit cut it again — a loop that shed no context.
	it('refuses the resume in the session still over the threshold and keeps the record', async () => {
		held_by(ISSUE)
		await run_cut_cli.run(['--impl', ISSUE, ...WITH_HANDOFF])
		const taken = run_cut.read_cut(target())

		const code = await run_cut_cli.run(['--resume', ISSUE])

		expect([code, verdict()]).toStrictEqual([FAILURE_EXIT_CODE, run_cut_cli.OVER_VERDICT])
		expect(run_cut.read_cut(target())).toStrictEqual(taken)
	})
})

describe('a cut outside a lane that is not taken', () => {
	it.each([[undefined], ['2294']])(
		'answers not-a-lane when the hold names %j rather than this issue',
		async (holder) => {
			held_by(holder)

			const code = await run_cut_cli.run(['--impl', ISSUE, ...WITH_HANDOFF])

			expect([code, verdict()]).toStrictEqual([0, run_cut_cli.NOT_A_LANE_VERDICT])
			expect(run_cut.read_cut(target()).kind).toBe('none')
		},
	)

	// The pre-gate cut stays lane-only: a held run reaches its gate in the same session.
	it('leaves the pre-gate cut not-a-lane even for a held run', async () => {
		held_by(ISSUE)

		await run_cut_cli.run([ISSUE])

		expect(verdict()).toBe(run_cut_cli.NOT_A_LANE_VERDICT)
		expect(run_cut.read_cut(target()).kind).toBe('none')
	})
})

// joshuafolkken/kit#3623: the ship reviewer runs in the implementing child's lane, so `--impl` cut it
// and relaunched a second child beside the one the supervisor repairs with.
describe('a cut asked for by a ship reviewer', () => {
	it.each([
		['the implementation cut in a lane', ['--impl', ISSUE, ...WITH_HANDOFF]],
		['the pre-gate cut in a lane', [ISSUE]],
	])('takes no cut and relaunches nothing for %s', async (_name, argv) => {
		is_reviewer.mockReturnValueOnce(true)

		const code = await run_cut_cli.run(argv)

		expect([code, verdict()]).toStrictEqual([0, run_cut_cli.NOT_A_LANE_VERDICT])
		expect(run_cut.read_cut(target()).kind).toBe('none')
		expect([launch, emit, find_open_lane].map((spy) => spy.mock.calls.length)).toStrictEqual([
			0, 0, 0,
		])
	})

	it('takes no cut under a hold outside a lane either', async () => {
		held_by(ISSUE)
		is_reviewer.mockReturnValueOnce(true)

		await run_cut_cli.run(['--impl', ISSUE, ...WITH_HANDOFF])

		expect(verdict()).toBe(run_cut_cli.NOT_A_LANE_VERDICT)
		expect(run_cut.read_cut(target()).kind).toBe('none')
	})

	it('still cuts and relaunches for the implementing child in the same lane', async () => {
		const code = await run_cut_cli.run(['--impl', ISSUE, ...WITH_HANDOFF])

		expect([code, verdict()]).toStrictEqual([0, run_cut_cli.CUT_VERDICT])
		expect(launch).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#3375: the implementation resume cleared its record but appended nothing, so the `cut`
// stayed the run's newest event and `run:step` kept answering the resume it had just run.
describe('the resume event', () => {
	it('appends a resume event naming the issue when the resume answers resume-impl', async () => {
		existing_cut(run_cut.IMPLEMENTATION_PHASE)
		session_verdict.mockReturnValue(CONTEXT_UNDER)

		await run_cut_cli.run(['--resume', ISSUE])

		expect(verdict()).toBe(run_cut_cli.RESUME_IMPL_VERDICT)
		expect(emit).toHaveBeenCalledWith(run_event_stream.EVENT_KIND.RESUME, `#${ISSUE} resumed`)
	})

	it('appends nothing when a pre-gate cut resumes into the gate', async () => {
		existing_cut()

		await run_cut_cli.run(['--resume', ISSUE])

		expect(verdict()).toBe(run_cut_cli.RESUME_VERDICT)
		expect(emit).not.toHaveBeenCalled()
	})
})
