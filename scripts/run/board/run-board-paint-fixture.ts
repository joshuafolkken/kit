import type { Paint } from './run-board-labels'

// A paint's 24-bit color, `R;G;B`; none for a palette color or no paint.
function rgb_of(paint: Paint | undefined): string | undefined {
	return typeof paint === 'object' && 'rgb' in paint ? paint.rgb : undefined
}

const run_board_paint_fixture = { rgb_of }

export { run_board_paint_fixture }
