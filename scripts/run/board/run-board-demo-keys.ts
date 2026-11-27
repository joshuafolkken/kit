import type { DemoKey } from './run-board-theme-host-sample'
import type { PartName } from './run-board-theme-host-types'

// Demo mode's keys on a live board (joshuafolkken/kit#8917, Issue 4-4), read by the keys that play them
// (`run-board-theme-keys.ts`) and by the footer that names them (`run-board-demo-footer.ts`): `/` enters
// and leaves it, `s` `a` `d` `w` play the demo's IDLE, PROGRESS, ROW and NOTICE, `q` and `e` the opening
// and the ending. The works' keys are `THEME_KEYS`, one per place in `run_board_theme_run.THEME_VALUES`:
// the digits for the first ten, then `y`.

const DEMO_KEY = '/'
const THEME_KEYS = '0123456789y'
const EVENT_OF_KEY: ReadonlyMap<string, DemoKey> = new Map([
	['s', 'i'],
	['a', 'p'],
	['d', 'r'],
	['w', 'n'],
])
const PART_OF_KEY: ReadonlyMap<string, PartName> = new Map([
	['q', 'opening'],
	['e', 'ending'],
])

// The place among the works a key picks, none for any other key; the letter in either case.
function theme_index(key: string): number | undefined {
	const index = key.length === 1 ? THEME_KEYS.indexOf(key.toLowerCase()) : -1

	return index === -1 ? undefined : index
}

const run_board_demo_keys = { DEMO_KEY, EVENT_OF_KEY, PART_OF_KEY, THEME_KEYS, theme_index }

export { run_board_demo_keys }
