import { time_format } from './time-format'
import type { PhaseTotal } from './time-phases'

// The phase breakdown's own rendering, and the one line that says what the table does not show
// (joshuafolkken/kit#1392).
//
// **A withheld row leaves its minutes in the denominator, and nothing in the table said so.** Since
// joshuafolkken/kit#1384 the `ci` phase prints `not detected` where the commit listing or the
// check-runs could not be read, while `categories.ci_ms` stays inside `elapsed_ms` — so on a run with
// three measured minutes of the open→merge window that no span covers, the `ci` row carries no number
// and those three minutes still shrink every other row's share. The column then stops adding up to
// 100% with nothing accounting for the difference. `time-run.ts`'s cycle note explains in prose *why*
// the row is withheld, which stops a reader taking it for a contradiction; it does not make the
// arithmetic readable, which is what the footnote below does.
//
// **The footnote is the presentation-layer answer, chosen over the two that are not.** Printing the
// share under a withheld heading would reinterpret joshuafolkken/kit#1384's shipped acceptance
// criterion and put a number under a row whose cycle detail is unknown; dropping the withheld part
// out of the denominator would move `elapsed_ms`'s own definition and can break the invariant that
// the four category shares reconstruct it. The complaint is that the difference cannot be read off
// the table, so the fix is to print the difference (joshuafolkken/kit#1392 → the decision comment).
//
// **It moved out of `time-report.ts` because that file was at 291 of its 300 code lines** — the seam
// `time-trips.ts` was cut along for the same reason (joshuafolkken/kit#1385), where a block owns its
// own rendering and the report calls one function per block. The two names the report always
// exported are re-exported there, so no caller had to learn a second namespace.
//
// **It renders one run's table, not `--last`'s.** That scope prints a median per phase across several
// runs, where "the minutes this run withheld" is not a quantity that exists — so it keeps its own
// renderer rather than being handed a footnote about a denominator it does not have.

const { format_columns, format_row, format_share, SUFFIX_SEPARATOR } = time_format

const NOT_DETECTED = 'not detected'
const HEADING = 'By phase (in run order):'
// The footnote's own label, in the column the phase names sit in, so the line reads as part of the
// table rather than as prose that happens to follow it.
const WITHHELD_LABEL = 'withheld from the rows'
// **The note says where the minutes *are*, not where they are not.** The label already says they are
// missing from the rows; what a reader cannot otherwise tell is that they are still inside the total
// every share above was taken against.
const WITHHELD_NOTE = 'counted in the elapsed total'
const NONE = 0

// **A phase whose marker never appeared says so rather than printing `0.0 min`.** "Did not run" and
// "this transcript could not be read for it" are different answers, and a measured zero asserts the
// first when only the second may be true. The words go in the share column with the duration column
// left empty, because there is no duration — not a short one.
function phase_line(phase: PhaseTotal, elapsed_ms: number): string {
	if (!phase.is_detected) return format_columns(phase.phase, '', NOT_DETECTED)

	return format_row(phase.phase, phase.duration_ms, format_share(phase.duration_ms, elapsed_ms))
}

// The withheld rows that actually hold time. **A withheld row of zero minutes is left out**: it takes
// nothing out of the column, so a footnote naming it would report a `0.0 min` difference — the
// confident zero the withholding exists to prevent, one line further down. Most withheld phases are
// this kind: a window whose boundary was never found collects no span either.
function withheld_of(phases: ReadonlyArray<PhaseTotal>): Array<PhaseTotal> {
	return phases.filter((phase) => !phase.is_detected && phase.duration_ms > NONE)
}

// **The names are printed because the footnote is otherwise unattributable.** A reader who can see
// that 3.0 minutes are missing still cannot act on it without knowing which reading was withheld, and
// the phase name is what `time-run.ts`'s note is then read against.
function withheld_line(phases: ReadonlyArray<PhaseTotal>, elapsed_ms: number): Array<string> {
	const withheld = withheld_of(phases)

	if (withheld.length === NONE) return []

	const duration_ms = withheld.reduce((sum, phase) => sum + phase.duration_ms, NONE)
	const names = withheld.map((phase) => phase.phase).join(', ')
	const share = format_share(duration_ms, elapsed_ms)

	return [
		format_row(WITHHELD_LABEL, duration_ms, [share, names, WITHHELD_NOTE].join(SUFFIX_SEPARATOR)),
	]
}

function phase_lines(phases: ReadonlyArray<PhaseTotal>, elapsed_ms: number): Array<string> {
	if (phases.length === NONE) return []

	return [
		'',
		HEADING,
		...phases.map((phase) => phase_line(phase, elapsed_ms)),
		...withheld_line(phases, elapsed_ms),
	]
}

const time_phase_table = {
	HEADING,
	NOT_DETECTED,
	WITHHELD_LABEL,
	WITHHELD_NOTE,
	phase_lines,
}

export { time_phase_table }
