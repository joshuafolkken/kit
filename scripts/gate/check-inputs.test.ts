import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { test_related } from '#scripts/test/test-related'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { check_inputs } from './check-inputs'
import { gate_plan } from './gate-plan'

// joshuafolkken/kit#3903: each scoped check names the paths it reads, over-approximating — a path in
// doubt is an input, and a check with no scope always runs.

const { EXPORTS_LABEL, LINT_LABEL, METRICS_LABEL, TYPE_CHECK_LABEL } = gate_plan
const SKILL_DOC = '.claude/skills/x/SKILL.md'
const SOURCE = 'scripts/gate/check-inputs.ts'
const LOCK_FILE = 'pnpm-lock.yaml'

async function never_ignored(): Promise<boolean> {
	return false
}

async function always_ignored(): Promise<boolean> {
	return true
}

describe('check_inputs.touches_inputs', () => {
	it('reads a source module as an input of every scoped check', async () => {
		const labels = [LINT_LABEL, TYPE_CHECK_LABEL, EXPORTS_LABEL]
		const answers = await Promise.all(
			labels.map(
				async (label) => await check_inputs.touches_inputs(label, [SOURCE], never_ignored),
			),
		)

		expect(answers).toStrictEqual([true, true, true])
	})

	it('leaves a document out of the type check but not out of lint', async () => {
		await expect(
			check_inputs.touches_inputs(TYPE_CHECK_LABEL, ['README.md'], never_ignored),
		).resolves.toBe(false)
		await expect(
			check_inputs.touches_inputs(LINT_LABEL, ['README.md'], never_ignored),
		).resolves.toBe(true)
	})

	it('leaves a prettier-ignored document out of lint', async () => {
		await expect(
			check_inputs.touches_inputs(LINT_LABEL, [SKILL_DOC], always_ignored),
		).resolves.toBe(false)
	})

	it('reads a lock file as an input of every scoped check', async () => {
		await expect(
			check_inputs.touches_inputs(TYPE_CHECK_LABEL, [LOCK_FILE], always_ignored),
		).resolves.toBe(true)
	})

	it('answers true for an undeclared check whatever moved', async () => {
		await expect(check_inputs.touches_inputs('cspell', [], never_ignored)).resolves.toBe(true)
	})
})

// joshuafolkken/kit#4085: metrics reads the scripts, the approvals and the Markdown it measures.
describe('check_inputs.touches_inputs for metrics', () => {
	it.each([SOURCE, 'prompts/review.md', '.josh/metrics-accepted/4085.json', 'package.json'])(
		'reads %j as an input of metrics',
		async (relative) => {
			await expect(
				check_inputs.touches_inputs(METRICS_LABEL, [relative], never_ignored),
			).resolves.toBe(true)
		},
	)

	it('leaves a spelling list or a workflow file out of metrics', async () => {
		await expect(
			check_inputs.touches_inputs(
				METRICS_LABEL,
				['cspell.config.yaml', '.github/workflows/ci.yml'],
				never_ignored,
			),
		).resolves.toBe(false)
	})
})

// joshuafolkken/kit#4314: the unit step's inputs are what `josh test:related` would run tests for.
describe('check_inputs.touches_inputs for the unit step', () => {
	const { UNIT_LABEL } = gate_plan

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('asks test:related whether the moved set reaches a test', async () => {
		const reaches = vi.spyOn(test_related, 'reaches_tests').mockResolvedValue(false)

		await expect(
			check_inputs.touches_inputs(UNIT_LABEL, ['README.md'], never_ignored, PROJECT_ROOT),
		).resolves.toBe(false)
		expect(reaches).toHaveBeenCalledWith(PROJECT_ROOT, ['README.md'])
	})

	it.each([LOCK_FILE, 'vitest.config.ts'])(
		'reads %j as an input without asking',
		async (relative) => {
			const reaches = vi.spyOn(test_related, 'reaches_tests').mockResolvedValue(false)

			await expect(
				check_inputs.touches_inputs(UNIT_LABEL, [relative], never_ignored),
			).resolves.toBe(true)
			expect(reaches).not.toHaveBeenCalled()
		},
	)
})

describe('check_inputs.prettier_ignored', () => {
	it('asks prettier, through this repository’s own ignore files', async () => {
		const is_ignored = check_inputs.prettier_ignored(PROJECT_ROOT)

		await expect(is_ignored(SKILL_DOC)).resolves.toBe(true)
		await expect(is_ignored(SOURCE)).resolves.toBe(false)
	})
})
