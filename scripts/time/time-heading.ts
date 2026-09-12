import { time_format } from './time-format'
import { time_windows, type RunWindows } from './time-windows'

// What sits under the scope line in every report, and the empty-report page. Lifted out of
// `time-report.ts` when the delegated-wait block pushed that file to its length limit
// (joshuafolkken/kit#1881) — presentation only, and it reads just the three fields below, so it takes
// them as a narrow shape rather than the whole `TimeReport`, which would import a cycle back.
interface Headed {
	scope: string
	notes: ReadonlyArray<string>
	windows: RunWindows
}

// What sits under the scope line in every report: the notes that qualify the figures, then the three
// windows those figures are lengths inside of.
function heading_lines(report: Headed): Array<string> {
	return [...time_format.note_lines(report.notes), ...time_windows.window_lines(report.windows)]
}

function format_empty(report: Headed): string {
	return [
		`${report.scope} — no timed lines`,
		// The windows are printed here too: an issue nobody worked on in this checkout can still have
		// been filed and closed, and that is a measurement even where no span was read.
		...heading_lines(report),
		'',
		'A span needs two dated lines to sit between, and nothing read here has a pair. So there is',
		'no elapsed time to divide up.',
	].join('\n')
}

const time_heading = { heading_lines, format_empty }

export { time_heading }
