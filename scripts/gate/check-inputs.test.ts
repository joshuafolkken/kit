import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { describe, expect, it } from 'vitest'
import { check_inputs } from './check-inputs'
import { gate_plan } from './gate-plan'

// joshuafolkken/kit#3903: each scoped check names the paths it reads, over-approximating — a path in
// doubt is an input, and a check with no scope always runs.

const { EXPORTS_LABEL, LINT_LABEL, TYPE_CHECK_LABEL } = gate_plan
const SKILL_DOC = '.claude/skills/x/SKILL.md'
const SOURCE = 'scripts/gate/check-inputs.ts'

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
			check_inputs.touches_inputs(TYPE_CHECK_LABEL, ['pnpm-lock.yaml'], always_ignored),
		).resolves.toBe(true)
	})

	it('answers true for an unscoped check whatever moved', async () => {
		expect(check_inputs.is_scoped('cspell')).toBe(false)
		await expect(check_inputs.touches_inputs('cspell', [], never_ignored)).resolves.toBe(true)
	})
})

describe('check_inputs.prettier_ignored', () => {
	it('asks prettier, through this repository’s own ignore files', async () => {
		const is_ignored = check_inputs.prettier_ignored(PROJECT_ROOT)

		await expect(is_ignored(SKILL_DOC)).resolves.toBe(true)
		await expect(is_ignored(SOURCE)).resolves.toBe(false)
	})
})
