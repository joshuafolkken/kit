import { run_board_labels } from './run-board-labels'
import type { NowLine } from './run-board-now'

// The header's third line as its tests read it — `<age> <icon> <words>`, `-` for no age, blank where
// there is no line — so each test states the whole line in one string.
function drawn(line: NowLine | undefined): string {
	if (line === undefined) return ''

	const age = line.age_ms === undefined ? '-' : run_board_labels.span_of(line.age_ms)

	return `${age} ${line.icon} ${line.text}`
}

const run_board_now_fixture = { drawn }

export { run_board_now_fixture }
