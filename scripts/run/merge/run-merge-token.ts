// The control verdicts `josh run:merge` prints as its first stdout token — the protocol between it and
// `backlog:drive`, declared once here so a renamed or added token is a type error on both sides rather
// than a hand-off the loop silently stops reading.

const MERGE_TOKEN = {
	// The hand-off check after a merge: the parent's context is over its threshold.
	OVER: 'over',
	// The child's own ending: it stopped before its commit for a person to look at.
	HUMAN_REVIEW: 'human-review',
	// Matches the `busy` verdict `run:carry` emits for a refused count, so callers see one vocabulary.
	BUSY: 'busy',
	// The consecutive-failure guard tripped, or a failed child could not be parked.
	STOP: 'stop',
	// The consecutive-outage guard tripped: the environment is down, so the run stops rather than
	// re-dispatching into a dead API. Distinct from `stop` so the parent's report can say the environment
	// failed rather than the children.
	ENVIRONMENT: 'environment',
	// The child's state could not be read; re-read before deciding.
	RETRY: 'retry',
	// The child's cut was resumed in its own lane: the parent awaits that lane again, and offers no child
	// in its place.
	RESUMED: 'resumed',
} as const

type MergeToken = (typeof MERGE_TOKEN)[keyof typeof MERGE_TOKEN]

const run_merge_token = { MERGE_TOKEN }

export type { MergeToken }
export { run_merge_token }
