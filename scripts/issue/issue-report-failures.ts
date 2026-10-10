import { capped_output } from '#scripts/document/capped-print'
import { session_cite } from './session-cite'

// The failure report `issue:read` and `issue:state` share. Both read a batch
// of numbers, print a block for each one that answered, and name every one that did not; only the
// result kind that counts as an answer and what a gap must not be mistaken for differ between them.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

// The two failure kinds a read can end in, kept apart all the way to the report: `missing` is the
// number resolving to nothing and `unreadable` is a read that failed, and the documents ask a
// caller to report the two differently. Folding them together to simplify the batch would destroy
// exactly that distinction.
type ReadFailureKind = 'missing' | 'unreadable'

interface NumberReport<K extends string> {
	issue_number: string
	result: { kind: K | ReadFailureKind }
}

interface FailureTerms<K extends string> {
	success_kind: K
	// What a failed read would be misread as if it were printed silently — "the issue is empty".
	misreading: string
}

// Under the Bash output cap, or as part files past it — a batch of long threads is the shape that
// overflowed.
function print_blocks(blocks: ReadonlyArray<string>, separator: string, label: string): void {
	if (blocks.length === 0) return

	capped_output.capped_print(blocks.join(separator), label)
}

// A number that resolves to nothing is an answer — a typo, or another repository's number quoted in
// prose — and it is reported as one. Everything else is a gap, and the message says so, because the
// caller's next move differs: a gap is retried, an answer is not.
function report_failure(kind: ReadFailureKind, issue_number: string, misreading: string): void {
	if (kind === 'missing') {
		console.error(
			`✖ issue ${session_cite.issue(issue_number)} does not resolve — check the number and the repository`,
		)
	} else {
		console.error(
			`✖ could not read issue ${session_cite.issue(issue_number)} — a rate limit, expired auth, or a dropped connection. This is not "${misreading}"`,
		)
	}
}

function is_failure_kind(kind: string): kind is ReadFailureKind {
	return kind === 'missing' || kind === 'unreadable'
}

function report_one_failure<K extends string>(
	report: NumberReport<K>,
	terms: FailureTerms<K>,
): boolean {
	const { kind } = report.result

	if (!is_failure_kind(kind)) return false

	report_failure(kind, report.issue_number, terms.misreading)

	return true
}

// Every number that produced no answer is named, so a caller is told which ones it has no answer for
// rather than being left to subtract the printed blocks from what it asked. A single failure makes
// the exit code non-zero.
function report_failures<K extends string>(
	reports: ReadonlyArray<NumberReport<K>>,
	terms: FailureTerms<K>,
): number {
	let has_failure = false

	for (const report of reports) {
		has_failure = report_one_failure(report, terms) || has_failure
	}

	return has_failure ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

const issue_report_failures = { print_blocks, report_failures }

export type { ReadFailureKind }
export { issue_report_failures }
