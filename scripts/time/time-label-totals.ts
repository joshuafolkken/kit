import type { Span } from './time-spans'

// The per-label totals behind the per-tool and per-`josh <cmd>` tables, moved out of `time-report.ts`
// when that file passed its length limit (joshuafolkken/kit#1921). `time-report.ts` re-exports
// `LabelTotal` under the name it always had, so no caller changes where it asks for the type.

interface LabelTotal {
	label: string
	duration_ms: number
	call_count: number
}

// An empty label is not a bucket. Every span carries a category, but only tool spans carry a tool
// name, and only a Bash span running `pnpm josh <cmd>` carries a command — printing the rest under
// a blank row would invent a total nobody measured.
//
// **A continuation adds neither a call nor a duration** (joshuafolkken/kit#1304, joshuafolkken/kit#1591).
// One call bracketing a delegated unit comes back from `time_overlap.trim` as two spans, and counting
// both as calls reported a run as having made more than it did — leaving this table disagreeing with
// the round-trip block, which counts the same calls. Its duration is skipped for the same reason it is
// counted once: the head already carries the whole call in `own_duration_ms`, so adding the tail's
// share on top would price one call twice.
//
// **This is a per-call table, so it reports what the call took** — `own_duration_ms`, which the
// delegated subtraction never touches. The share of the run's wall clock is `duration_ms`, and that
// is what the categories, the phases and the segments go on reading, because those have to
// reconstruct `elapsed_ms` and this table does not.
function accumulate(totals: Map<string, LabelTotal>, label: string, span: Span): void {
	if (label === '' || span.is_continuation) return

	const existing = totals.get(label) ?? { label, duration_ms: 0, call_count: 0 }

	totals.set(label, {
		label,
		duration_ms: existing.duration_ms + span.own_duration_ms,
		call_count: existing.call_count + 1,
	})
}

function totals_by(spans: ReadonlyArray<Span>, key_of: (span: Span) => string): Array<LabelTotal> {
	const totals = new Map<string, LabelTotal>()
	const rows: Array<LabelTotal> = []

	for (const span of spans) accumulate(totals, key_of(span), span)
	// Drained with a loop rather than a spread: `Iterator#toArray` is not in this project's TS lib,
	// and the spread form the linter would otherwise demand does not type-check.
	for (const [, row] of totals) rows.push(row)

	return rows.toSorted((left, right) => right.duration_ms - left.duration_ms)
}

const time_label_totals = { totals_by }

export type { LabelTotal }
export { time_label_totals }
