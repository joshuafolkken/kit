import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_plan, type GateCheck, type GatePlan } from './gate-plan'
import { build_gate_step, build_gate_steps, UNIT_WORKER_FLAG } from './gate-steps'

vi.mock('./project-checks', () => ({
	project_checks: {
		is_basic: vi.fn(),
		project_root: vi.fn(),
		type_check_skip_reason: vi.fn(),
	},
}))

vi.mock('./type-check-step', () => ({
	type_check_step: { resolve_type_check_args: vi.fn() },
}))

const { project_checks } = await import('./project-checks')
const { type_check_step } = await import('./type-check-step')
const mocked_is_basic = vi.mocked(project_checks.is_basic)
const mocked_project_root = vi.mocked(project_checks.project_root)
const mocked_skip_reason = vi.mocked(project_checks.type_check_skip_reason)
const mocked_type_check_args = vi.mocked(type_check_step.resolve_type_check_args)

const START = '/work/app/src'
const ROOT = '/work/app'
const WORKER_CAP = 3
const SKIP_REASON = 'no TypeScript files were found'
const TOOLKIT_CHECKER = 'svelte-check'
const LINT_TARGET = 'lint:all'
const CAPPED_WORKERS = `${UNIT_WORKER_FLAG}=${String(WORKER_CAP)}`
const { LINT_LABEL, TYPE_CHECK_LABEL, UNIT_LABEL } = gate_plan

function check(label: string, target: string = label): GateCheck {
	return { label, target, reserved_cores: 1 }
}

function plan_of(unit_worker_cap: number | undefined, checks: Array<GateCheck> = []): GatePlan {
	return { checks, concurrency: 1, unit_worker_cap }
}

beforeEach(() => {
	vi.clearAllMocks()
	mocked_is_basic.mockReturnValue(false)
	mocked_project_root.mockReturnValue(ROOT)
	mocked_skip_reason.mockReturnValue(SKIP_REASON)
	mocked_type_check_args.mockResolvedValue(['josh', 'check'])
})

describe('build_gate_step — non-type checks', () => {
	it('runs the check target through josh with no cwd outside a basic project', async () => {
		await expect(
			build_gate_step(check(LINT_LABEL, LINT_TARGET), START, plan_of(WORKER_CAP)),
		).resolves.toStrictEqual({
			label: LINT_LABEL,
			command_args: ['josh', LINT_TARGET],
			cwd: undefined,
		})
	})

	it('caps the unit suite workers when the plan sets a cap', async () => {
		const step = await build_gate_step(check(UNIT_LABEL), START, plan_of(WORKER_CAP))

		expect(step.command_args).toStrictEqual(['josh', UNIT_LABEL, CAPPED_WORKERS])
	})

	// joshuafolkken/kit#3409: the metrics step times no startup beside the unit suite.
	it("hands the target the check's own fixed arguments", async () => {
		const metrics = gate_plan.GATE_CHECKS.find((gate_check) => gate_check.label === 'metrics')
		const step = await build_gate_step(metrics ?? check('metrics'), START, plan_of(WORKER_CAP))

		expect(step.command_args).toStrictEqual(['josh', 'metrics', '--no-startup'])
	})

	it('leaves the unit suite uncapped when the plan sets no cap', async () => {
		const step = await build_gate_step(check(UNIT_LABEL), START, plan_of(undefined))

		expect(step.command_args).toStrictEqual(['josh', UNIT_LABEL])
	})

	it('runs from the project root in a basic project', async () => {
		mocked_is_basic.mockReturnValue(true)

		const step = await build_gate_step(check(LINT_LABEL), START, plan_of(undefined))

		expect(step.cwd).toBe(ROOT)
		expect(mocked_project_root).toHaveBeenCalledWith(START)
	})
})

describe('build_gate_step — the type check', () => {
	it('carries the skip reason when the resolved checker is josh', async () => {
		const step = await build_gate_step(check(TYPE_CHECK_LABEL), START, plan_of(undefined))

		expect(step).toStrictEqual({
			label: TYPE_CHECK_LABEL,
			command_args: ['josh', 'check'],
			cwd: undefined,
			skip_reason: SKIP_REASON,
		})
	})

	it('asks no skip reason when a toolkit bin resolved the checker', async () => {
		mocked_type_check_args.mockResolvedValue([TOOLKIT_CHECKER])

		const step = await build_gate_step(check(TYPE_CHECK_LABEL), START, plan_of(undefined))

		expect(step.command_args).toStrictEqual([TOOLKIT_CHECKER])
		expect(step.skip_reason).toBeUndefined()
		expect(mocked_skip_reason).not.toHaveBeenCalled()
	})
})

describe('build_gate_steps', () => {
	it('builds one step per planned check, in plan order', async () => {
		const plan = plan_of(WORKER_CAP, [
			check(LINT_LABEL),
			check(TYPE_CHECK_LABEL),
			check(UNIT_LABEL),
		])
		const steps = await build_gate_steps(START, plan)

		expect(steps.map((step) => step.label)).toStrictEqual([
			LINT_LABEL,
			TYPE_CHECK_LABEL,
			UNIT_LABEL,
		])
		expect(steps[2]?.command_args).toContain(CAPPED_WORKERS)
	})
})
