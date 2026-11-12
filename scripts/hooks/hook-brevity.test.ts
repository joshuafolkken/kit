import { duplicate_reads } from '#scripts/delegation/duplicate-read-guard'
import { large_reads } from '#scripts/delegation/large-read-guard'
import { session_language_cli } from '#scripts/josh/session-language-cli'
import { lane_guard_policy } from '#scripts/lane/lane-guard-policy'
import { delivered_rules } from '#scripts/rules/delivered-rules'
import { issue_comments } from '#scripts/rules/issue-comments'
import { lane_background } from '#scripts/rules/lane-background'
import { lane_direct_tool } from '#scripts/rules/lane-direct-tool'
import { piped_verification } from '#scripts/rules/piped-verification'
import { stop_rules } from '#scripts/rules/stop-rules'
import { run_parent_cut_hook } from '#scripts/run/run-parent-cut-hook'
import { run_poll_hook } from '#scripts/run/run-poll-hook'
import { time_batch_guard } from '#scripts/time-runtime/time-batch-guard'
import { describe, expect, it } from 'vitest'
import { MAX_REWRITE_CHARS, rewrite_notice } from './format-rewrite-notice'

// Every `PreToolUse` and `Stop` refusal or notice is read by the model, and stays in its context once
// delivered: what is wrong and the next command, in a sentence or two. This suite pins the bounds, so
// a rewrite that pastes the rule body back fails here; the directives the batching refusal must keep
// are pinned by `turn-batching-rule.test.ts`. The history behind a row lives on its Issue and in
// `docs/maintainers/rule-delivery-rationale.md`, never here.

const MAX_CHARS = 400
const HISTORY = /kit#\d|#\d{3,}|Before this/u
const BACKTICKED = /`[^`]+`/u
const BATCHING_RULE_POINTER = 'prompts/collaboration-workflow/turn-batching.md'
const REWRITE_BOUND = 600
const LARGE_REFORMAT_LINES = 400
const LINE_TEXT = 'const value = compute_something(input, options)'

const TEXTS: ReadonlyArray<[string, string]> = [
	...delivered_rules.MEASURED_RULES.map((rule): [string, string] => [rule.id, rule.reason]),
	['stop: filing offer', stop_rules.FILING_OFFER_REASON],
	['stop: headless wait', stop_rules.HEADLESS_WAIT_REASON],
	['stop: hold release', stop_rules.HOLD_RELEASE_REASON],
	['stop: lane index', stop_rules.LANE_INDEX_REASON],
	['stop: notify', stop_rules.STOP_NOTIFY_REASON],
	['stop: session language', stop_rules.build_language_reason('ja')],
	['stop: lane background', lane_background.LANE_BACKGROUND_STOP_REASON],
	['stop: lane agent', lane_background.LANE_AGENT_STOP_REASON],
	['notice: lane background foreground', lane_background.FOREGROUND_NOTE],
	['notice: pipefail rewrite', piped_verification.PIPEFAIL_NOTE],
	['notice: issue-comments rewrite', issue_comments.COMMENTS_NOTE],
	['notice: lane direct tool rewrite', lane_direct_tool.RESERVED_NOTE],
	['duplicate read refusal', duplicate_reads.REASON],
	['notice: duplicate read', duplicate_reads.NOTICE],
	['large read refusal', large_reads.REASON],
	['notice: large read', large_reads.NOTICE],
	['parent cut', run_parent_cut_hook.PARENT_CUT_REASON],
	['poll', run_poll_hook.POLL_REASON],
]

// The batching texts fire again and again in a run (joshuafolkken/kit#3398): the refusal takes the
// shared bound, and the two notices tighter ones set a little above the text as written, so a wording
// tweak fits but a re-paste does not. The lane notice recurs on every single-call turn, so it is held
// to a single short sentence.
const BATCHING_TEXTS: ReadonlyArray<[string, string, number]> = [
	['batching: the refusal', time_batch_guard.REASON, MAX_CHARS],
	['batching: the Write notice', time_batch_guard.NOTICE, 240],
	['batching: the lane notice', time_batch_guard.LANE_NOTICE, 160],
]

const BOUNDED_TEXTS: ReadonlyArray<[string, string, number]> = [
	...TEXTS.map(([name, text]): [string, string, number] => [name, text, MAX_CHARS]),
	...BATCHING_TEXTS,
]

const MODE_REASONS: ReadonlyArray<[string, string]> = lane_guard_policy.LANE_GUARD_POLICY.map(
	(entry) => [entry.id, entry.because],
)

describe('every refusal and notice is the action and the next command', () => {
	it.each(BOUNDED_TEXTS)('%s stays within its bound', (_name, text, limit) => {
		expect(text.length).toBeLessThanOrEqual(limit)
	})

	it.each(BOUNDED_TEXTS)('%s carries no history', (_name, text) => {
		expect(text).not.toMatch(HISTORY)
	})

	it.each(BOUNDED_TEXTS)('%s names a command or a pointer', (_name, text) => {
		expect(text).toMatch(BACKTICKED)
	})

	it.each(BATCHING_TEXTS)('%s still points at the rule body', (_name, text) => {
		expect(text).toContain(BATCHING_RULE_POINTER)
	})
})

describe('the rewrite notice is bounded as a whole', () => {
	it('caps the notice itself, header and range included, at about 600 characters', () => {
		expect(MAX_REWRITE_CHARS).toBeLessThanOrEqual(REWRITE_BOUND)
	})

	it('keeps a large reformat inside the bound with the line range first', () => {
		const after = Array.from({ length: LARGE_REFORMAT_LINES }, () => LINE_TEXT).join('\n')
		const notice = rewrite_notice.build('', after) ?? ''

		expect(notice.length).toBeLessThanOrEqual(REWRITE_BOUND)
		expect(notice.split('\n', 2)[1]).toBe(`Lines 1-${String(LARGE_REFORMAT_LINES)}:`)
	})
})

describe('the session-language line', () => {
	it('prints nothing when the language is the default', () => {
		expect(
			session_language_cli.format_line({
				lang: session_language_cli.DEFAULT_SESSION_LANG,
				is_default: true,
			}),
		).toBe('')
	})
})

// `prompts/collaboration-workflow/rule-delivery.md` (one delivery per run): a row that binds on every occurrence, or refuses until its
// prerequisite is on the tail, says so in its text — a short reason must not drop that sentence.
const RECURRING_REASONS = delivered_rules.DELIVERED_RULES.filter(
	(rule) => rule.decide !== undefined,
).map((rule): [string, string] => [rule.id, rule.reason])

const PREREQUISITE_REASONS = delivered_rules.DELIVERED_RULES.filter(
	(rule) => rule.decide === undefined && rule.already_satisfied !== undefined,
).map((rule): [string, string] => [rule.id, rule.reason])

describe('a row that repeats says how often it fires', () => {
	it.each(RECURRING_REASONS)('%s says it fires on every occurrence', (_id, reason) => {
		expect(reason).toMatch(/on every \w+/u)
	})

	it.each(PREREQUISITE_REASONS)('%s says it refuses until the prerequisite', (_id, reason) => {
		expect(reason).toMatch(/\buntil\b/u)
	})
})

describe('the lane-child guard modes give a reason, not a history', () => {
	it.each(MODE_REASONS)('%s stays within the bound and carries no history', (_id, because) => {
		expect(because.length).toBeLessThanOrEqual(MAX_CHARS)
		expect(because).not.toMatch(HISTORY)
	})
})
