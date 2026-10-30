// The kind each lane ledger line carries — the discriminant `lane-ledger-schema.ts` parses on, kept
// apart so a schema module of its own can name its kind without importing the union it joins.

const KIND = {
	MERGE: 'merge',
	GATE: 'gate',
	LOAD: 'load',
	DISPATCH: 'dispatch',
	STAGE: 'stage',
	STOP: 'stop',
	OVERLAP: 'overlap',
	HELD: 'held',
	RELEASED: 'released',
	ROUND_ONE: 'round-one',
	ROUND_TWO: 'round-two',
	OFFERABLE: 'offerable',
	CORE_WAIT: 'core-wait',
	UNIT_FILES: 'unit-files',
	TEST_RELATED: 'test-related',
	TEST_PINNED: 'test-pinned',
	SPLIT_NOTICE: 'split-notice',
	SPLIT_FILED: 'split-filed',
	UNPLANNED_NOTICE: 'unplanned-notice',
	LANE_STATE: 'lane-state',
	PUSH_MISS: 'push-miss',
	SHIP_LAP: 'ship-lap',
	SIZE: 'size',
} as const

const lane_ledger_kind = { KIND }

export { lane_ledger_kind }
