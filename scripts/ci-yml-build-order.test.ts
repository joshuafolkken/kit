import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const BUILD_STEP = 'run: pnpm build'
const ESLINT_STEP = 'run: pnpm exec eslint'

function step_index(needle: string): number {
	const lines = ci_yml_fixture.read_workflow(ci_yml_fixture.TEMPLATE_CI_YML).split('\n')

	return lines.findIndex((line) => line.includes(needle))
}

describe('ci.yml build order (templates/workflows/ci.yml)', () => {
	it('builds before the eslint step so generated outputs exist for type-aware linting', () => {
		const build_index = step_index(BUILD_STEP)
		const eslint_index = step_index(ESLINT_STEP)

		expect(build_index).toBeGreaterThanOrEqual(0)
		expect(eslint_index).toBeGreaterThanOrEqual(0)
		expect(build_index).toBeLessThan(eslint_index)
	})
})
