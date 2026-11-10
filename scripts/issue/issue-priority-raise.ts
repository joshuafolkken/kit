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

const PRIORITY_LABELS: ReadonlySet<string> = new Set(
	Object.values(issue_priority.LABELS).filter((label) => label !== undefined),
)

function priority_labels_of(labels: ReadonlyArray<string>): ReadonlyArray<string> {
	return labels.filter((label) => PRIORITY_LABELS.has(label))
}

// Whether the issue's priority labels are exactly `label` — none at all for `undefined`, normal.
function is_only(labels: ReadonlyArray<string>, label: string | undefined): boolean {
	const present = priority_labels_of(labels)

	return present.length === (label === undefined ? 0 : 1) && present.every((name) => name === label)
}

// joshuafolkken/kit#7000: a priority change leaves one priority label. The new label goes on before the
// others come off, so a failed write never leaves the issue below either rank.
async function replace(
	issue_number: string,
	labels: ReadonlyArray<string>,
	label: string | undefined,
): Promise<boolean> {
	const is_added =
		label === undefined ||
		labels.includes(label) ||
		(await git_gh_command.issue_add_label(issue_number, label))

	if (!is_added) return false
	const stale = priority_labels_of(labels).filter((name) => name !== label)
	const cleared = await Promise.all(
		stale.map(async (name) => await git_gh_command.issue_clear_label(issue_number, name)),
	)

	return cleared.every(Boolean)
}

async function raise(issue_number: string): Promise<RaiseResult> {
	const read = await read_issue(issue_number)

	if (read === undefined) return 'unreadable'
	const label = issue_priority.raise_label(read.labels, read.body)

	if (label === undefined) return decision(read.labels)
	const is_applied = await replace(issue_number, read.labels, label)

	return is_applied ? 'raised' : 'failed'
}

// The answers that leave the body's floor unapplied — every caller reports these as a failure.
const FAILURES: ReadonlySet<RaiseResult> = new Set(['unreadable', 'failed'])

function is_failure(result: RaiseResult): boolean {
	return FAILURES.has(result)
}

const issue_priority_raise = { read_issue, is_only, replace, raise, is_failure }

export type { RaiseResult }
export { issue_priority_raise }
