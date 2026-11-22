import { review_finding_kind } from '#scripts/review/review-finding-kind'
import { review_finding_text } from '#scripts/review/review-finding-text'
import { review_record_cli } from '#scripts/review/review-record-cli'
import { run_ship_review_prompts } from './run-ship-review-prompts'

// The pure half of `josh ship --review`: the one-line prompts the supervised reviewers are launched
// with (`run-ship-review-prompts.ts`, re-exported here), the verdict read back off the findings file
// each writes, and where that verdict routes the ship. Kept apart from the launch and the joins
// (`run-ship-review-steps.ts`) the way `run-review.ts` is kept apart from `run-review-steps.ts`, so
// every branch is pinned without a session ever starting.
//
// **The reviewer is the one the chain already runs.** Its prompt hands it the brief `run:review`
// printed — the same level, rubric, checkout and `review:attest` nonce a `/code-review` subagent was
// given — and asks only that the findings also be written in the `review:record` grammar, so the
// supervisor records and routes them without an agent reading the prose.
//
// **Round 1 fixes what is local; round 2 only reads**. The round-1 reviewer
// applies a Medium whose fix is small and local — the "small, local asks" `chain-rule.md` names — and
// marks that finding `fixed`, so the supervisor carries the ship through the gate, the commit and a
// round-2 verification pass instead of handing a lane child back for a fix it could not make. A High is
// never fixed in place and always blocks, as does a Medium left unfixed. The round-2 reviewer is a fresh
// session that edits nothing, and anything but a clean or Low-only verdict from it blocks.

const LINE_SEPARATOR = /\r?\n/u
const HIGH = 'high'
const MEDIUM = 'medium'
const { FIXED_PREFIX } = run_ship_review_prompts
const KIND_FIELDS = 2

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
			report: ReadonlyArray<string>
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
	line: string
	description: string
}

// One finding that decided a stopped review, as the durable stop log keeps it: its kind, the
// `<file>[:<line>]` it cites and the first sentence of what it said (joshuafolkken/kit#4519).
interface StopFinding {
	kind: string
	location: string
	sentence: string
}

const MISSING_NOTE = 'the reviewer wrote no findings file — the review did not complete'
const CLEAN_NOTE = 'review clean or Low-only — recorded; shipping on.'
const FIXED_NOTE =
	'review fixes applied in place — recorded; the gate re-runs on the fixed tree and round 2 follows the commit.'
// Every stop that hands findings back for a fix: a fix of only the cited line left the same pattern
// beside it for the next round to stop on again (joshuafolkken/kit#4673).
const SWEEP_INSTRUCTION = [
	'Before fixing, sweep each finding for its other sites — the same file, the callers of the same',
	'function and a grep of the pattern — fix every site in one pass, and list each range searched on its',
	'own line in the Issue fix comment.',
].join(' ')
const BLOCKING_NOTE = `review found High/Medium it did not fix — recorded. ${SWEEP_INSTRUCTION} Then take the round-2 route (\`chain-rule.md\`).`
const UNVERIFIED_OUTCOME: RoundOutcome = {
	is_passing: false,
	note: `review fixes did not pass the scoped checks — recorded as unfixed. ${SWEEP_INSTRUCTION} Then take the round-2 route (\`chain-rule.md\`).`,
}
const ROUND_TWO_CLEAN_NOTE = 'round 2 clean or Low-only — recorded; shipping on.'
const ROUND_TWO_BLOCKING_NOTE = `round 2 found High/Medium or edited the tree — recorded; round 2 is final. ${SWEEP_INSTRUCTION} Then push and gate it, and run followup (\`chain-rule.md\` step 4).`

// The spec is what `review:record` reads; the description after it travels in the stage output and,
// for a finding that stopped the ship, its first sentence in the durable stop log.
function finding_of(line: string): Finding {
	const is_fixed = line.startsWith(FIXED_PREFIX)

	const unmarked = is_fixed ? line.slice(FIXED_PREFIX.length) : line
	// The kind stays in `line` for the record; an unknown one stays in the spec, so the line is refused.
	const spec_text = review_finding_kind.split_kind(unmarked)?.spec ?? unmarked

	return { ...review_finding_text.split_description(spec_text), is_fixed, line }
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

function kind_of(finding: Finding): string {
	return finding.spec.split(':', KIND_FIELDS).join(':')
}

function kinds_of(findings: ReadonlyArray<Finding>): ReadonlyArray<string> {
	return [...new Set(findings.map((finding) => kind_of(finding)))]
}

// Every kind a scored round found, fixed or not — empty for a round that found nothing.
function finding_kinds(verdict: ScoredVerdict): ReadonlyArray<string> {
	return kinds_of(verdict.specs.map((spec) => finding_of(spec)))
}

function stop_finding_of(finding: Finding): StopFinding {
	const location = review_record_cli.parse_finding(finding.spec)?.file ?? ''

	return {
		kind: kind_of(finding),
		location,
		sentence: review_finding_text.first_sentence(finding.description),
	}
}

// `bug-risks:medium` — each kind of finding that decided a stopped stage, once per kind (the stop
// counts once under each in `lane:stats`), so the lane ledger records which kinds of finding stop a
// lane rather than only that one did (joshuafolkken/kit#4426). The blocking findings decide it where
// there are any; otherwise the stop was decided by the fixes — round-1 fixes red on the scoped pair, or
// a round 2 that edited the tree — so the fixed findings do. A line outside the grammar is the stage's
// own prose and never counts.
function deciding_findings(text: string): ReadonlyArray<Finding> {
	const findings = spec_findings(text).filter((finding) => is_recordable(finding))
	const blocking = findings.filter((finding) => is_blocking(finding))

	return blocking.length > 0 ? blocking : findings.filter((finding) => finding.is_fixed)
}

function blocking_kinds(text: string): ReadonlyArray<string> {
	return kinds_of(deciding_findings(text))
}

// The same findings `blocking_kinds` counts, each one whole — every finding, not once per kind — so a
// stop can be classified by what was found where, not only by its kind (joshuafolkken/kit#4519).
function blocking_details(text: string): ReadonlyArray<StopFinding> {
	return deciding_findings(text).map((finding) => stop_finding_of(finding))
}

// The findings a passing round 1 fixed in place — the stop log's only chance to see them, since no stop
// follows (joshuafolkken/kit#4780); none for any other round.
function passing_fixes(verdict: ScoredVerdict, outcome: RoundOutcome): ReadonlyArray<StopFinding> {
	if (!outcome.is_passing || verdict.kind !== VERDICT.FIXED) return []

	return blocking_details(verdict.report.join('\n'))
}

function scored_kind(findings: ReadonlyArray<Finding>): ScoredVerdict['kind'] {
	if (findings.some((finding) => is_blocking(finding))) return VERDICT.BLOCKING

	return findings.some((finding) => finding.is_fixed) ? VERDICT.FIXED : VERDICT.CLEAN
}

// Absent means the reviewer never finished; a line outside the grammar means its verdict cannot be
// recorded — both stop the ship rather than read as clean. A fixed finding is recorded with its
// `fixed` mark, the disposition `review:record` keeps in the ledger and `review:round2` reads round 1's
// closure from (joshuafolkken/kit#5286). The report keeps each line whole — mark and description — for
// the stage output a resumed lane child reads.
function read_verdict(text: string | undefined): ReviewVerdict {
	if (text === undefined) return { kind: VERDICT.INVALID, note: MISSING_NOTE }

	const findings = spec_findings(text)
	const invalid = findings.find((finding) => !is_recordable(finding))

	if (invalid !== undefined) {
		return { kind: VERDICT.INVALID, note: `unreadable finding: ${invalid.spec}` }
	}

	return {
		kind: scored_kind(findings),
		specs: findings.map((finding) =>
			finding.is_fixed ? `${FIXED_PREFIX}${finding.spec}` : finding.spec,
		),
		report: findings.map((finding) => finding.line),
	}
}

// The whole findings `review:record` is given: a stopped round's `fixed` marks are dropped, since a fix the scoped
// pair turned down, or one beside a finding still blocking, has not closed what it marks.
function recorded_specs(verdict: ScoredVerdict, outcome: RoundOutcome): ReadonlyArray<string> {
	if (outcome.is_passing) return verdict.report

	return verdict.report.map((spec) =>
		spec.startsWith(FIXED_PREFIX) ? spec.slice(FIXED_PREFIX.length) : spec,
	)
}

// Round 1 passes clean or with every blocking finding fixed in place; round 2 follows the commit.
function round_one_outcome(verdict: ScoredVerdict): RoundOutcome {
	if (verdict.kind === VERDICT.BLOCKING) return { is_passing: false, note: BLOCKING_NOTE }

	return { is_passing: true, note: verdict.kind === VERDICT.FIXED ? FIXED_NOTE : CLEAN_NOTE }
}

// Whether a findings file records a clean round 1. A resumed round 1 narrows to the delta only past a
// review that found nothing to fix. A blocking one has a finding in a file the delta may not touch. A
// fixed one approved its own edits, not the briefed tree the delta is measured from, so a file
// reverted to that tree would drop out of the delta with its finding back in it.
function is_clean_round_one(text: string | undefined): boolean {
	return read_verdict(text).kind === VERDICT.CLEAN
}

// Whether the reviewer edited the tree — any finding marked fixed, whether or not another one still
// blocks. A partial fix moves the tree the background gate read as surely as a full one, so the join
// reads it red either way.
function has_fixes(text: string | undefined): boolean {
	if (text === undefined) return false

	return spec_findings(text).some((finding) => finding.is_fixed)
}

// Round 2 is final and reads only, so it passes clean or Low-only alone — a fix it made would itself be
// unreviewed.
function round_two_outcome(verdict: ScoredVerdict): RoundOutcome {
	const is_passing = verdict.kind === VERDICT.CLEAN

	return { is_passing, note: is_passing ? ROUND_TWO_CLEAN_NOTE : ROUND_TWO_BLOCKING_NOTE }
}

const run_ship_review = {
	...run_ship_review_prompts,
	SWEEP_INSTRUCTION,
	UNVERIFIED_OUTCOME,
	VERDICT,
	blocking_details,
	blocking_kinds,
	finding_kinds,
	has_fixes,
	is_clean_round_one,
	passing_fixes,
	read_verdict,
	recorded_specs,
	round_one_outcome,
	round_two_outcome,
}

export type { ReviewVerdict, RoundOutcome, ScoredVerdict, StopFinding }
export { run_ship_review }

export { type PromptOf } from './run-ship-review-prompts'
