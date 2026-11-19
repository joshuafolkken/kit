import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { prepared_prerequisite, type Publication } from '#scripts/issue/prepared-prerequisite'
import { session_cite } from '#scripts/issue/session-cite'
import { error_text } from '#scripts/lib/error-message'

// The adoption of a park option that files an Issue (joshuafolkken/kit#7771): adopting records a
// choice and files nothing, so a requeued child hits the same wall again. `--done` must name the
// filed Issue `#M` while it is open; the child is then blocked by `#M` (`epic --blocked-by`'s
// relation, idempotent) and not requeued — `#M`'s merge re-dispatches it
// (`backlog_drive_retry.after_merge`, which reads the park's event and the blocked-by relation).

// A bare `#M` only: `owner/repo#M` is another repository's Issue, which this one cannot be blocked by.
const FILED = /(?<![\w/.-])#([1-9]\d*)/u
const OPEN_STATE = 'OPEN'
const TRIAGE_WORDING = { outcome: 'nothing was written.', rerun: 'rerun this triage' }

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

// Why a prepared `#M` cannot be waited on yet — no recorded plan — or `undefined` (joshuafolkken/kit#8222):
// both triage paths that record a wait ask it before writing anything, as `run:pause` does.
async function prepared_problem(prerequisite: string): Promise<string | undefined> {
	return await prepared_prerequisite.refusal(prerequisite, TRIAGE_WORDING)
}

function publication_line(prerequisite: string, { epic, reason }: Publication): string {
	if (reason === undefined) return `published ${session_cite.issue(String(epic))}`
	const target = epic === undefined ? '<epic>' : String(epic)

	return `${session_cite.issue(prerequisite)} not published: ${reason} — next: \`pnpm josh issue:file --publish ${target}\``
}

// The epic listing a prepared `#M` published once the wait is recorded, as one line, or `undefined`
// when `#M` is not prepared. The wait already stands, so a withheld publish is reported, not failed.
async function publish_after(prerequisite: string): Promise<string | undefined> {
	try {
		const publication = await prepared_prerequisite.publish(prerequisite)
		if (publication === prepared_prerequisite.NOT_PREPARED) return undefined

		return publication_line(prerequisite, publication)
	} catch (error) {
		return publication_line(prerequisite, { epic: undefined, reason: error_text.message_of(error) })
	}
}

// Why the filing `--done` names cannot be waited on; `undefined` for an open `#M` it may wait on.
async function problem_of(issue: string, done: string): Promise<string | undefined> {
	const filed = filed_of(done)

	if (filed === undefined) return file_first(issue)
	if (await is_open(filed)) return await prepared_problem(String(filed))

	return `${session_cite.issue(String(filed))} is not open, so the child cannot wait on it — nothing was written`
}

// Blocks the child by the filed Issue, then publishes a prepared `#M`; the record's status
// (`already`, `recorded`, …), followed by the publication's line when there was one.
async function block(issue: string, done: string): Promise<string> {
	const prerequisite = String(filed_of(done))
	const status = await epic_blocked_by.record({ issue, prerequisite, is_relation_only: true })
	const published = await publish_after(prerequisite)

	return published === undefined ? status : `${status} · ${published}`
}

const backlog_triage_filing = { block, filed_of, prepared_problem, problem_of, publish_after }

export { backlog_triage_filing }
