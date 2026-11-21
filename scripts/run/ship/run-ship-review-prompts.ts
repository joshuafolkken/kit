import { issue_cite } from '#scripts/issue/issue-cite'
import { review_attest, type ReviewSlot } from '#scripts/review/review-attest'
import { review_finding_kind } from '#scripts/review/review-finding-kind'
import { review_finding_ledger } from '#scripts/review/review-finding-ledger'
import { review_finding_text } from '#scripts/review/review-finding-text'
import { review_prior_findings } from '#scripts/review/review-prior-findings'
import {
	review_prompt_level,
	type RetryTrigger,
	type ReviewTrigger,
} from '#scripts/review/review-prompt-level'

// The one-line prompts `josh ship --review` launches its supervised reviewers with, kept apart from
// the verdict they write back (`run-ship-review.ts`), which re-exports them on `run_ship_review`.

const FIXED_PREFIX = 'fixed '
// `findings_path` is set only for a lane whose josh predates `review:submit`
// (`lane-session-action.ts`).
type PromptOf = (
	brief_path: string,
	slot: ReviewSlot,
	issue: string,
	findings_path?: string,
) => string

// The findings line is all a stopped ship hands the lane, so the other sites the rubric asks the
// reviewer to cite ride on it rather than in its prose report (joshuafolkken/kit#4673).
const OTHER_SITES_CLAUSE = '"other sites: <file>:<line>, …" for each other site of the same pattern'
const SUBMIT_COMMAND = 'pnpm josh review:submit'

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
		`[kind=<kind> ]<category>:<severity>:<file>[:<line>]${review_finding_text.DESCRIPTION_SEPARATOR}<one sentence: what is wrong and why>`,
		`(category one of ${categories}; severity high, medium or low; kind one of ${review_finding_kind.KINDS.join(', ')})${fixed_clause},`,
		`a high or medium line ending with ${OTHER_SITES_CLAUSE},`,
		closing,
	].join(' ')
}

// The rubric's requirement check sends the reviewer to the Issue, and a body-only read there is refused
// by the issue-comments rule — so the prompt names the read that carries the comments with the body
// (joshuafolkken/kit#3875).
function issue_read_instruction(issue: string): string {
	return [
		`Read Issue ${issue_cite.plain_for('program', issue)} with \`pnpm josh issue:read ${issue}\`, which prints the body and every`,
		`comment together — never a body-only \`gh api …/issues/${issue}\` read.`,
	].join(' ')
}

// **The review runs in this session itself** (joshuafolkken/kit#4715): a reviewer that invoked the
// `/code-review` skill forked a second agent that read the same diff and brief again. The session is
// launched without the `Skill` and `Agent` tools (`claude-agent-argv.ts`), and the prompt says so.
const IN_SESSION_CLAUSE =
	'Review it yourself in this session — you carry no Skill or Agent tool, so never launch a second reviewer.'

// Each opening leads with the brief's level and the launch's trigger, so a transcript tells both
// (joshuafolkken/kit#5555, joshuafolkken/kit#8337).
function round_one_opening(brief_path: string, trigger: ReviewTrigger): string {
	return [
		`${review_prompt_level.opening(brief_path, trigger)}Review this checkout as a /code-review: read the review brief at ${brief_path} and follow it exactly —`,
		'the level on its first line, the rubric it names, the checkout it pins and its review:attest step.',
		IN_SESSION_CLAUSE,
	].join(' ')
}

// A round-1 prompt's text after its opening, which carries the launch's trigger.
type PromptText = (
	opening: string,
	slot: ReviewSlot,
	issue: string,
	findings_path?: string,
) => string

function slot_opening(brief_path: string, slot: ReviewSlot): string {
	return round_one_opening(brief_path, review_prompt_level.round_one_trigger(slot))
}

// One line, because `detached_launch` refuses an argument carrying a control character: the multi-line
// brief travels by path, never inline.
function reviewer_text(
	opening: string,
	slot: ReviewSlot,
	issue: string,
	findings_path?: string,
): string {
	return [
		opening,
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

function reviewer_prompt(
	brief_path: string,
	slot: ReviewSlot,
	issue: string,
	findings_path?: string,
): string {
	return reviewer_text(slot_opening(brief_path, slot), slot, issue, findings_path)
}

// The round-1 review run beside the code review: it reads only, so the two sessions never fix, verify
// and revert in the one shared checkout at once; its findings go to the lane's one fix pass.
function report_text(
	opening: string,
	slot: ReviewSlot,
	issue: string,
	findings_path?: string,
): string {
	return [
		opening,
		'Do not edit any file: the code review running beside this one fixes in this checkout.',
		issue_read_instruction(issue),
		...review_prior_findings.prompt_clauses(issue),
		findings_instruction(slot, '', findings_path),
	].join(' ')
}

function report_prompt(
	brief_path: string,
	slot: ReviewSlot,
	issue: string,
	findings_path?: string,
): string {
	return report_text(slot_opening(brief_path, slot), slot, issue, findings_path)
}

// The read-only prompt `retried` pairs with its round prompt, so the slot beside keeps the retry's trigger.
const BESIDE_PROMPTS = new WeakMap<PromptOf, PromptOf>()

function opened(text_of: PromptText, retry: RetryTrigger): PromptOf {
	return function retried_prompt(brief_path, slot, issue, findings_path): string {
		return text_of(round_one_opening(brief_path, retry), slot, issue, findings_path)
	}
}

// **A rerun's launches name their cause** (joshuafolkken/kit#8379): the code slot's prompt and the
// read-only one beside it open with `retry` in place of the slot's word.
function retried(retry: RetryTrigger): PromptOf {
	const prompt = opened(reviewer_text, retry)

	BESIDE_PROMPTS.set(prompt, opened(report_text, retry))

	return prompt
}

// Round 1's prompt: a rerun's when it has a cause, the slot's own otherwise.
function round_one_prompt(retry: RetryTrigger | undefined): PromptOf {
	return retry === undefined ? reviewer_prompt : retried(retry)
}

// **One reviewer edits the checkout** (joshuafolkken/kit#4672): a slot reviewed beside the code slot
// reads only, and a slot reviewed alone takes the round's own prompt.
function slot_prompt(
	round_prompt: PromptOf,
	slot: ReviewSlot,
	slots: ReadonlyArray<ReviewSlot>,
): PromptOf {
	if (slot === review_attest.REVIEW_SLOT.CODE || slots.length === 1) return round_prompt

	return BESIDE_PROMPTS.get(round_prompt) ?? report_prompt
}

// The round-2 verification pass: a fresh session over the round-1 fix delta, reading only.
function final_opening(brief_path: string): string {
	return `${round_one_opening(brief_path, 'round-2')} This is the final round-2 verification pass; read the scope the brief names. Do not edit any file.`
}

function verification_prompt(
	brief_path: string,
	slot: ReviewSlot,
	issue: string,
	findings_path?: string,
): string {
	return [
		final_opening(brief_path),
		issue_read_instruction(issue),
		...review_prior_findings.prompt_clauses(issue),
		findings_instruction(slot, '', findings_path),
	].join(' ')
}

const run_ship_review_prompts = {
	FIXED_PREFIX,
	OTHER_SITES_CLAUSE,
	final_opening,
	report_prompt,
	retried,
	reviewer_prompt,
	round_one_opening,
	round_one_prompt,
	slot_prompt,
	submit_command,
	verification_prompt,
}

export type { PromptOf }
export { run_ship_review_prompts }
