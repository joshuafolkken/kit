import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const CLASSIFICATION_YML = '.github/workflows/pr-classification.yml'
const CLASSIFICATION_JOB = 'classification'
const CLASSIFICATION_STEP = 'Check release classification'
const CI_WORKFLOWS = [
	{ path: ci_yml_fixture.RUNTIME_CI_YML, job_name: 'static-checks' },
	{ path: ci_yml_fixture.TEMPLATE_CI_YML, job_name: 'checks' },
]
const CI_EVENTS = ['opened', 'synchronize', 'reopened']
const CLASSIFICATION_EVENTS = [...CI_EVENTS, 'labeled', 'unlabeled']

function pull_request_types(path: string): Array<string> | undefined {
	const workflow = ci_yml_fixture.read_workflow(path)
	const pull_request = /pull_request:\n\s+branches: \[main\]\n\s+types: \[([^\]]+)\]/u.exec(
		workflow,
	)

	return pull_request?.[1]?.split(', ')
}

// A label event on CI started a second run on the same commit, and CI's per-ref concurrency cancelled
// one of the two — a cancelled run in the newer check suite blocked the merge (joshuafolkken/kit#2712).
describe.each(CI_WORKFLOWS)('CI in $path', ({ path, job_name }) => {
	it('does not rerun on label additions or removals', () => {
		expect(pull_request_types(path)).toEqual(CI_EVENTS)
	})

	it('leaves the classification check to its own workflow', () => {
		const job = ci_yml_fixture.find_job(path, job_name)

		expect(job?.steps?.map((step) => step.name)).not.toContain(CLASSIFICATION_STEP)
	})
})

describe('release classification workflow', () => {
	it('reruns on creation, changes, and label additions or removals', () => {
		expect(pull_request_types(CLASSIFICATION_YML)).toEqual(CLASSIFICATION_EVENTS)
	})

	it('never cancels a run, so no cancelled suite is left on the commit', () => {
		const workflow = ci_yml_fixture.load_workflow(CLASSIFICATION_YML)

		expect(workflow.concurrency).toBeUndefined()
		expect(Object.values(workflow.jobs).map((job) => job.concurrency)).toEqual([undefined])
	})

	it('runs the shared classification check with a token to read the current labels', () => {
		const job = ci_yml_fixture.find_job(CLASSIFICATION_YML, CLASSIFICATION_JOB)
		const step = job?.steps?.find((candidate) => candidate.name === CLASSIFICATION_STEP)

		expect(step).toMatchObject({
			run: 'pnpm josh pr:classification',
			env: { GH_TOKEN: '${{ github.token }}' },
		})
	})
})
