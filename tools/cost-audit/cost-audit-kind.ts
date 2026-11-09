// What kind of session a transcript was, for `josh cost:audit`'s per-session-kind table.
//
// **No transcript line records why a session was started**, so the kind is read off the prompt that
// opened it — the one thing every launcher writes: a driver hand-off names `Driver handoff`, the
// review brief names `/code-review`, a lane resume opens `Resuming the lane child`, and a typed run
// opens with its workflow keyword. A delegated unit that is none of the first is a `subagent`;
// anything else is a `conversation`. The rules are tried in order: the wake rule first, since a
// hand-off's carried sections can name `/code-review`, and a review run as a subagent is counted as
// a review.
//
// A `josh run:handoff` child opens with its keyword too, so it is read off the origin its preamble names
// before the keyword: counted as the keyword, a session handed over from a consultation reads as a
// typed run's regression (joshuafolkken/kit#6898). Its free-text brief can name `/code-review`, so the
// origin is read before the review rule.

import { run_handoff_launch } from '#scripts/run/handoff/run-handoff-launch'

const RUN_KEYWORDS = ['fullrun', 'halfrun', 'prrun', 'backlogrun', 'kickoff'] as const

const CONVERSATION = 'conversation'
const REVIEW = 'review'
const REVIEW_MARKER = '/code-review'
const RESUME_PREFIX = 'Resuming'
const WAKE_MARKER = 'Driver handoff'
const WORD_PATTERN = /^\s*([a-z]+)/u

interface KindRule {
	kind: string
	matches: (prompt: string, is_delegated: boolean) => boolean
}

const RULES: ReadonlyArray<KindRule> = [
	{ kind: 'wake', matches: (prompt) => prompt.includes(WAKE_MARKER) },
	{ kind: 'handoff', matches: (prompt) => prompt.includes(run_handoff_launch.ORIGIN_MARKER) },
	{ kind: REVIEW, matches: (prompt) => prompt.includes(REVIEW_MARKER) },
	{ kind: 'subagent', matches: (_prompt, is_delegated) => is_delegated },
	{ kind: 'resume', matches: (prompt) => prompt.trimStart().startsWith(RESUME_PREFIX) },
]

function run_keyword(prompt: string): string | undefined {
	const word = WORD_PATTERN.exec(prompt)?.[1] ?? ''

	return RUN_KEYWORDS.find((keyword) => keyword === word)
}

function kind_of(prompt: string, is_delegated: boolean): string {
	const rule = RULES.find((one) => one.matches(prompt, is_delegated))

	return rule?.kind ?? run_keyword(prompt) ?? CONVERSATION
}

const cost_audit_kind = { CONVERSATION, REVIEW, kind_of }

export { cost_audit_kind }
