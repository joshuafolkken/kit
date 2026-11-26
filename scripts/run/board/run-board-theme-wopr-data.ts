import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { ThemeColors } from './run-board-theme-host-types'

// The WARGAMES theme's tables (joshuafolkken/kit#8917), ported from the confirmed theme demo
// (`fixed-v21-theme-wargames.mjs`): its paints, the film's code and screens, the LED font, the map.

const { BOLD, ESC, bg, fg } = run_board_theme_host_grid

// CYAN, the phosphor paint (theme-defs.ts:120); IDLE_PAINT, the rule dashes and idle marks
// (theme-tones.ts:17); GAUGE_SHADES (labels.ts:325-329); the running tone white bold (theme-tones.ts:23).
const CYAN = '62;236;225'
const IDLE = '31;118;113'
const YELLOW = '255;214;10'
const RED = '255;69;58'
const GREEN = '48;209;88'
const WHITE = '255;255;255'
const COLORS: ThemeColors = {
	body: CYAN,
	rule: IDLE,
	ok: GREEN,
	red: RED,
	warn: YELLOW,
	hi: WHITE,
	type: CYAN,
	notice: CYAN,
}
const NAVY = '6;12;38'
const PALE = '200;220;255'

// The effects' own inks (beyond kit). The LAUNCH panel: its frame and labels; a spinning position is
// a dim orange, a locked one a bright orange, the lock itself white-hot for three ticks; an unlit
// segment's ghost; the dark glass.
const INK = {
	white_on: `${fg(WHITE)}${BOLD}`,
	red_on: `${fg(RED)}${BOLD}`,
	yellow_on: `${fg(YELLOW)}${BOLD}`,
	dim_red: fg('120;30;25'),
	frame: `${fg('150;60;25')}${BOLD}`,
	label: `${fg(WHITE)}${BOLD}`,
	orange_on: `${fg('255;110;30')}${BOLD}`,
	orange_dim: fg('140;55;15'),
	glass: `${fg('16;5;2')}${bg('16;5;2')}`,
	scan_wake: fg('200;255;250'),
	// The NORAD map: the sea, the coast's points, the tracks, the blobs on the map and off it.
	sea: `${fg(NAVY)}${bg(NAVY)}`,
	coast: `${fg('120;160;230')}${bg(NAVY)}`,
	blob: `${fg(WHITE)}${BOLD}${bg(NAVY)}`,
	blob_out: `${fg(WHITE)}${BOLD}`,
	// The tic-tac-toe screen: its lines and marks, their white flash, the tally.
	ttt: `${fg(PALE)}${BOLD}${bg(NAVY)}`,
	ttt_flash: `${fg(WHITE)}${BOLD}${bg(NAVY)}`,
	tally: `${fg(PALE)}${BOLD}`,
	// The WINNER table, its newest row; the whole-screen white-out and the glare's wash.
	table: `${fg('205;220;255')}${BOLD}${bg(NAVY)}`,
	table_new: `${fg(WHITE)}${BOLD}${bg(NAVY)}`,
	white_out: `${fg(WHITE)}${bg(WHITE)}`,
	wash: `${fg('235;240;255')}${BOLD}`,
	// The ending's lines and the dimmed screen behind them.
	close: `${fg('170;205;255')}${BOLD}`,
	dark: fg('40;48;60'),
	// Out lamps: yellow halved per channel, dimmed, on every row (lamps.ts:89-104).
	out: `${ESC}2m${fg('128;107;5')}`,
}
const TRACK_INKS: ReadonlyArray<string> = [
	`${fg('200;225;255')}${BOLD}${bg(NAVY)}`,
	`${fg('255;110;50')}${BOLD}${bg(NAVY)}`,
]
// The LED colors as 'r;g;b': a spinning position, a locked one, the lock's flash, an unlit segment.
const LED = { spin: '170;70;20', locked: '255;150;50', hot: '255;235;190', ghost: '72;24;8' }
// The spark burns the whole screen white, white, yellow, orange.
const SPARK_WHITE = `${fg(WHITE)}${BOLD}${bg('255;255;235')}`
const SPARK: ReadonlyArray<string> = [
	SPARK_WHITE,
	SPARK_WHITE,
	`${fg(WHITE)}${BOLD}${bg('255;232;140')}`,
	`${fg('255;250;220')}${BOLD}${bg(LED.locked)}`,
]
// The board below the area reddens as the level drops: a color a level, levels 1 to 3.
const LEVEL_INKS: ReadonlyArray<string> = [fg(RED), fg('255;130;70'), fg('255;190;90')]
// The lamp rows' lit shades: 24h, 7d, the blank line, the usage rule, two providers, GitHub.
const SHADES: ReadonlyArray<string> = [YELLOW, YELLOW, YELLOW, RED, RED, YELLOW, RED].map((shade) =>
	fg(shade),
)
// DEFCON's named colors' SGR, level 1 to 5 (1-2 red, 3-4 yellow, 5 green): `3` and this digit.
const NAMED = '11332'

const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
// `CPE 1704 TKS`, the film's final code; WOPR locks its positions in this fixed order.
const THE_CODE = 'CPE1704TKS'
const ORDER = '6280491735'
// The PROGRESS strip locks `CPE` as P, E, C.
const STRIP_RANK = '201'

// A rough world in 57 columns by 7 rows, the area's left half: the Americas on the left, Europe,
// Africa and Asia on the right.
const WORLD: ReadonlyArray<string> = [
	'      #####       ###          ####  ##############      ',
	'  ##########     ##          #######################     ',
	'    ########      #         ####  ##################  #  ',
	'      #####                #######   ###########   ##    ',
	'        ###               ######        ######    #      ',
	'         ####               ####          ##       ####  ',
	'          ##                  #                    ##    ',
]

// Drawn games, X first: cell numbers 0-8 left to right, top to bottom. No line of three ever forms.
const GAMES: ReadonlyArray<string> = [
	'402635718',
	'048263571',
	'482671350',
	'147086352',
	'246358017',
]
const MARKS = { X: ['▀▄ ▄▀', '▄▀ ▀▄'], O: ['▄▀▀▀▄', '▀▄▄▄▀'] }
const TALLY: ReadonlyArray<string> = ['GAMES', '', '', 'WINNER:', 'NONE']

// The wars' first lengths in ticks; then 7 a war.
const WAR_LENGTHS = '18 15 12 10 9 8'

const CLOSING: ReadonlyArray<string> = [
	'A STRANGE GAME.',
	'THE ONLY WINNING MOVE IS',
	'NOT TO PLAY.',
]
const INTRO = 'SHALL WE PLAY A GAME?'
const LAST_WORDS = 'HOW ABOUT A NICE GAME OF CHESS?'

const run_board_theme_wopr_data = {
	CLOSING,
	CODE,
	COLORS,
	GAMES,
	INK,
	INTRO,
	LAST_WORDS,
	LED,
	LEVEL_INKS,
	MARKS,
	NAMED,
	ORDER,
	RED,
	SHADES,
	SPARK,
	STRIP_RANK,
	TALLY,
	THE_CODE,
	TRACK_INKS,
	WAR_LENGTHS,
	WORLD,
}

export { run_board_theme_wopr_data }
