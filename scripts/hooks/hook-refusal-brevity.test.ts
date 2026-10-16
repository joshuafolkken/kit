import { duplicate_reads } from '#scripts/delegation/duplicate-read-guard'
import { NOTICE as INVESTIGATION_NOTICE } from '#scripts/delegation/investigation-guard'
import { lane_guard_policy } from '#scripts/lane/lane-guard-policy'
import { delivered_rules } from '#scripts/rules/delivered-rules'
import { issue_comments } from '#scripts/rules/issue-comments'
import { lane_background } from '#scripts/rules/lane-background'
import { piped_verification } from '#scripts/rules/piped-verification'
import { stop_rules } from '#scripts/rules/stop-rules'
import { run_parent_cut_hook } from '#scripts/run/run-parent-cut-hook'
import { describe, expect, it } from 'vitest'

// Every `PreToolUse` and `Stop` refusal or notice is read by the model, and stays in its context once
// delivered. `hook-notice-brevity.test.ts` bounds the batching texts; this suite extends the same
// bound to every other one: what is wrong and the next command, in a sentence or two. The history
// behind a row lives on its Issue and in `docs/maintainers/rule-delivery-rationale.md`, never here.

const MAX_CHARS = 400
const HISTORY = /kit#\d|#\d{3,}|Before this/u
const BACKTICKED = /`[^`]+`/u

const TEXTS: ReadonlyArray<[string, string]> = [
	...delivered_rules.MEASURED_RULES.map((rule): [string, string] => [rule.id, rule.reason]),
	['stop: filing offer', stop_rules.FILING_OFFER_REASON],
	['stop: headless wait', stop_rules.HEADLESS_WAIT_REASON],
	['stop: hold release', stop_rules.HOLD_RELEASE_REASON],
	['stop: issue citation', stop_rules.ISSUE_CITATION_REASON],
	['stop: lane index', stop_rules.LANE_INDEX_REASON],
	['stop: notify', stop_rules.STOP_NOTIFY_REASON],
	['stop: session language', stop_rules.build_language_reason('ja')],
	['stop: lane background', lane_background.LANE_BACKGROUND_STOP_REASON],
	['notice: lane background foreground', lane_background.FOREGROUND_NOTE],
	['notice: pipefail rewrite', piped_verification.PIPEFAIL_NOTE],
	['notice: issue-comments rewrite', issue_comments.COMMENTS_NOTE],
	['notice: investigation', INVESTIGATION_NOTICE],
	['duplicate read refusal', duplicate_reads.REASON],
	['notice: duplicate read', duplicate_reads.NOTICE],
	['parent cut', run_parent_cut_hook.PARENT_CUT_REASON],
]

const MODE_REASONS: ReadonlyArray<[string, string]> = lane_guard_policy.LANE_GUARD_POLICY.map(
	(entry) => [entry.id, entry.because],
)

describe('every refusal and notice is the action and the next command', () => {
	it.each(TEXTS)('%s stays within the bound', (_name, text) => {
		expect(text.length).toBeLessThanOrEqual(MAX_CHARS)
	})

	it.each(TEXTS)('%s carries no history', (_name, text) => {
		expect(text).not.toMatch(HISTORY)
	})

	it.each(TEXTS)('%s names a command or a pointer', (_name, text) => {
		expect(text).toMatch(BACKTICKED)
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
