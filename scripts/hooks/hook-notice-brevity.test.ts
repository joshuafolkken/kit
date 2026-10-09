import { session_language_cli } from '#scripts/josh/session-language-cli'
import { time_batch_guard } from '#scripts/time-runtime/time-batch-guard'
import { describe, expect, it } from 'vitest'
import { MAX_REWRITE_CHARS, rewrite_notice } from './format-rewrite-notice'

// The hook-injected notices stay in the model's context once delivered, and the batching ones fire
// again and again in a run. joshuafolkken/kit#3398 cut each to the action and a pointer at the rule
// body, as `prompt-hook-brevity.test.ts` did for the per-prompt hooks. This suite pins the bounds, so
// a rewrite that pastes the rule body back fails here; the directives the refusal must keep are
// pinned by `turn-batching-rule.test.ts`.

const RULE_POINTER = 'prompts/collaboration-workflow/turn-batching.md'

// Characters, set a little above each text as written so a wording tweak fits but a re-paste does not.
// The lane notice recurs on every single-call turn, so it is held to about 40 tokens.
const LIMITS: ReadonlyArray<[string, string, number]> = [
	['the refusal', time_batch_guard.REASON, 450],
	['the Write notice', time_batch_guard.NOTICE, 240],
	['the lane notice', time_batch_guard.LANE_NOTICE, 160],
]

const REWRITE_BOUND = 600
const LARGE_REFORMAT_LINES = 400
const LINE_TEXT = 'const value = compute_something(input, options)'

describe('the batching texts are a line and a pointer', () => {
	it.each(LIMITS)('%s stays within its bound', (_name, text, limit) => {
		expect(text.length).toBeLessThanOrEqual(limit)
	})

	it.each(LIMITS)('%s still points at the rule body', (_name, text) => {
		expect(text).toContain(RULE_POINTER)
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
