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
const STAMP_COMPLETED_AT = '2026-09-01T00:05:00.000Z'

// The default is the record of a run that finished, because that is what every question about a
// converged run is asked of. `false` builds the record an interrupted run leaves — measured, with no
// verdict behind it (joshuafolkken/kit#1164). A flag rather than an optional completion string,
// because an explicitly passed `undefined` takes a parameter's default and would silently build the
// completed record the caller was asking not to have. One builder either way, so the two suites go
// on asserting against a single definition of the shape.
function stamp_of(files: Record<string, string>, is_finished = true): EvalStamp {
	return {
		taken_at: STAMP_STARTED_AT,
		files,
		...(is_finished && { completed_at: STAMP_COMPLETED_AT }),
	}
}

export { STAMP_DOCUMENT, STAMP_HASH, STAMP_OTHER_HASH, STAMP_STARTED_AT, stamp_of }
