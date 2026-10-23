import { issue_cite } from '#scripts/issue/issue-cite'
import type { BlockRead, BlockTrust } from '#scripts/issue/issue-read-cli'
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
//
// **A trust read that failed stops as the failed read it is** (#4703) — a write-access lookup, the
// comment listing or the label read that answered nothing still stops the run, but naming an
// untrusted author there sends a person to plan an issue whose author may well be trusted.

const STOP_REASON =
	'the issue author does not have write access, and no trusted `kickoff` plan is on the issue'
const UNREAD_REASON =
	'the write-access lookup, the comment listing or the label read failed, so whether the issue may run on its body could not be read'
const UNREAD_REMEDY = 'Check `gh auth status` and the network, then run it again'

// What a stopped run prints, notifies and recommends.
interface TrustStop {
	reason: string
	report: string
	recommended: string
}

// The remedy, named with the issue: a trusted person's `kickoff` writes the plan the run will follow.
function recommended(issue_number: string): string {
	return `Have a person with write access run \`kickoff ${issue_cite.plain(issue_number)}\`, then run it again`
}

function untrusted_stop(issue_number: string): TrustStop {
	const remedy = recommended(issue_number)

	return {
		reason: STOP_REASON,
		report: `(issue author not trusted — ${remedy})`,
		recommended: remedy,
	}
}

const UNREAD_STOP: TrustStop = {
	reason: UNREAD_REASON,
	report: `(issue trust read failed — ${UNREAD_REMEDY})`,
	recommended: UNREAD_REMEDY,
}

// The `kickoff` plan is a comment here, never the body: `issue_body_or_comment` writes no plan into a
// body this gate would still judge by its untrusted author.
// Not cleared, and the read that would have cleared it answered nothing — a label read that failed
// leaves the plan unknown unless the comment listing already ruled it out.
function is_unread(trust: BlockTrust, state: StateRead): boolean {
	const { is_body_trusted, has_trusted_comment } = trust

	if (is_body_trusted === undefined) return true

	const can_be_planned = state.kind !== 'state' || issue_state.is_planned(state)

	return can_be_planned && has_trusted_comment !== false
}

// The plan is asked only of a body not already trusted — the state read is not needed otherwise.
function untrusted_body_stop(
	trust: BlockTrust,
	state: StateRead,
	issue_number: string,
): TrustStop | undefined {
	if (issue_state.is_planned(state) && trust.has_trusted_comment === true) return undefined

	return is_unread(trust, state) ? UNREAD_STOP : untrusted_stop(issue_number)
}

// The stop an issue's trust calls for, or `undefined` when the run may go ahead.
function stop_of(
	content: BlockRead,
	state: StateRead,
	issue_number: string,
): TrustStop | undefined {
	if (content.kind !== 'ok' || content.trust.is_body_trusted === true) return undefined

	return untrusted_body_stop(content.trust, state, issue_number)
}

const run_entry_trust = { STOP_REASON, UNREAD_REASON, stop_of }

export type { TrustStop }
export { run_entry_trust }
