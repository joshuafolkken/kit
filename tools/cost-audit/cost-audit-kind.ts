// What kind of session a transcript was, for `josh cost:audit`'s per-session-kind table.
//
// **No transcript line records why a session was started**, so the kind is read off the prompt that
// opened it — the one thing every launcher writes: the review brief names `/code-review`, a lane
// resume opens `Resuming the lane child`, a driver hand-off names `Driver handoff`, and a typed run
// opens with its workflow keyword. A delegated unit that is none of the first is a `subagent`;
// anything else is a `conversation`. The rules are tried in order, so a review run as a subagent is
// counted as a review.

const RUN_KEYWORDS = ['fullrun', 'halfrun', 'prrun', 'backlogrun', 'kickoff'] as const

const CONVERSATION = 'conversation'
const REVIEW_MARKER = '/code-review'
const RESUME_PREFIX = 'Resuming'
const WAKE_MARKER = 'Driver handoff'
const WORD_PATTERN = /^\s*([a-z]+)/u

interface KindRule {
	kind: string
	matches: (prompt: string, is_delegated: boolean) => boolean
}

const RULES: ReadonlyArray<KindRule> = [
	{ kind: 'review', matches: (prompt) => prompt.includes(REVIEW_MARKER) },
	{ kind: 'subagent', matches: (_prompt, is_delegated) => is_delegated },
	{ kind: 'resume', matches: (prompt) => prompt.trimStart().startsWith(RESUME_PREFIX) },
	{ kind: 'wake', matches: (prompt) => prompt.includes(WAKE_MARKER) },
]

function run_keyword(prompt: string): string | undefined {
	const word = WORD_PATTERN.exec(prompt)?.[1] ?? ''

	return RUN_KEYWORDS.find((keyword) => keyword === word)
}

function kind_of(prompt: string, is_delegated: boolean): string {
	const rule = RULES.find((one) => one.matches(prompt, is_delegated))

	return rule?.kind ?? run_keyword(prompt) ?? CONVERSATION
}

const cost_audit_kind = { CONVERSATION, kind_of }

export { cost_audit_kind }
