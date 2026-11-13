import { issue_body_keys } from './issue-body-keys'

const URL = 'https://github.com/joshuafolkken/kit/issues/7400#issuecomment-123'
const KEYS = ['multi-slot', 'same-head', 'comparison', 'cost']
const BODY = `${issue_body_keys.heading('background')}\n<!-- josh:observation-wait:v1 ${URL} ${KEYS.join(',')} -->`
const EVIDENCE = 'https://github.com/joshuafolkken/kit/pull/7399'

function comment(completed: ReadonlyArray<string> = []): string {
	const tasks = KEYS.map(
		(key) =>
			`- [${completed.includes(key) ? 'x' : ' '}] ${key}: required ${key} [evidence](${EVIDENCE})`,
	)

	return `## Observation evidence\n${tasks.join('\n')}`
}

const issue_observation_fixture = { URL, KEYS, BODY, EVIDENCE, comment }

export { issue_observation_fixture }
