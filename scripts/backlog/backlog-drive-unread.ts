import { issue_cite } from '#scripts/issue/issue-cite'
import type { StateRead } from '#scripts/issue/issue-state-cli'
import type { OfferRead } from './backlog-drive'
import { backlog_offer } from './backlog-offer'

// **A named issue whose state did not read is asked again before a session hears of it.** The read is
// one `gh` request, and a dropped connection fails it for a moment and no longer: handing that to a
// session costs a wake that can only cut and hand the loop back. So the failure is a `wait` that reads
// again on the next pass — the driver keeps collecting children meanwhile — and `backlog:offer`'s
// consecutive-retry limit bounds it, the count `backlog-drive-epic.ts` advances for a failed `epic:next`.
//
// **What is handed back is `offer`, with the issue and the reason on stderr.** That is the row a session
// already reads for an offer that produced nothing to start: report what stderr printed, pick no issue
// by hand. A number that resolves to nothing is an answer rather than a gap, so it is not asked again.

type UnreadState = Exclude<StateRead, { kind: 'state' }>

const NO_RETRIES = 0
// The loop's own word for an offer it could not use (`backlog-drive.ts` → `ask_offer`).
const HANDED_BACK = 'offer'
const UNKNOWN_REASON = 'unknown reason'

function cause_of(read: UnreadState): string {
	if (read.kind === 'missing') return 'the number does not resolve'
	const status = read.status === undefined ? [] : [`status ${String(read.status)}`]

	return [read.reason ?? UNKNOWN_REASON, ...status].join(', ')
}

function note_of(issue: string, read: UnreadState): string {
	return `The state of named issue ${issue_cite.plain(issue)} could not be read (${cause_of(read)})`
}

function handed_back(note: string): OfferRead {
	console.error(note)

	return { verdict: HANDED_BACK, issues: [], retries: NO_RETRIES }
}

// `retries` is the count of consecutive failed offers before this one. A named epic's failed
// `epic:next` advances it too, so the note counts offers, never state reads.
function offer(issue: string, read: UnreadState, retries: number): OfferRead {
	const note = note_of(issue, read)
	if (read.kind === 'missing') return handed_back(`${note}; check the number and the repository.`)
	const failures = retries + 1

	if (failures >= backlog_offer.RETRY_LIMIT) {
		return handed_back(`${note}; the offer failed ${String(failures)} times in a row.`)
	}

	console.error(`${note}; reading it again.`)

	return { verdict: 'wait', issues: [], retries: failures }
}

export const backlog_drive_unread = { HANDED_BACK, offer }
