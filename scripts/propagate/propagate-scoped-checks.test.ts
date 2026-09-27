import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { propagate_run, type StepResult } from './propagate-run'
import { propagate_steps } from './propagate-steps'
import type { PropagateTarget } from './propagate-targets'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const CONSUMER: PropagateTarget = {
	repo: 'joshuafolkken/app-kit',
	path: '/Users/example/Development/app-kit',
	state: 'ready',
}
const SUCCESS = 0
const FAILURE = 1

function answer_with(exit_code: number | undefined): void {
	vi.mocked(execaSync).mockReturnValue({ exitCode: exit_code } as unknown as ReturnType<
		typeof execaSync
	>)
}

function fail_at(failing_step: string): (_target: PropagateTarget, step: string) => StepResult {
	return (_target: PropagateTarget, step: string): StepResult =>
		step === failing_step ? { step, is_ok: false, detail: 'exit 1' } : { step, is_ok: true }
}

beforeEach(() => {
	vi.resetAllMocks()
})

describe('the scoped checks shared by adopt and propagate', () => {
	it('runs both checks once after sync and before the gate', () => {
		const result = propagate_run.run_target(CONSUMER, (_target, step) => ({ step, is_ok: true }))
		const order = result.steps.map((one) => one.step)

		expect(
			order.slice(
				order.indexOf(propagate_run.STEP_SYNC) + 1,
				order.indexOf(propagate_run.STEP_VERIFY),
			),
		).toEqual([propagate_run.STEP_LINT_RELATED, propagate_run.STEP_TEST_RELATED])
	})

	it.each([propagate_run.STEP_LINT_RELATED, propagate_run.STEP_TEST_RELATED])(
		'stops before the gate and issue when %s fails',
		(failing_step) => {
			const result = propagate_run.run_target(CONSUMER, fail_at(failing_step))

			expect(result.outcome).toBe('failed')
			expect(result.steps.at(-1)?.step).toBe(failing_step)
			expect(result.steps.map((one) => one.step)).not.toContain(propagate_run.STEP_VERIFY)
			expect(result.steps.map((one) => one.step)).not.toContain(propagate_run.STEP_ISSUE)
			expect(result.reason).toContain('exit 1')
		},
	)
})

describe('running scoped checks in a consumer', () => {
	it.each([
		[propagate_run.STEP_LINT_RELATED, 'lint:related'],
		[propagate_run.STEP_TEST_RELATED, 'test:related'],
	])('runs %s in the consumer checkout', (step, command) => {
		answer_with(SUCCESS)
		const result = propagate_steps.create_step_runner({ releases: [], origin: 'adopt' })(
			CONSUMER,
			step,
		)

		expect(result.is_ok).toBe(true)
		expect(execaSync).toHaveBeenCalledWith(
			'pnpm',
			['josh', command],
			expect.objectContaining({ cwd: CONSUMER.path }),
		)
	})

	it.each([FAILURE, undefined])(
		'reports a failed or timed-out scoped process (%s)',
		(exit_code) => {
			answer_with(exit_code)
			const result = propagate_steps.create_step_runner({ releases: [], origin: 'adopt' })(
				CONSUMER,
				propagate_run.STEP_LINT_RELATED,
			)

			expect(result.is_ok).toBe(false)
		},
	)
})
