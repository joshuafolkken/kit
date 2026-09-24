import { review_finding_ledger } from '#scripts/review/review-finding-ledger'
import { review_record_cli } from '#scripts/review/review-record-cli'

// The pure half of `josh ship --review` (joshuafolkken/kit#2427): the one-line prompts the supervised
// reviewers are launched with, the verdict read back off the findings file each writes, and where that
// verdict routes the ship. Kept apart from the launch and the joins (`run-ship-review-steps.ts`) the way
// `run-review.ts` is kept apart from `run-review-steps.ts`, so every branch is pinned without a session
// ever starting.
//
// **The reviewer is the one the chain already runs.** Its prompt hands it the brief `run:review`
// printed — the same level, rubric, checkout and `review:attest` nonce a `/code-review` subagent was
// given — and asks only that the findings also be written in the `review:record` grammar, so the
// supervisor records and routes them without an agent reading the prose.
//
// **Round 1 fixes what is local; round 2 only reads** (joshuafolkken/kit#2489). The round-1 reviewer
// applies a Medium whose fix is small and local — the "small, local asks" `chain-rule.md` names — and
// marks that finding `fixed`, so the supervisor carries the ship through the gate, the commit and a
// round-2 verification pass instead of handing a lane child back for a fix it could not make. A High is
// never fixed in place and always blocks, as does a Medium left unfixed. The round-2 reviewer is a fresh
// session that edits nothing, and anything but a clean or Low-only verdict from it blocks.

const LINE_SEPARATOR = /\r?\n/u
const HIGH = 'high'
const MEDIUM = 'medium'
const FIXED_PREFIX = 'fixed '

const VERDICT = {
	CLEAN: 'clean',
	FIXED: 'fixed',
	BLOCKING: 'blocking',
	INVALID: 'invalid',
} as const

type ReviewVerdict =
	| {
			kind: typeof VERDICT.CLEAN | typeof VERDICT.FIXED | typeof VERDICT.BLOCKING
			specs: ReadonlyArray<string>
	  }
	| { kind: typeof VERDICT.INVALID; note: string }

type ScoredVerdict = Exclude<ReviewVerdict, { kind: typeof VERDICT.INVALID }>

// Whether a recorded round lets the ship go on, and the line the report closes that round with.
interface RoundOutcome {
	is_passing: boolean
	note: string
}

interface Finding {
	spec: string
	is_fixed: boolean
}

const MISSING_NOTE = 'the reviewer wrote no findings file — the review did not complete'
const CLEAN_NOTE = 'review clean or Low-only — recorded; shipping on.'
const FIXED_NOTE =
	'review fixes applied in place — recorded; the gate re-runs on the fixed tree and round 2 follows the commit.'
const BLOCKING_NOTE =
	'review found High/Medium it did not fix — recorded; fix them, then take the round-2 route (`chain-rule.md`).'
const ROUND_TWO_CLEAN_NOTE = 'round 2 clean or Low-only — recorded; shipping on.'
const ROUND_TWO_BLOCKING_NOTE =
	'round 2 found High/Medium or edited the tree — recorded; round 2 is final: fix, push and gate it, then run followup (`chain-rule.md` step 4).'

function findings_instruction(findings_path: string, fixed_clause: string): string {
	const categories = review_finding_ledger.CATEGORIES.join(', ')

	return [
		`Then write every finding to ${findings_path}, one per line as <category>:<severity>:<file>[:<line>]`,
		`(category one of ${categories}; severity high, medium or low)${fixed_clause},`,
		'and an empty file when there is none.',
	].join(' ')
}

// One line, because `detached_launch` refuses an argument carrying a control character: the multi-line
// brief travels by path, never inline.
function reviewer_prompt(brief_path: string, findings_path: string): string {
	return [
		`Run a /code-review of this checkout: read the review brief at ${brief_path} and follow it exactly —`,
		'the level on its first line, the rubric it names, the checkout it pins and its review:attest step.',
		'Apply a fix only for a Medium finding whose fix is small and local — a one-function refactor, an',
		'added test, an added guard; never fix a High or a change that reaches beyond one place, and never',
		'commit, stage or push.',
		findings_instruction(findings_path, `, prefixing a finding you fixed with "${FIXED_PREFIX}"`),
	].join(' ')
}

// The round-2 verification pass: a fresh session over the round-1 fix delta, reading only.
function verification_prompt(brief_path: string, findings_path: string): string {
	return [
		`Run a /code-review of this checkout — the round-2 verification pass over the round-1 fixes: read the`,
		`review brief at ${brief_path} and follow it exactly — the level on its first line, the rubric it`,
		'names, the checkout it pins and its review:attest step. Do not edit any file.',
		findings_instruction(findings_path, ''),
	].join(' ')
}

function finding_of(line: string): Finding {
	if (!line.startsWith(FIXED_PREFIX)) return { spec: line, is_fixed: false }

	return { spec: line.slice(FIXED_PREFIX.length).trim(), is_fixed: true }
}

function spec_findings(text: string): ReadonlyArray<Finding> {
	return text
		.split(LINE_SEPARATOR)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => finding_of(line))
}

function is_recordable(finding: Finding): boolean {
	return review_record_cli.parse_finding(finding.spec) !== undefined
}

// A High blocks whether or not it is marked fixed — it is never fixed in place — and a Medium blocks
// unless the reviewer fixed it.
function is_blocking(finding: Finding): boolean {
	const severity = review_record_cli.parse_finding(finding.spec)?.severity

	return severity === HIGH || (severity === MEDIUM && !finding.is_fixed)
}

function scored_kind(findings: ReadonlyArray<Finding>): ScoredVerdict['kind'] {
	if (findings.some((finding) => is_blocking(finding))) return VERDICT.BLOCKING

	return findings.some((finding) => finding.is_fixed) ? VERDICT.FIXED : VERDICT.CLEAN
}

// Absent means the reviewer never finished; a line outside the grammar means its verdict cannot be
// recorded — both stop the ship rather than read as clean. The specs are recorded without the `fixed`
// mark: a fixed finding was still a finding of that round.
function read_verdict(text: string | undefined): ReviewVerdict {
	if (text === undefined) return { kind: VERDICT.INVALID, note: MISSING_NOTE }

	const findings = spec_findings(text)
	const invalid = findings.find((finding) => !is_recordable(finding))

	if (invalid !== undefined) {
		return { kind: VERDICT.INVALID, note: `unreadable finding: ${invalid.spec}` }
	}

	return { kind: scored_kind(findings), specs: findings.map((finding) => finding.spec) }
}

// Round 1 passes clean or with every blocking finding fixed in place; round 2 follows the commit.
function round_one_outcome(verdict: ScoredVerdict): RoundOutcome {
	if (verdict.kind === VERDICT.BLOCKING) return { is_passing: false, note: BLOCKING_NOTE }

	return { is_passing: true, note: verdict.kind === VERDICT.FIXED ? FIXED_NOTE : CLEAN_NOTE }
}

// Round 2 is final and reads only, so it passes clean or Low-only alone — a fix it made would itself be
// unreviewed.
function round_two_outcome(verdict: ScoredVerdict): RoundOutcome {
	const is_passing = verdict.kind === VERDICT.CLEAN

	return { is_passing, note: is_passing ? ROUND_TWO_CLEAN_NOTE : ROUND_TWO_BLOCKING_NOTE }
}

const run_ship_review = {
	FIXED_PREFIX,
	VERDICT,
	read_verdict,
	reviewer_prompt,
	round_one_outcome,
	round_two_outcome,
	verification_prompt,
}

export type { ReviewVerdict, RoundOutcome, ScoredVerdict }
export { run_ship_review }
