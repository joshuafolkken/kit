import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowStep } from './ci-yml-fixture'

// auto-tag.yml installs nothing and reads package.json with jq, so a Node.js setup step only added
// time to every release (joshuafolkken/kit#3326).
const AUTO_TAG_YML = '.github/workflows/auto-tag.yml'
const SETUP_NODE_USES = './.github/actions/setup-node'
const NODE_COMMAND_PATTERN = /\bnode\s/u

function auto_tag_steps(): ReadonlyArray<WorkflowStep> {
	return ci_yml_fixture.find_job(AUTO_TAG_YML, 'create-tag')?.steps ?? []
}

describe('auto-tag.yml without Node.js', () => {
	it('sets no Node.js version up', () => {
		expect(auto_tag_steps().some((step) => step.uses === SETUP_NODE_USES)).toBe(false)
	})

	it('runs no node command', () => {
		const steps = auto_tag_steps()
		const node_runs = steps.filter((step) => NODE_COMMAND_PATTERN.test(step.run ?? ''))

		expect(steps.length).toBeGreaterThan(0)
		expect(node_runs).toEqual([])
	})
})
