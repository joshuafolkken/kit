import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

function ci_yml_contents(): string {
	return ci_yml_fixture.read_workflow(ci_yml_fixture.TEMPLATE_CI_YML)
}

describe('ci.yml unit step (templates/workflows/ci.yml)', () => {
	it('routes the unit test step through the guarded josh test:unit command', () => {
		expect(ci_yml_contents()).toContain('run: pnpm josh test:unit')
	})

	it('does not invoke vitest directly so a fresh project can skip gracefully', () => {
		expect(ci_yml_contents()).not.toContain('pnpm exec vitest run')
	})
})
