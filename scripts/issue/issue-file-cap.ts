import { issue_file_fold } from './issue-file-fold'
import { session_cite } from './session-cite'

// The automatic-filing cap, asked by `josh issue:file` itself as the fold and the WIP cap are.
//
// **Ten filings per originating work item, refused at the eleventh** (joshuafolkken/kit#4750). The
// origin is the fold's finder — the `--found-during` the filing names, else the lane child's mark, else
// the Issue the checkout's branch names — so a lane's filings, a long lane the parent investigated and
// the Issue a prerequisite came out of are each their own count. The count is the origin's `filed`
// events on the repository's event stream, read whole, so it outlives a session cut; a transcript tail
// counted every origin a long session touched against one ceiling and forgot each filing once it
// scrolled out (joshuafolkken/kit#2119).
//
// **A filing with no origin counts against the invocation running** — the carry record's scope the fold
// reads for it too — so a retrospective's or a parent's own filings are one count per run, and a filing
// outside any run counts against nothing. **A failed filing never counts**: `issue:file` appends its
// `filed` event only once the Issue exists.

const FILING_CAP = 10

// How many Issues the origin has already filed.
async function prior_count(origin: string | undefined): Promise<number> {
	const events = await issue_file_fold.events_of(origin)

	return issue_file_fold.finder_filings(events, origin).length
}

function owner_of(origin: string | undefined): string {
	return origin === undefined ? 'this run (no originating Issue)' : session_cite.issue(origin)
}

function reason_of(origin: string | undefined): string {
	return (
		`✖ filing cap: ${owner_of(origin)} has already filed ${String(FILING_CAP)} Issues, the ceiling ` +
		"per originating work item. Stop filing and report; a further Issue is a person's call " +
		'(`.claude/skills/workflow-commands/prerequisite.md`).'
	)
}

// Whether the filing may go on: `false`, with the reason printed, once its origin's count stands at the
// cap — this filing would be the eleventh.
async function is_cap_clear(named: string | undefined): Promise<boolean> {
	const origin = await issue_file_fold.finder(named)

	if ((await prior_count(origin)) < FILING_CAP) return true
	console.error(reason_of(origin))

	return false
}

const issue_file_cap = { FILING_CAP, is_cap_clear, reason_of }

export { issue_file_cap }
