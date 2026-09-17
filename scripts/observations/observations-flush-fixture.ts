import { OBSERVATION_LEDGER_PATH } from './observation-ledger'

// The fixtures both flush test suites assert against, named once rather than in each
// (joshuafolkken/kit#1785). `observations-flush.test.ts` reads the message builders and
// `observations-flush-command.test.ts` drives the command against a mocked git, so the stamp and the
// branch name it produces are asserted from two files — and a copy that drifted would leave one of
// them asserting a branch name the other's clock never generates.
const DEFAULT_BRANCH = 'main'
const MORNING_INSTANT = '2026-09-11T02:14:42Z'
const FLUSH_BRANCH = 'observations/2026-09-11-021442'
const MODIFIED_LEDGER = ` M ${OBSERVATION_LEDGER_PATH}`

// The two phrases that separate the refusals from one another, so a suite cannot assert one arm with
// a substring the other arm also contains.
const MS_COMMAND = 'pnpm josh ms'
const ONLY_COPY = 'only copy'

export { DEFAULT_BRANCH, FLUSH_BRANCH, MODIFIED_LEDGER, MORNING_INSTANT, MS_COMMAND, ONLY_COPY }
