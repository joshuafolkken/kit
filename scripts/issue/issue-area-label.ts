import { run_prep_locate } from '#scripts/run/run-prep-locate'
import { AREA_BOARD_LABEL, AREA_LABEL_PREFIX, AREA_THEME_LABEL } from './issue-labels'

// joshuafolkken/kit#8960: `run:board` draws an issue's area before its title. The area is read from
// the backticked paths the body names, so `issue:file` applies it and no filer has to remember it.
// A theme path wins over a board path: a theme issue carries `area:theme` alone.

const THEME_PATHS = ['scripts/run/board/run-board-theme-', 'skills/board-theme']
const BOARD_PATH = 'scripts/run/board/'

function names_any(names: ReadonlyArray<string>, paths: ReadonlyArray<string>): boolean {
	return names.some((name) => paths.some((path) => name.includes(path)))
}

function area_label_of(body: string): string | undefined {
	const names = run_prep_locate.names_of(body)

	if (names_any(names, THEME_PATHS)) return AREA_THEME_LABEL

	return names_any(names, [BOARD_PATH]) ? AREA_BOARD_LABEL : undefined
}

// The labels with the body's area added, unless a label already names an area.
function with_label(labels: ReadonlyArray<string>, body: string): ReadonlyArray<string> {
	if (labels.some((label) => label.toLowerCase().startsWith(AREA_LABEL_PREFIX))) return labels

	const area = area_label_of(body)

	return area === undefined ? labels : [...labels, area]
}

const issue_area_label = { area_label_of, with_label }

export { issue_area_label }
