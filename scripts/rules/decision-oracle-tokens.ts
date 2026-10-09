// Vocabulary tokens and arguments that appear in more than one oracle entry, shared by
// `decision-oracle.ts` and `decision-oracle-batch.ts` so each string has one source.

const oracle_tokens = {
	REQUIRED: 'required',
	SKIP: 'skip',
	STOP: 'stop',
	WAIT: 'wait',
	RETRY: 'retry',
	OVER: 'over',
	UNKNOWN: 'unknown',
	NONE: 'none',
	NOT_A_LANE: 'not-a-lane',
	BUSY: 'busy',
	HUMAN_REVIEW: 'human-review',
	ISSUE_N_ARG: '<N>',
	EXCLUDE_ARG: '[--exclude <n>...]',
} as const

export { oracle_tokens }
