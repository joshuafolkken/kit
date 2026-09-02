import type { EvalStamp } from './eval-stamp'

// The record of a `josh eval` run, built for a test (joshuafolkken/kit#1152).
//
// Two suites ask about the same record — the module that takes it and the command that reads it —
// and a second copy of the builder would let them disagree about the shape they are both asserting
// against, which is the one thing a fixture exists to prevent.

const STAMP_DOCUMENT = 'CLAUDE.md'
const STAMP_STARTED_AT = '2026-09-01T00:00:00.000Z'
const STAMP_HASH = 'a1b2c3'
const STAMP_OTHER_HASH = 'd4e5f6'

function stamp_of(files: Record<string, string>): EvalStamp {
	return { taken_at: STAMP_STARTED_AT, files }
}

export { STAMP_DOCUMENT, STAMP_HASH, STAMP_OTHER_HASH, STAMP_STARTED_AT, stamp_of }
