import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { review_finding_ledger, type DisposedLine } from './review-finding-ledger'

// Whether round 1's High/Medium findings all closed, read from the issue's own ledger file rather
// than asserted by the caller (joshuafolkken/kit#5286). Closed means every High/Medium `- rf:` line
// of the issue carries `fixed` or `false-positive`; a line with no disposition, a filed or deferred
// one, or no recorded round at all leaves round 1 open, so the answer stays `required`. Only the
// issue's latest code round is read (joshuafolkken/kit#5359): an earlier round's unfixed lines stay
// in the append-only ledger after a clean re-run.

const BLOCKING_SEVERITIES: ReadonlySet<string> = new Set(['high', 'medium'])
const NO_RECORD_REASON =
	'no round-1 round is recorded in the ledger for this issue, so its findings cannot be read as closed'

const OPEN_REASON_PREFIX =
	'round 1 left High/Medium findings neither fixed nor a false positive in the ledger'
const NO_DISPOSITION = 'no disposition'

interface Closure {
	is_closed: boolean
	reason: string
}

const CLOSED: Closure = { is_closed: true, reason: '' }

function is_open(line: DisposedLine): boolean {
	return (
		BLOCKING_SEVERITIES.has(line.severity) && !review_finding_ledger.is_closing(line.disposition)
	)
}

function open_reason(open: ReadonlyArray<DisposedLine>): string {
	const dispositions = open.map((line) => line.disposition ?? NO_DISPOSITION).join(', ')

	return `${OPEN_REASON_PREFIX} (${String(open.length)}: ${dispositions}), so the pass that verifies them is due`
}

function of_content(content: string | undefined, issue: number): Closure {
	const latest = review_finding_ledger.latest_round(content ?? '', issue)
	const lines = review_finding_ledger.issue_dispositions(latest, issue)

	if (lines.length === 0) return { is_closed: false, reason: NO_RECORD_REASON }

	const open = lines.filter((line) => is_open(line))

	return open.length === 0 ? CLOSED : { is_closed: false, reason: open_reason(open) }
}

// `undefined` issue — a branch that names none — has no ledger lines to read, so it is open.
async function read(
	issue: number | undefined,
	root: string = observation_ledger_home.ledger_root(),
): Promise<Closure> {
	if (issue === undefined) return { is_closed: false, reason: NO_RECORD_REASON }

	return of_content(await observation_ledger_home.read(root), issue)
}

const review_round_one_closure = { NO_RECORD_REASON, OPEN_REASON_PREFIX, of_content, read }

export type { Closure }
export { review_round_one_closure }
