// `josh tree:status` — the working tree's read-only pre-check, assembled into one report.
// Before acting on what the tree holds, a session reads four facts: the branch, the uncommitted
// changes, the repository-wide stash stack, and which run holds this tree. This joins the answers
// `git status`, `git_stash` and `run_hold` give, reusing each rather than reproducing it.
//
// **It is read-only.** The hold is *read* (`run_hold.read_hold`), never claimed: `run:status` leaves
// the hold out because `run:hold`'s claim writes, and reading the record is not that claim.
//
// The leading summary line carries the four facts on one line, so the glance is read off the first
// line without parsing the sections below it.

const SUMMARY_PREFIX = 'tree — '
const BRANCH_LABEL = 'branch: '
const CHANGES_LABEL = 'changes: '
const STASH_LABEL = 'stash: '
const HOLD_LABEL = 'hold: '
const FIELD_SEPARATOR = ' · '
const STATUS_HEADER = '=== status ==='
const STASH_HEADER = '=== stash ==='
const HOLD_HEADER = '=== hold ==='
const SECTION_SEPARATOR = '\n\n'
const LINE_SEPARATOR = '\n'
const NO_STASH_NOTE = 'none'

interface TreeParts {
	branch: string
	// `git status --porcelain --branch` verbatim: the `## <branch>...<upstream>` line, then one line
	// per changed path, counted in `change_count`.
	status: string
	change_count: number
	// `stash@{n} <subject>` lines — the stack every work tree of the repository shares.
	stashes: ReadonlyArray<string>
	// The one-word form (`free`, `held`, `stale`, `unreadable`, `unknown`) and the full line, computed
	// by the CLI so this formatter stays a pure string join, as `run-status.ts` is.
	hold_summary: string
	hold_detail: string
}

function summary(parts: TreeParts): string {
	const fields = [
		`${BRANCH_LABEL}${parts.branch}`,
		`${CHANGES_LABEL}${String(parts.change_count)}`,
		`${STASH_LABEL}${String(parts.stashes.length)}`,
		`${HOLD_LABEL}${parts.hold_summary}`,
	]

	return `${SUMMARY_PREFIX}${fields.join(FIELD_SEPARATOR)}`
}

function stash_body(stashes: ReadonlyArray<string>): string {
	return stashes.length === 0 ? NO_STASH_NOTE : stashes.join(LINE_SEPARATOR)
}

function section(header: string, body: string): string {
	return `${header}\n${body}`
}

function format_report(parts: TreeParts): string {
	return [
		summary(parts),
		section(STATUS_HEADER, parts.status),
		section(STASH_HEADER, stash_body(parts.stashes)),
		section(HOLD_HEADER, parts.hold_detail),
	].join(SECTION_SEPARATOR)
}

const tree_status = {
	HOLD_HEADER,
	NO_STASH_NOTE,
	STASH_HEADER,
	STATUS_HEADER,
	SUMMARY_PREFIX,
	format_report,
}

export type { TreeParts }
export { tree_status }
