import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_label_schema } from '#scripts/git/git-schemas'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import { PRIORITY_HIGH_LABEL } from './issue-labels'
import { issue_priority } from './issue-priority'

// joshuafolkken/kit#4960: an open Issue's body can reach the high floor after it was filed — a
// recurrence appends a cause-loss line to it — and the body edit applies no label. This re-reads the
// body and applies `priority:high` once its floor is high, as `josh issue:file` would have.

type RaiseResult = 'raised' | 'labelled' | 'below' | 'unreadable' | 'failed'

const read_schema = z.object({
	labels: z.array(issue_label_schema).optional(),
	body: z.string().nullish(),
})

interface LabelsAndBody {
	labels: ReadonlyArray<string>
	body: string
}

async function read_issue(issue_number: string): Promise<LabelsAndBody | undefined> {
	const raw = await git_gh_command.issue_get_labels_and_body(issue_number)
	const parsed = raw === undefined ? undefined : parse_json_object_or_undefined(raw, read_schema)

	if (parsed === undefined) return undefined

	return { labels: (parsed.labels ?? []).map((label) => label.name), body: parsed.body ?? '' }
}

// A priority label already on the issue wins, as a typed one does at filing.
function decision(read: LabelsAndBody): RaiseResult | undefined {
	if (issue_priority.is_typed(read.labels)) return 'labelled'

	return issue_priority.floor_of(read.body) === 'high' ? undefined : 'below'
}

async function raise(issue_number: string): Promise<RaiseResult> {
	const read = await read_issue(issue_number)

	if (read === undefined) return 'unreadable'
	const decided = decision(read)

	if (decided !== undefined) return decided
	const is_applied = await git_gh_command.issue_add_label(issue_number, PRIORITY_HIGH_LABEL)

	return is_applied ? 'raised' : 'failed'
}

const issue_priority_raise = { raise }

export type { RaiseResult }
export { issue_priority_raise }
