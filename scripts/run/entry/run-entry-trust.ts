import { issue_cite } from '#scripts/issue/issue-cite'
import type { BlockRead } from '#scripts/issue/issue-read-cli'
import { issue_state } from '#scripts/issue/issue-state'
import type { StateRead } from '#scripts/issue/issue-state-cli'

// **An issue filed by an author without write access is not run on its own body**
// (joshuafolkken/kit#4663). `backlogrun` never offers one, but a person can still name it as
// `fullrun #N`, and its body would then reach the run as the specification. The run goes ahead only
// once a trusted person has planned it with `kickoff #N` — the `run:planned` label and a comment from
// an author with write access, the plan the run then follows instead of the body. Both, because the
// label alone is within triage access and a trusted comment alone may be an automated one.
//
// Decided from the reads `run:prep` already made, so the gate costs no further call. A read that
// failed is not judged here: `run:entry` already exits non-zero on it.

const STOP_REASON =
	'the issue author does not have write access, and no trusted `kickoff` plan is on the issue'

// The remedy, named with the issue: a trusted person's `kickoff` writes the plan the run will follow.
function recommended(issue_number: string): string {
	return `Have a person with write access run \`kickoff ${issue_cite.plain(issue_number)}\`, then run it again`
}

function stop_note(issue_number: string): string {
	return `(issue author not trusted — ${recommended(issue_number)})`
}

// The `kickoff` plan is a comment here, never the body: `issue_body_or_comment` writes no plan into a
// body this gate would still judge by its untrusted author.
function needs_trusted_plan(content: BlockRead, state: StateRead): boolean {
	if (content.kind !== 'ok' || content.trust.is_body_trusted) return false

	return !(issue_state.is_planned(state) && content.trust.has_trusted_comment)
}

const run_entry_trust = { STOP_REASON, needs_trusted_plan, recommended, stop_note }

export { run_entry_trust }
