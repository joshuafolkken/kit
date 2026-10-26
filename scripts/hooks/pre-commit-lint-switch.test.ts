import { describe, expect, it } from 'vitest'
import { pre_commit_lint_switch } from './pre-commit-lint-switch'

// joshuafolkken/kit#4985: `josh ship`'s local commit and the hook name the same variable.
describe('pre_commit_lint_switch.SWITCH_ENV_KEY', () => {
	it('names the variable the environment reference documents', () => {
		expect(pre_commit_lint_switch.SWITCH_ENV_KEY).toBe('JOSH_PRE_COMMIT_LINT')
	})
})
