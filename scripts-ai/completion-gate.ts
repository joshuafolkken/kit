const GATE_LINT = 'pnpm run lint'
const GATE_CHECK_CI = 'pnpm josh check:svelte:ci'
const GATE_CSPELL = 'pnpm josh cspell:dot'
const GATE_TEST_UNIT = 'pnpm josh test:unit'

const COMPLETION_GATE_STEPS: ReadonlyArray<string> = [
	GATE_LINT,
	GATE_CHECK_CI,
	GATE_CSPELL,
	GATE_TEST_UNIT,
]

export { COMPLETION_GATE_STEPS, GATE_LINT, GATE_CHECK_CI, GATE_CSPELL, GATE_TEST_UNIT }
