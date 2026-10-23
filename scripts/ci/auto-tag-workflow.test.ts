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

// The dispatch payload's sha is only a claim, so auto-tag verifies it before checking it out
// (joshuafolkken/kit#4651).
const VERIFY_STEP_NAME = 'Verify the dispatched commit'
const CHECKOUT_ACTION = 'actions/checkout@'
const NOTIFY_JOB = 'notify-auto-tag'
const CI_WORKFLOWS = ['.github/workflows/ci.yml', 'templates/workflows/ci.yml']

function verify_run(): string {
	return auto_tag_steps().find((step) => step.name === VERIFY_STEP_NAME)?.run ?? ''
}

function step_index(predicate: (step: WorkflowStep) => boolean): number {
	return auto_tag_steps().findIndex((step) => predicate(step))
}

describe('auto-tag.yml — dispatched commit verification', () => {
	it('verifies the dispatched sha before the checkout', () => {
		const verify_index = step_index((step) => step.name === VERIFY_STEP_NAME)
		const checkout_index = step_index((step) => step.uses?.startsWith(CHECKOUT_ACTION) ?? false)

		expect(verify_index).toBeGreaterThanOrEqual(0)
		expect(verify_index).toBeLessThan(checkout_index)
	})

	it('fails unless main contains the sha', () => {
		const run = verify_run()

		expect(run).toContain('gh api "repos/$GH_REPO/compare/main...$SHA"')
		expect(run).toContain('[ "$STATUS" != "identical" ] && [ "$STATUS" != "behind" ]')
	})

	it('fails unless a push-event CI run on main for the sha reached its notify job', () => {
		const run = verify_run()

		expect(run).toContain('actions/workflows/ci.yml/runs?head_sha=$SHA&event=push&branch=main')
		expect(run).toContain("grep -Eqx 'in_progress/null|completed/success'")
		expect(run.trimEnd().endsWith('exit 1')).toBe(true)
	})

	it.each(CI_WORKFLOWS)('names the notify job exactly as %s does', (workflow_path) => {
		const job_name = ci_yml_fixture.find_job(workflow_path, NOTIFY_JOB)?.name ?? ''

		expect(job_name).not.toBe('')
		expect(verify_run()).toContain(`select(.name == "${job_name}")`)
	})
})

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
