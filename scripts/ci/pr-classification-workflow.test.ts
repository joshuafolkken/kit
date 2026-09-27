import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const WORKFLOWS = [
	{ path: ci_yml_fixture.RUNTIME_CI_YML, job_name: 'static-checks' },
	{ path: ci_yml_fixture.TEMPLATE_CI_YML, job_name: 'checks' },
]
const LABEL_EVENTS = ['opened', 'synchronize', 'reopened', 'labeled', 'unlabeled']

describe.each(WORKFLOWS)('release classification workflow in $path', ({ path, job_name }) => {
	it('reruns on creation, changes, and label additions or removals', () => {
		const workflow = ci_yml_fixture.read_workflow(path)
		const pull_request = /pull_request:\n\s+branches: \[main\]\n\s+types: \[([^\]]+)\]/u.exec(
			workflow,
		)

		expect(pull_request?.[1]?.split(', ')).toEqual(LABEL_EVENTS)
	})

	it('runs the shared classification check only for pull requests', () => {
		const job = ci_yml_fixture.find_job(path, job_name)
		const step = job?.steps?.find((candidate) => candidate.name === 'Check release classification')

		expect(step?.if).toBe("github.event_name == 'pull_request'")
		expect(step?.run).toBe('pnpm josh pr:classification')
	})
})
