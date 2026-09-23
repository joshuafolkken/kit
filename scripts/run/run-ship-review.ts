import { review_finding_ledger } from '#scripts/review/review-finding-ledger'
import { review_record_cli } from '#scripts/review/review-record-cli'

// The pure half of `josh ship --review` (joshuafolkken/kit#2427): the one-line prompt the supervised
// reviewer is launched with, and the verdict read back off the findings file it writes. Kept apart from
// the launch and the joins (`run-ship-review-steps.ts`) the way `run-review.ts` is kept apart from
// `run-review-steps.ts`, so every branch is pinned without a session ever starting.
//
// **The reviewer is the one the chain already runs.** Its prompt hands it the brief `run:review`
// printed — the same level, rubric, checkout and `review:attest` nonce a `/code-review` subagent was
// given — and asks only that the findings also be written in the `review:record` grammar, so the
// supervisor records and routes them without an agent reading the prose.

const LINE_SEPARATOR = /\r?\n/u
const BLOCKING_SEVERITIES: ReadonlySet<string> = new Set(['high', 'medium'])

const VERDICT = {
	CLEAN: 'clean',
	BLOCKING: 'blocking',
	INVALID: 'invalid',
} as const

type ReviewVerdict =
	| { kind: typeof VERDICT.CLEAN | typeof VERDICT.BLOCKING; specs: ReadonlyArray<string> }
	| { kind: typeof VERDICT.INVALID; note: string }

const MISSING_NOTE = 'the reviewer wrote no findings file — the review did not complete'

// One line, because `detached_launch` refuses an argument carrying a control character: the multi-line
// brief travels by path, never inline.
function reviewer_prompt(brief_path: string, findings_path: string): string {
	const categories = review_finding_ledger.CATEGORIES.join(', ')

	return [
		`Run a /code-review of this checkout: read the review brief at ${brief_path} and follow it exactly —`,
		'the level on its first line, the rubric it names, the checkout it pins and its review:attest step.',
		'Do not edit any file.',
		`Then write every finding to ${findings_path}, one per line as <category>:<severity>:<file>[:<line>]`,
		`(category one of ${categories}; severity high, medium or low), and an empty file when there is none.`,
	].join(' ')
}

function spec_lines(text: string): ReadonlyArray<string> {
	return text
		.split(LINE_SEPARATOR)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
}

function is_blocking(spec: string): boolean {
	const finding = review_record_cli.parse_finding(spec)

	return finding !== undefined && BLOCKING_SEVERITIES.has(finding.severity)
}

// Absent means the reviewer never finished; a line outside the grammar means its verdict cannot be
// recorded — both stop the ship rather than read as clean. A High or Medium anywhere blocks.
function read_verdict(text: string | undefined): ReviewVerdict {
	if (text === undefined) return { kind: VERDICT.INVALID, note: MISSING_NOTE }

	const specs = spec_lines(text)
	const invalid = specs.find((spec) => review_record_cli.parse_finding(spec) === undefined)

	if (invalid !== undefined) {
		return { kind: VERDICT.INVALID, note: `unreadable finding: ${invalid}` }
	}

	return { kind: specs.some((spec) => is_blocking(spec)) ? VERDICT.BLOCKING : VERDICT.CLEAN, specs }
}

const run_ship_review = { VERDICT, read_verdict, reviewer_prompt }

export type { ReviewVerdict }
export { run_ship_review }
