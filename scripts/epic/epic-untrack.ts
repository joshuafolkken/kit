import { git_gh_command } from '#scripts/gh/git-gh-command'
import { epic_read } from './epic-read'
import { epic_relations } from './epic-relations'
import { epic_untrack_plan } from './epic-untrack-plan'

const FAILURE = 1
const SUCCESS = 0

function refuse(error: string): number {
	console.error(`✖ ${error}`)

	return FAILURE
}

async function untrack(epic_number: number, children: ReadonlyArray<number>): Promise<number> {
	const reading = await epic_read.read_epic(epic_number)
	if ('error' in reading) return refuse(reading.error)
	const outcome = epic_untrack_plan.build_plan(reading, children)
	if ('error' in outcome) return refuse(outcome.error)

	const failures = await epic_relations.apply_relations(outcome.plan.removed, 'drop')

	console.info(
		epic_relations.format_relation_report({
			failures,
			links: outcome.plan.removed,
			action: 'drop',
		}),
	)

	if (failures > 0) return FAILURE

	if (outcome.plan.body !== reading.subject.body) {
		await git_gh_command.issue_edit_body(String(epic_number), outcome.plan.body)
	}

	return SUCCESS
}

const epic_untrack = { untrack }

export { epic_untrack }
