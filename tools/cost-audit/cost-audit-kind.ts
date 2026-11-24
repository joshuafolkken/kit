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

import { run_handoff_args } from '#scripts/run/handoff/run-handoff-args'
import { run_handoff_launch } from '#scripts/run/handoff/run-handoff-launch'

const RUN_KEYWORDS = ['fullrun', 'halfrun', 'prrun', 'backlogrun', 'kickoff'] as const

const CONVERSATION = 'conversation'
const HANDOFF = 'handoff'
const RESUME = 'resume'
const REVIEW = 'review'
const SUBAGENT = 'subagent'
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
	{ kind: HANDOFF, matches: (prompt) => prompt.includes(run_handoff_launch.ORIGIN_MARKER) },
	{ kind: REVIEW, matches: (prompt) => prompt.includes(REVIEW_MARKER) },
	{ kind: SUBAGENT, matches: (_prompt, is_delegated) => is_delegated },
	{ kind: RESUME, matches: (prompt) => prompt.trimStart().startsWith(RESUME_PREFIX) },
]

function run_keyword(prompt: string): string | undefined {
	const word = WORD_PATTERN.exec(prompt)?.[1] ?? ''

	return RUN_KEYWORDS.find((keyword) => keyword === word)
}

// joshuafolkken/kit#8891: a hand-off child is split by the keyword its prompt opens with
// (`handoff:kickoff`, `handoff:retrospective`, …), so the kickoff child's model switch reads on its own
// row; a prompt whose first word is no workflow keyword stays `handoff`.
function handoff_kind(prompt: string): string {
	const word = WORD_PATTERN.exec(prompt)?.[1]
	const keyword = run_handoff_args.WORKFLOW_KEYWORDS.find((one) => one === word)

	return keyword === undefined ? HANDOFF : `${HANDOFF}:${keyword}`
}

function kind_of(prompt: string, is_delegated: boolean): string {
	const rule = RULES.find((one) => one.matches(prompt, is_delegated))
	const kind = rule?.kind ?? run_keyword(prompt) ?? CONVERSATION

	return kind === HANDOFF ? handoff_kind(prompt) : kind
}

const cost_audit_kind = { CONVERSATION, RESUME, REVIEW, SUBAGENT, kind_of }

export { cost_audit_kind }
