// The outcomes `run:merge` classifies a returned child as — each one's meaning is `run-merge.ts`'s.
// Listed as values so `run:merge --driver`'s JSON is read back against the same names
// (`run-merge-driver.ts`) rather than a second list.
const CHILD_OUTCOMES = [
	'merged',
	'withdrawn',
	'yielded',
	'human-review',
	'parked',
	'split',
	'cut',
	'outage',
	'unauthenticated',
	'usage-limit',
	'failed',
	'unresolved',
	'shipping',
] as const

type ChildOutcome = (typeof CHILD_OUTCOMES)[number]

const run_merge_outcome = { CHILD_OUTCOMES }

export type { ChildOutcome }
export { run_merge_outcome }
