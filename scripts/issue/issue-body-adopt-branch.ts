// joshuafolkken/kit#9148: the Issue body's adopt-branch row (`- <key>: wip/<name> @ <sha>`) — the consultation
// session's wip branch the lane takes in at its entry and the merge requires. `run:handoff --wip` writes
// it through `issue:file`, `issue:lint` refuses a malformed one, and the lane entry and the pre-merge check
// read it here; the key is `issue-body-keys.ts`'s `adopt_branch`.

import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_body_keys } from '#scripts/issue/issue-body-keys'
import { issue_cite } from '#scripts/issue/issue-cite'
import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'

const ROW_VALUE = /^(?<branch>wip\/\S+) @ (?<sha>[0-9a-f]{7,40})$/u
const NEWLINE = '\n'

interface AdoptBranch {
	branch: string
	sha: string
}

// `issue:file`'s filing as the row sees it: its `--found-during`, its route label, and the handed-down
// value (the environment's when absent).
interface HandoffFiling {
	found_during?: string | undefined
	route?: string | undefined
	value?: string | undefined
}

type AdoptRead =
	{ kind: 'none' } | { kind: 'row'; row: AdoptBranch } | { kind: 'malformed'; note: string }

function row_prefix(): string {
	return issue_body_keys.prefix('adopt_branch')
}

// The value after the key on every row line, in either column.
function values_of(body: string): ReadonlyArray<string> {
	const prefixes = issue_body_keys.prefix_variants('adopt_branch')

	return body
		.split(NEWLINE)
		.map((raw) => raw.trim())
		.flatMap((text) => {
			const found = prefixes.find((prefix) => text.startsWith(prefix))

			return found === undefined ? [] : text.slice(found.length).trim()
		})
}

function value_read(value: string): AdoptRead {
	const { branch, sha } = ROW_VALUE.exec(value)?.groups ?? {}

	if (branch === undefined || sha === undefined) {
		return { kind: 'malformed', note: `\`${row_prefix()}\` must read \`wip/<name> @ <sha>\`` }
	}

	return { kind: 'row', row: { branch, sha } }
}

// The body's row: `none` without one, `malformed` when it lacks the branch or sha or appears twice.
function read(body: string): AdoptRead {
	const [first, ...others] = values_of(body)

	if (first === undefined) return { kind: 'none' }

	if (others.length > 0) {
		return { kind: 'malformed', note: `more than one \`${row_prefix()}\` line` }
	}

	return value_read(first)
}

// `issue:lint`'s refusal of a malformed row; none without a row or with a well-formed one.
function problems(body: string): ReadonlyArray<string> {
	const present = read(body)

	return present.kind === 'malformed' ? [present.note] : []
}

function line(row: AdoptBranch): string {
	return `${row_prefix()} ${row.branch} @ ${row.sha}`
}

// Where the row goes: before the first bullet under the background heading, else at the body's end.
function insert_at(lines: ReadonlyArray<string>): number {
	const heading = lines.indexOf(issue_body_keys.heading('background'))
	const bullet = lines.findIndex((text, at) => at > heading && text.startsWith('- '))

	return heading === -1 || bullet === -1 ? lines.length : bullet
}

// `body` carrying `row`: unchanged when it already names the same branch and sha, the row inserted when
// it has none, and a problem when it names another or a malformed one.
function with_row(body: string, row: AdoptBranch): { body: string } | { problem: string } {
	const present = read(body)

	if (present.kind === 'malformed') return { problem: present.note }

	if (present.kind === 'row') {
		const is_same = line(present.row) === line(row)

		return is_same ? { body } : { problem: `the body names ${line(present.row)}, not ${line(row)}` }
	}

	const lines = body.split(NEWLINE)

	lines.splice(insert_at(lines), 0, line(row))

	return { body: lines.join(NEWLINE) }
}

// The `JOSH_HANDOFF_WIP` value `run:handoff --wip` hands its child: `wip/<name>@<sha>`.
function from_environment(value: string | undefined): AdoptBranch | undefined {
	const at = value?.lastIndexOf('@') ?? -1

	if (value === undefined || at <= 0) return undefined

	return { branch: value.slice(0, at), sha: value.slice(at + 1) }
}

function to_environment(row: AdoptBranch): string {
	return `${row.branch}@${row.sha}`
}

const ENVIRONMENT_KEY = 'JOSH_HANDOFF_WIP'

// A follow-up (`--found-during`) or a split child (`--route split`, one of several `kickoff new`
// deliverables) is never the one Issue the hand-off files, so the wip is not its to take in.
function is_side_filing(filing: HandoffFiling): boolean {
	return filing.found_during !== undefined || filing.route === SPLIT_ROUTE_LABEL
}

// `issue:file`'s body: carrying the row `run:handoff --wip` handed down in `value`, unchanged without one
// or on a side filing.
function with_handoff_row(
	body: string,
	filing: HandoffFiling = {},
): { body: string } | { problem: string } {
	const { value = process.env[ENVIRONMENT_KEY] } = filing
	const row = is_side_filing(filing) ? undefined : from_environment(value)

	return row === undefined ? { body } : with_row(body, row)
}

// The Issue's row, read live; a body that could not be read is `malformed` with the reason, never `none`.
async function read_issue(issue_number: string): Promise<AdoptRead> {
	const fetched = await git_gh_issue_read.issue_get_body_classified(issue_number)

	if (fetched.kind !== 'read') {
		const cited = issue_cite.plain_for('terminal', issue_number)

		return { kind: 'malformed', note: `could not read ${cited}'s body (${fetched.kind})` }
	}

	return read(fetched.text ?? '')
}

const issue_body_adopt_branch = {
	ENVIRONMENT_KEY,
	from_environment,
	problems,
	read,
	read_issue,
	to_environment,
	with_handoff_row,
	with_row,
}

export type { AdoptBranch, AdoptRead }
export { issue_body_adopt_branch }
