import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { session_cite } from '#scripts/issue/session-cite'

// The adoption of a park option that files an Issue (joshuafolkken/kit#7771): adopting records a
// choice and files nothing, so a requeued child hits the same wall again. `--done` must name the
// filed Issue `#M` while it is open; the child is then blocked by `#M` (`epic --blocked-by`'s
// relation, idempotent) and not requeued — `#M`'s merge re-dispatches it
// (`backlog_drive_retry.after_merge`, which reads the park's event and the blocked-by relation).

const FILED = /#([1-9]\d*)/u
const OPEN_STATE = 'OPEN'

function filed_of(done: string): number | undefined {
	const number = FILED.exec(done)?.[1]

	return number === undefined ? undefined : Number(number)
}

function file_first(issue: string): string {
	return `the option files an Issue; file it with \`pnpm josh issue:file "<title>" --body-file <path> --route interrupt --found-during ${issue} --blocks-finder\`, then re-run with --done "filed #<M>" — nothing was written and the child stays parked`
}

async function is_open(filed: number): Promise<boolean> {
	const read = await issue_state_cli.read_issue(String(filed))

	return read.kind === 'state' && read.state.state === OPEN_STATE
}

// Why the filing `--done` names cannot be waited on; `undefined` for an open `#M`.
async function problem_of(issue: string, done: string): Promise<string | undefined> {
	const filed = filed_of(done)

	if (filed === undefined) return file_first(issue)
	if (await is_open(filed)) return undefined

	return `${session_cite.issue(String(filed))} is not open, so the child cannot wait on it — nothing was written`
}

// Blocks the child by the filed Issue; the record's status (`already`, `recorded`, …).
async function block(issue: string, done: string): Promise<string> {
	const prerequisite = String(filed_of(done))

	return await epic_blocked_by.record({ issue, prerequisite, is_relation_only: true })
}

const backlog_triage_filing = { block, filed_of, problem_of }

export { backlog_triage_filing }
