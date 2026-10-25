import { issue_cite } from '#scripts/issue/issue-cite'
import { review_attest, type ReviewSlot } from '#scripts/review/review-attest'
import { review_finding_ledger } from '#scripts/review/review-finding-ledger'
import { review_finding_text } from '#scripts/review/review-finding-text'
import { review_prior_findings } from '#scripts/review/review-prior-findings'
import { review_record_cli } from '#scripts/review/review-record-cli'

// The pure half of `josh ship --review`: the one-line prompts the supervised reviewers are launched
// with, the verdict read back off the findings file each writes, and where that verdict routes the
// ship. Kept apart from the launch and the joins (`run-ship-review-steps.ts`) the way `run-review.ts`
// is kept apart from `run-review-steps.ts`, so every branch is pinned without a session ever starting.
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
const FIXED_PREFIX = 'fixed '
const KIND_FIELDS = 2
// `findings_path` is set only for a lane whose josh predates `review:submit`
// (`lane-session-action.ts`).
type PromptOf = (
	brief_path: string,
	slot: ReviewSlot,
	issue: string,
	findings_path?: string,
) => string

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
// The findings line is all a stopped ship hands the lane, so the other sites the rubric asks the
// reviewer to cite ride on it rather than in its prose report (joshuafolkken/kit#4673).
const OTHER_SITES_CLAUSE = '"other sites: <file>:<line>, …" for each other site of the same pattern'
const ROUND_TWO_CLEAN_NOTE = 'round 2 clean or Low-only — recorded; shipping on.'
const SUBMIT_COMMAND = 'pnpm josh review:submit'
const ROUND_TWO_BLOCKING_NOTE = `round 2 found High/Medium or edited the tree — recorded; round 2 is final. ${SWEEP_INSTRUCTION} Then push and gate it, and run followup (\`chain-rule.md\` step 4).`

// **The reviewer hands its findings to a command, never to a path it copies** (joshuafolkken/kit#4799):
// a reviewer that copied the findings path matched the `josh-review-*` files beside it and dropped
// `ship-`, so the supervisor never read a review it had finished. `review:submit` knows the slot's path.
function submit_command(slot: ReviewSlot): string {
	return slot === review_attest.REVIEW_SLOT.CODE
		? SUBMIT_COMMAND
		: `${SUBMIT_COMMAND} --interaction`
}

// **A lane whose josh predates `review:submit` is handed the path**: the supervisor reloads onto main
// at its pass boundary (`run-wake-code.ts`), so it meets lanes branched before the command existed.
function sink_clauses(
	slot: ReviewSlot,
	findings_path: string | undefined,
): readonly [string, string] {
	if (findings_path !== undefined) {
		return [
			`Then write every finding to ${findings_path},`,
			'and an empty file when there is none.',
		]
	}

	return [
		`Then pipe every finding on stdin to \`${submit_command(slot)}\` — never write a findings file yourself —`,
		'or run it with `--none` and no stdin when there is none; if it refuses a line, fix that line and run it again.',
	]
}

function findings_instruction(
	slot: ReviewSlot,
	fixed_clause: string,
	findings_path: string | undefined,
): string {
	const categories = review_finding_ledger.CATEGORIES.join(', ')
	const [opening, closing] = sink_clauses(slot, findings_path)

	return [
		opening,
		'one per line as',
		`<category>:<severity>:<file>[:<line>]${review_finding_text.DESCRIPTION_SEPARATOR}<one sentence: what is wrong and why>`,
		`(category one of ${categories}; severity high, medium or low)${fixed_clause},`,
		`a high or medium line ending with ${OTHER_SITES_CLAUSE},`,
		closing,
	].join(' ')
}

// The rubric's requirement check sends the reviewer to the Issue, and a body-only read there is refused
// by the issue-comments rule — so the prompt names the read that carries the comments with the body
// (joshuafolkken/kit#3875).
function issue_read_instruction(issue: string): string {
	return [
		`Read Issue ${issue_cite.plain(issue)} with \`pnpm josh issue:read ${issue}\`, which prints the body and every`,
		`comment together — never a body-only \`gh api …/issues/${issue}\` read.`,
	].join(' ')
}

// **The review runs in this session itself** (joshuafolkken/kit#4715): a reviewer that invoked the
// `/code-review` skill forked a second agent that read the same diff and brief again. The session is
// launched without the `Skill` and `Agent` tools (`claude-agent-argv.ts`), and the prompt says so.
const IN_SESSION_CLAUSE =
	'Review it yourself in this session — you carry no Skill or Agent tool, so never launch a second reviewer.'

function round_one_opening(brief_path: string): string {
	return [
		`Review this checkout as a /code-review: read the review brief at ${brief_path} and follow it exactly —`,
		'the level on its first line, the rubric it names, the checkout it pins and its review:attest step.',
		IN_SESSION_CLAUSE,
	].join(' ')
}

// One line, because `detached_launch` refuses an argument carrying a control character: the multi-line
// brief travels by path, never inline.
function reviewer_prompt(
	brief_path: string,
	slot: ReviewSlot,
	issue: string,
	findings_path?: string,
): string {
	return [
		round_one_opening(brief_path),
		issue_read_instruction(issue),
		...review_prior_findings.prompt_clauses(issue),
		'Apply a fix only for a Medium finding whose fix is small and local — a one-function refactor, an',
		'added test, an added guard; never fix a High or a change that reaches beyond one place, and never',
		'commit, stage or push. After any fix, run `pnpm josh lint:related && pnpm josh test:related` and',
		'return only once both are green; revert a fix you cannot get green and report that finding unfixed.',
		findings_instruction(
			slot,
			`, prefixing a finding you fixed with "${FIXED_PREFIX}"`,
			findings_path,
		),
	].join(' ')
}

// The round-1 review run beside the code review: it reads only, so the two sessions never fix, verify
// and revert in the one shared checkout at once; its findings go to the lane's one fix pass.
function report_prompt(
	brief_path: string,
	slot: ReviewSlot,
	issue: string,
	findings_path?: string,
): string {
	return [
		round_one_opening(brief_path),
		'Do not edit any file: the code review running beside this one fixes in this checkout.',
		issue_read_instruction(issue),
		...review_prior_findings.prompt_clauses(issue),
		findings_instruction(slot, '', findings_path),
	].join(' ')
}

// **One reviewer edits the checkout** (joshuafolkken/kit#4672): a slot reviewed beside the code slot
// reads only, and a slot reviewed alone takes the round's own prompt.
function slot_prompt(
	round_prompt: PromptOf,
	slot: ReviewSlot,
	slots: ReadonlyArray<ReviewSlot>,
): PromptOf {
	if (slot === review_attest.REVIEW_SLOT.CODE || slots.length === 1) return round_prompt

	return report_prompt
}

// The round-2 verification pass: a fresh session over the round-1 fix delta, reading only.
function verification_prompt(
	brief_path: string,
	slot: ReviewSlot,
	issue: string,
	findings_path?: string,
): string {
	return [
		`Review this checkout as a /code-review — the round-2 verification pass over the round-1 fixes: read the`,
		`review brief at ${brief_path} and follow it exactly — the level on its first line, the rubric it`,
		'names, the checkout it pins and its review:attest step. Do not edit any file.',
		IN_SESSION_CLAUSE,
		issue_read_instruction(issue),
		...review_prior_findings.prompt_clauses(issue),
		findings_instruction(slot, '', findings_path),
	].join(' ')
}

// The spec is what `review:record` reads; the description after it travels in the stage output and,
// for a finding that stopped the ship, its first sentence in the durable stop log.
function finding_of(line: string): Finding {
	const is_fixed = line.startsWith(FIXED_PREFIX)

	const unmarked = is_fixed ? line.slice(FIXED_PREFIX.length) : line

	return { ...review_finding_text.split_description(unmarked), is_fixed, line }
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
// recorded — both stop the ship rather than read as clean. The specs are recorded without the `fixed`
// mark: a fixed finding was still a finding of that round. The report keeps each line whole — mark and
// description — for the stage output a resumed lane child reads.
function read_verdict(text: string | undefined): ReviewVerdict {
	if (text === undefined) return { kind: VERDICT.INVALID, note: MISSING_NOTE }

	const findings = spec_findings(text)
	const invalid = findings.find((finding) => !is_recordable(finding))

	if (invalid !== undefined) {
		return { kind: VERDICT.INVALID, note: `unreadable finding: ${invalid.spec}` }
	}

	return {
		kind: scored_kind(findings),
		specs: findings.map((finding) => finding.spec),
		report: findings.map((finding) => finding.line),
	}
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
	FIXED_PREFIX,
	OTHER_SITES_CLAUSE,
	SWEEP_INSTRUCTION,
	UNVERIFIED_OUTCOME,
	VERDICT,
	blocking_details,
	blocking_kinds,
	has_fixes,
	is_clean_round_one,
	passing_fixes,
	read_verdict,
	report_prompt,
	reviewer_prompt,
	round_one_opening,
	round_one_outcome,
	round_two_outcome,
	slot_prompt,
	submit_command,
	verification_prompt,
}

export type { PromptOf, ReviewVerdict, RoundOutcome, ScoredVerdict, StopFinding }
export { run_ship_review }
