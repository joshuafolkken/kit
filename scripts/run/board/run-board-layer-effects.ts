import { run_board_change_flash } from './run-board-change-flash'
import { run_board_codes } from './run-board-codes'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_jump_screen } from './run-board-jump-screen'
import { run_board_lamps } from './run-board-lamps'
import { run_board_layer, type Layer } from './run-board-layer'
import { run_board_notice_turn } from './run-board-notice-turn'
import { run_board_panel_draw as panel_draw } from './run-board-panel-draw'
import { run_board_rain_drop } from './run-board-rain-drop'
import { run_board_spin_turn, type Turning } from './run-board-spin-turn'
import { run_board_strip } from './run-board-strip'
import { run_board_sweep } from './run-board-sweep'
import { run_board_trace_spot } from './run-board-trace-spot'

// The decor layers of a live `run:board` frame (joshuafolkken/kit#8826), drawn past the theme: under the
// spinners the drops and the bttf jump; over them the flash, the notice, the lamps, the rules' code, the
// strips and the TRACE field. Each is still the ANSI bytes its effect wrote before frames had cells, but
// the jump, whose wash repaints every cell each frame, gives its cells one by one (`glyph_layer`).

const { NEVER, boundary_after, bytes_layer, every, glyph_layer } = run_board_layer
const { coded, lamp_moment, painting, traces_of } = run_board_spin_turn
const { LAMP_TICK_MS } = run_board_lamps

function drop_layer(turning: Turning): Layer {
	const { drop } = turning

	return bytes_layer(
		(at_ms, since_ms) => run_board_rain_drop.drop_bytes(drop, at_ms, since_ms),
		every(drop !== undefined, run_board_sweep.SWEEP_MS),
	)
}

function jump_layer(turning: Turning): Layer {
	const { jump } = turning

	return glyph_layer(
		(at_ms) => run_board_jump_screen.wash_at(jump, at_ms),
		every(jump !== undefined, run_board_jump_screen.FRAME_MS),
	)
}

function flash_layer(turning: Turning): Layer {
	const { flash } = turning

	return bytes_layer(
		(at_ms, since_ms) =>
			run_board_change_flash.bytes(
				flash,
				at_ms,
				since_ms === undefined ? undefined : { ms: since_ms },
			),
		(now_ms) => run_board_change_flash.wake_after(flash, now_ms),
	)
}

function notice_layer(turning: Turning): Layer {
	const notice = turning.notice_trace

	return bytes_layer(
		(at_ms) => run_board_notice_turn.notice_bytes(notice, at_ms),
		(now_ms) => run_board_notice_turn.wake_after(notice, now_ms),
	)
}

// The lamps that changed since `since_ms`; every lamp with no `since_ms`. They step on the lamps' tick,
// which the spinner's wake no longer brings where a board has no spinner (joshuafolkken/kit#8826).
function panel_layer(turning: Turning): Layer {
	const draw = painting(turning)
	const lamp_step = every(draw !== undefined, LAMP_TICK_MS)

	return bytes_layer(
		(at_ms, since_ms) => {
			if (draw === undefined) return ''
			const since = since_ms === undefined ? undefined : lamp_moment(turning, since_ms)

			return panel_draw.panel_bytes(draw, lamp_moment(turning, at_ms), since)
		},
		(now_ms) => Math.min(lamp_step(now_ms), panel_draw.tick_after(draw, now_ms)),
	)
}

function codes_layer(turning: Turning): Layer {
	const { typing, cells } = coded(turning)

	return bytes_layer(
		(at_ms, since_ms) => run_board_codes.code_bytes(typing, cells, at_ms, since_ms),
		(now_ms) =>
			run_board_codes.is_coding(typing, cells, now_ms)
				? boundary_after(now_ms, run_board_codes.CODE_MS)
				: NEVER,
	)
}

// The strips, twinkling on the lamps' tick.
function strip_layer(turning: Turning): Layer {
	const striped = { ...coded(turning), strips: turning.strips ?? [] }

	return bytes_layer(
		(at_ms, since_ms) => run_board_strip.strip_bytes(striped, at_ms, since_ms),
		every(striped.strips.length > 0, LAMP_TICK_MS),
	)
}

function trace_layer(turning: Turning): Layer {
	const traces = traces_of(turning)

	return bytes_layer(
		(at_ms, since_ms) => run_board_trace_spot.traces_bytes(traces, at_ms, since_ms),
		(now_ms) => (traces.length > 0 ? run_board_header_trace.boundary_after(now_ms) : NEVER),
	)
}

// The layers under the spinners.
function under(turning: Turning): Array<Layer> {
	return [drop_layer(turning), jump_layer(turning)]
}

// The layers over the spinners and the rows typing.
function over(turning: Turning): Array<Layer> {
	return [
		flash_layer(turning),
		notice_layer(turning),
		panel_layer(turning),
		codes_layer(turning),
		strip_layer(turning),
		trace_layer(turning),
	]
}

const run_board_layer_effects = { over, under }

export { run_board_layer_effects }
