import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_label_schema } from '#scripts/git/git-schemas'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import { issue_priority } from './issue-priority'

// joshuafolkken/kit#4960: an open Issue's body can rise after it was filed — a recurrence appends a
// cause-loss line, an edit declares a priority — and the body edit applies no label. This re-reads the
// body and applies the label of its filed level or floor, as `josh issue:file` would have (joshuafolkken/kit#6757).

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

// The decision for an issue its labels already rank at its filed level: a priority label wins, as a
// typed one does at filing.
function decision(labels: ReadonlyArray<string>): RaiseResult {
	return issue_priority.is_typed(labels) ? 'labelled' : 'below'
}

async function raise(issue_number: string): Promise<RaiseResult> {
	const read = await read_issue(issue_number)

	if (read === undefined) return 'unreadable'
	const label = issue_priority.raise_label(read.labels, read.body)

	if (label === undefined) return decision(read.labels)
	const is_applied = await git_gh_command.issue_add_label(issue_number, label)

	return is_applied ? 'raised' : 'failed'
}

// The answers that leave the body's floor unapplied — every caller reports these as a failure.
const FAILURES: ReadonlySet<RaiseResult> = new Set(['unreadable', 'failed'])

function is_failure(result: RaiseResult): boolean {
	return FAILURES.has(result)
}

const issue_priority_raise = { read_issue, raise, is_failure }

export type { RaiseResult }
export { issue_priority_raise }
