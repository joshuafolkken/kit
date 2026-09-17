import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

function ci_yml_contents(): string {
	return ci_yml_fixture.read_workflow(ci_yml_fixture.TEMPLATE_CI_YML)
}

describe('ci.yml unit step (templates/workflows/ci.yml)', () => {
	it('routes the unit test step through the guarded josh test:unit command', () => {
		expect(ci_yml_contents()).toContain('run: pnpm josh test:unit')
	})

	// joshuafolkken/kit#1224 decided what that guard answers, and the template's reason for going
	// through it is now both halves of the answer rather than only the lenient one: a project with
	// no vitest skips and stays green, while a project that has vitest and no test file fails. A
	// direct `vitest run` here would lose the second half as surely as it lost the first.
	it('does not invoke vitest directly so the guard decides between the skip and the failure', () => {
		expect(ci_yml_contents()).not.toContain('pnpm exec vitest run')
	})
})
