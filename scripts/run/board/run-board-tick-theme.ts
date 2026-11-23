import { run_board_lamps } from './run-board-lamps'
import type { Spun } from './run-board-spin'
import type { BoardPorts } from './run-board-state'
import { run_board_theme_defs, type LiveDefs, type ThemeDefinition } from './run-board-theme-defs'

// What the theme a `run:board` frame is drawn in carries (`run-board-tick-draw.ts`): its lamp panel, the
// panel's idle rain and rule lamps, how a new row enters, the rules' code, the lamp strip and the drop,
// each read off the board's ports and the theme's definition.

const { THEME_DEFS, live_of, is_rule_lamped } = run_board_theme_defs

// The theme rows whose lamp choice the panel reads.
type LampDefs = Readonly<Partial<Record<string, Pick<ThemeDefinition, 'lamps'>>>>

type LampPorts = Pick<BoardPorts, 'types_rows' | 'is_live' | 'theme'>

type LivePorts = Pick<BoardPorts, 'types_rows' | 'is_live' | 'theme' | 'is_tty'>

type ThemePorts = Pick<BoardPorts, 'theme'>

// Whether a live board — its rows typing, or the board live though they do not (joshuafolkken/kit#8674)
// — is drawn in a theme whose definition draws lamps (joshuafolkken/kit#8359).
function is_lamp_theme(ports: LampPorts, defs: LampDefs): boolean {
	const is_live = ports.types_rows === true || ports.is_live === true

	return is_live && ports.theme !== undefined && defs[ports.theme]?.lamps === true
}

// Whether the board draws on a terminal drawing color.
function is_colored_tty(ports: Pick<BoardPorts, 'is_tty'>): boolean {
	return ports.is_tty && run_board_lamps.is_colored()
}

// The lamp panel shows where the rows type — a live board in a theme that draws lamps — on a terminal
// drawing color (joshuafolkken/kit#8236).
function has_lamps(ports: LivePorts, defs: LampDefs = THEME_DEFS): boolean {
	return is_lamp_theme(ports, defs) && is_colored_tty(ports)
}

// Whether the lamp panel's cells run the idle rain: where the panel shows, in a theme whose live board
// rains there (joshuafolkken/kit#8356).
function has_rain(ports: LivePorts): boolean {
	return has_lamps(ports) && live_of(ports.theme).rain
}

// Whether the lamp panel runs over the usage rule's row: where the panel shows, in a theme whose
// definition lamps the rule (joshuafolkken/kit#8702).
function has_rule_lamps(ports: LivePorts): boolean {
	return has_lamps(ports) && is_rule_lamped(ports.theme)
}

// Whether the section rules run code while a row types: a theme whose live board decodes them, where its
// lamp panel shows — the spin gates them on the lamps it blinks (joshuafolkken/kit#8375).
function has_codes(ports: ThemePorts, defs: LiveDefs = THEME_DEFS): boolean {
	return live_of(ports.theme, defs).codes
}

// Whether a lamp strip fills above each rule: where the rules run code, in a theme whose definition
// switches the strip on (joshuafolkken/kit#8376) — off by default (joshuafolkken/kit#8398).
function has_strip(ports: ThemePorts, defs: LiveDefs = THEME_DEFS): boolean {
	const live = live_of(ports.theme, defs)

	return live.codes && live.strip
}

// How a new row enters: typed where the rows type; in a theme whose live board decodes them, decoded on
// a terminal drawing color and shown at once on one drawing none (joshuafolkken/kit#8356).
type RowEntry = 'type' | 'decode' | 'none'

function entry_of(ports: LivePorts, defs: LiveDefs = THEME_DEFS): RowEntry {
	if (ports.types_rows !== true) return 'none'
	if (!live_of(ports.theme, defs).decode) return 'type'

	return is_colored_tty(ports) ? 'decode' : 'none'
}

type Decoded = Pick<Spun, 'rules' | 'strips'>

// The rules running code and the strips filling above them that the spin draws, each kept only where its
// switch is on — off, the board holds no cell for it and the spin writes none.
function decoded_of(ports: ThemePorts, drawn: Decoded, defs: LiveDefs = THEME_DEFS): Decoded {
	return {
		rules: has_codes(ports, defs) ? drawn.rules : [],
		strips: has_strip(ports, defs) ? drawn.strips : [],
	}
}

// Whether a drop falls down the board between redraws: a live board on a terminal drawing color, in a
// theme whose live board drops one (joshuafolkken/kit#8367) — the lamps' gate, by the theme's own switch.
function has_drop(ports: LivePorts, defs: LiveDefs = THEME_DEFS): boolean {
	if (ports.types_rows !== true || !live_of(ports.theme, defs).drop) return false

	return is_colored_tty(ports)
}

const run_board_tick_theme = {
	decoded_of,
	entry_of,
	has_drop,
	has_lamps,
	has_rain,
	has_rule_lamps,
	has_strip,
}

export { run_board_tick_theme }
export type { LivePorts }
