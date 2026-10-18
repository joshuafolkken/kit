import { run_merge_token, type MergeToken } from '#scripts/run/merge/run-merge-token'

const { MERGE_TOKEN } = run_merge_token

// How the loop reads each `run:merge` token — keyed by the producer's own type, so a token added there
// is a type error here until it is classified. `hand-back` ends the loop at once: a hand-off, a person's
// stop, the environment down, a foreign owner, an unreadable state. `stop` — the failure guard, or a
// failed child left unparked — collects the child, starts nothing more, and collects the children still
// in flight before the loop ends. `await` is a cut resumed in place: the same lane is awaited again.
//
// **The offer `run:merge` passes through is never read here** (joshuafolkken/kit#3781): its `stop` —
// only person-waiting issues left — is spelled like the control one, and acting on it ended the run
// without the idle watch. The loop asks `backlog:offer` on the next pass instead, so whether a parked
// backlog waits or ends is `backlog:budget`'s alone, after a merge as after any other pass.
type TokenHandling = 'hand-back' | 'stop' | 'await'
const TOKEN_HANDLING: Readonly<Record<MergeToken, TokenHandling>> = {
	[MERGE_TOKEN.OVER]: 'hand-back',
	[MERGE_TOKEN.HUMAN_REVIEW]: 'hand-back',
	[MERGE_TOKEN.ENVIRONMENT]: 'hand-back',
	[MERGE_TOKEN.BUSY]: 'hand-back',
	[MERGE_TOKEN.RETRY]: 'hand-back',
	[MERGE_TOKEN.STOP]: 'stop',
	[MERGE_TOKEN.RESUMED]: 'await',
}

function tokens_handled(...handlings: ReadonlyArray<TokenHandling>): ReadonlySet<string> {
	const entries = Object.entries(TOKEN_HANDLING)

	return new Set(entries.filter(([, handling]) => handlings.includes(handling)).map(([key]) => key))
}

const IMMEDIATE_TOKENS = tokens_handled('hand-back')
// Every token `run:merge` prints first even on a non-zero exit.
const HANDOFF_TOKENS = tokens_handled('hand-back', 'stop')

const backlog_drive_token_handling = { HANDOFF_TOKENS, IMMEDIATE_TOKENS, TOKEN_HANDLING }

export { backlog_drive_token_handling }
