import { stripVTControlCharacters } from 'node:util'
import { run_board_reveal_rain } from './run-board-reveal-rain'
import { run_board_screen } from './run-board-screen'

// The matrix rain's tests read a beat's rows: each beat is written whole at once from the top-left
// corner, its rows joined by a cursor move rather than a newline (joshuafolkken/kit#8614).

const { CURSOR_HOME, NEXT_LINE } = run_board_reveal_rain
const MARK = '\u{0}'
const [SYNC_ON = '', SYNC_OFF = ''] = run_board_screen.synced(MARK).split(MARK)
const START = `${SYNC_ON}${CURSOR_HOME}`

// The rows a beat draws, as shown; none where it is not written whole from the top-left corner.
function drawn_rows(text: string): Array<string> {
	if (!text.startsWith(START) || !text.endsWith(SYNC_OFF)) return []

	return text
		.slice(START.length, -SYNC_OFF.length)
		.split(NEXT_LINE)
		.map((row) => stripVTControlCharacters(row))
}

const run_board_reveal_rain_fixture = { drawn_rows }

export { run_board_reveal_rain_fixture }
