import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { epic_issue_schema } from '#scripts/git/git-schemas'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { error_text } from '#scripts/lib/error-message'
import { has_label_name, NOT_BEFORE_LABEL, REPOSITORY_LABELS } from './issue-labels'
import { issue_not_before } from './issue-not-before'
import { session_cite } from './session-cite'

// joshuafolkken/kit#4079: the body's start-time declaration held an issue back from `backlog:next`,
// but neither the issue listing nor `run:board` showed it waited on the clock. `not-before` is a copy
// of that declaration, kept here alone: the body stays the source, and this module is the one place
// that decides whether the copy is owed.

type LabelChange = 'add' | 'remove'

// One issue as the listings return it; `labels` may be absent.
interface LabelledIssue {
	number: number
	body?: string | undefined
	labels?: ReadonlyArray<{ name: string }> | undefined
}

const DEFINITION = REPOSITORY_LABELS.find((label) => label.name === NOT_BEFORE_LABEL)
const NOT_APPLIED = 'the label was not applied'
const LABELLED_LIMIT = 200

function is_waiting(body: string | undefined, now: number): boolean {
	return issue_not_before.waiting_date(body, now) !== undefined
}

// What the label owes one issue: `add` while the declared time is ahead and the label is absent,
// `remove` once the time has passed or the declaration is gone, else nothing.
function change_of(
	body: string | undefined,
	labels: ReadonlyArray<string>,
	now: number = Date.now(),
): LabelChange | undefined {
	const is_labelled = has_label_name(labels, NOT_BEFORE_LABEL)

	if (is_waiting(body, now) === is_labelled) return undefined

	return is_labelled ? 'remove' : 'add'
}

// The labels a new issue is filed with — the label added when its body declares a time still ahead.
function with_label(
	labels: ReadonlyArray<string>,
	body: string,
	now: number = Date.now(),
): ReadonlyArray<string> {
	return change_of(body, labels, now) === 'add' ? [...labels, NOT_BEFORE_LABEL] : labels
}

function changes_of(
	issues: ReadonlyArray<LabelledIssue>,
	now: number,
): ReadonlyArray<readonly [LabelledIssue, LabelChange]> {
	return issues.flatMap(function change(issue): Array<readonly [LabelledIssue, LabelChange]> {
		const names = (issue.labels ?? []).map((label) => label.name)
		const owed = change_of(issue.body, names, now)

		return owed === undefined ? [] : [[issue, owed]]
	})
}

// The addition answers `false` where the removal throws; both fail here the same way.
async function write(number: string, owed: LabelChange): Promise<void> {
	if (owed === 'remove') {
		await git_gh_issue_write.issue_remove_label(number, NOT_BEFORE_LABEL)

		return
	}

	if (!(await git_gh_issue_write.issue_add_label(number, NOT_BEFORE_LABEL))) {
		throw new Error(NOT_APPLIED)
	}
}

// A failed write is named and left: the next scan owes the same change and makes it then.
async function apply(issue: LabelledIssue, owed: LabelChange): Promise<void> {
	try {
		await write(String(issue.number), owed)
	} catch (error) {
		const cited = session_cite.issue(issue.number)

		console.warn(
			`${cited}: could not ${owed} \`${NOT_BEFORE_LABEL}\`: ${error_text.message_of(error)}`,
		)
	}
}

// Brings every issue's label in line with its body. The label is created before the first addition,
// so it carries its color and description rather than the ones GitHub generates for a missing label.
async function sync(issues: ReadonlyArray<LabelledIssue>, now: number = Date.now()): Promise<void> {
	const changes = changes_of(issues, now)

	if (DEFINITION !== undefined && changes.some(([, owed]) => owed === 'add')) {
		await git_gh_issue_write.label_ensure(DEFINITION)
	}

	await Promise.all(
		changes.map(async ([issue, owed]) => {
			await apply(issue, owed)
		}),
	)
}

// Every open issue already carrying the label. A failed read is an empty list: the next scan reads it
// again.
async function read_labelled(): Promise<ReadonlyArray<LabelledIssue>> {
	const { json } = await git_gh_command.issue_list_by_label(NOT_BEFORE_LABEL, LABELLED_LIMIT)
	const rows =
		json === undefined ? undefined : parse_json_array_or_undefined(json, epic_issue_schema)

	return (rows ?? []).map((row) => ({ ...row, labels: [{ name: NOT_BEFORE_LABEL }] }))
}

// `sync` over the scanned issues plus every issue the label is on. `issue:file` labels a filing that
// may never be scanned — one never opted in — so only the label's own listing reaches it to remove it.
async function sweep(
	scanned: ReadonlyArray<LabelledIssue>,
	now: number = Date.now(),
): Promise<void> {
	const seen = new Set(scanned.map((issue) => issue.number))
	const labelled = await read_labelled()

	await sync([...scanned, ...labelled.filter((issue) => !seen.has(issue.number))], now)
}

const issue_not_before_label = { change_of, sweep, sync, with_label }

export { issue_not_before_label }
