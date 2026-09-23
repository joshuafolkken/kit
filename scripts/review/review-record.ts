import { readFile } from 'node:fs/promises'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { review_finding_ledger } from './review-finding-ledger'

// The gate that refuses a merge until the `/code-review` round was recorded (joshuafolkken/kit#2343).
//
// **The instruction was prose, and prose failed.** `review:record` is the one write path for a
// round's findings (joshuafolkken/kit#2325), but nothing enforced the call — so across eleven merges
// after the instruction landed, it was never run once, and the recurrence ledger stayed blind. This
// module is the mechanical counterpart to `review-attest`'s `--check`, keyed on the issue rather than
// on a checkout: a round that left no `- rf:` line for its issue is treated as no review at all.
//
// **The three verdicts mirror the attestation gate's, and for the same reason.**
//
// - **`ok`** — the ledger holds at least one finding line for the issue, a zero-finding `none` line
//   included. The round was recorded; the merge proceeds.
// - **`missing`** — the ledger is present but carries no line for the issue. Absence is a refusal, not
//   a pass: the defect this gate exists for produced *no* line, so reading silence as success would
//   leave the hole open in the one shape it takes.
// - **`not-required`** — the ledger file itself is absent. A consumer repository that does not keep
//   the observation ledger never ran `review:record`, and blocking its merges would refuse the
//   population this gate is not about. So a missing file carries on, exactly as `review-attest`'s
//   `not-required` does for a checkout that briefed no review.

type RecordStatus = 'ok' | 'missing' | 'not-required'

interface RecordVerdict {
	status: RecordStatus
	issue?: number
}

// `undefined` for both "the file is absent" and "the file could not be read" — they are the same
// answer here, a ledger this checkout does not keep, and the caller turns that into `not-required`.
async function read_ledger(ledger_path: string): Promise<string | undefined> {
	try {
		return await readFile(ledger_path, 'utf8')
	} catch {
		return undefined
	}
}

// The default is the primary checkout's ledger, the one `review:record` writes from a lane
// (joshuafolkken/kit#2419) — a cwd-relative default read the lane's copy, so the followup gate refused
// every round recorded from a lane (joshuafolkken/kit#2431).
async function check(
	issue: number,
	ledger_path: string = observation_ledger_home.ledger_path(),
): Promise<RecordVerdict> {
	const content = await read_ledger(ledger_path)

	if (content === undefined) return { status: 'not-required' }
	if (review_finding_ledger.has_issue_record(content, issue)) return { status: 'ok', issue }

	return { status: 'missing', issue }
}

const MISSING_REASON =
	'No review round is recorded for this issue, so there is no evidence `/code-review` ran. A round whose findings are never recorded leaves the recurrence ledger blind, which is indistinguishable from a round nobody reviewed — so an unrecorded round is refused (joshuafolkken/kit#2343).'

const REMEDY =
	'Record the round with `pnpm josh review:record --issue <N> [<category>:<severity>:<file> ...]` — a clean round is a call with no findings, which records one zero-finding line — then reissue the merge.'

function refusal_message(issue: number): string {
	return [MISSING_REASON, `Issue: #${String(issue)}`, REMEDY].join('\n')
}

const review_record = {
	MISSING_REASON,
	check,
	refusal_message,
}

export type { RecordVerdict }
export { review_record }
