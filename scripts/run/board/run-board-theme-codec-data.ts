import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { EventKey, ThemeColors } from './run-board-theme-host-types'

// The codec theme's tables (joshuafolkken/kit#8917), ported from the confirmed theme demo
// (`fixed-v21-theme-demo.mjs`, theme 4; PROGRESS from `fixed-v22-theme-demo.mjs`): its frequencies
// and the styles its drawings share. The portraits are `run-board-theme-codec-face-*.ts`.

const { BOLD, bg, fg } = run_board_theme_host_grid

// The greens and the whites more than one place paints.
const GREEN = {
	mid: '56;160;90',
	shade: '40;95;60',
	pale: '235;255;235',
	body: '150;215;160',
	frame: '80;170;105',
	bright: '130;255;160',
	glow: '225;255;230',
	white: '255;255;255',
	ok: '110;255;140',
	ink: '20;10;0',
}

const CODEC_FREQUENCIES: ReadonlyArray<string> = ['140.85', '141.12', '140.96', '141.80']

// The styles more than one drawing shares.
const STYLE = {
	green_dim: fg('60;130;85'),
	dark_box: bg('6;34;20'),
	codec_lit: `${fg(GREEN.glow)}${BOLD}`,
	bar_on: fg('200;255;215'),
	bar_off: fg(GREEN.shade),
	side: fg(GREEN.mid),
	freq_head: `${fg('70;150;95')}${BOLD}`,
	frame: `${fg(GREEN.frame)}${BOLD}`,
	yellow: `${fg('255;210;60')}${BOLD}`,
	white: `${fg(GREEN.white)}${BOLD}`,
	query: `${fg('30;20;0')}${BOLD}${bg('230;180;20')}`,
	alarm: `${fg(GREEN.white)}${BOLD}${bg('200;20;20')}`,
	on_green: `${fg(GREEN.ink)}${BOLD}${bg(GREEN.bright)}`,
	green_bold: `${fg(GREEN.bright)}${BOLD}`,
	pale_bold: `${fg(GREEN.pale)}${BOLD}`,
	log_name: `${fg(GREEN.ok)}${BOLD}`,
	body: fg(GREEN.body),
}

const LIFE = { every: 90, flash: 3, flash_color: '180;235;255', color: '90;200;255' }

const COLORS: ThemeColors = {
	body: GREEN.body,
	rule: '45;100;65',
	ok: GREEN.ok,
	red: '255;60;50',
	warn: '255;205;70',
	hi: GREEN.pale,
	type: GREEN.pale,
	notice: '255;230;60',
	// The marks' tones: info, idle, waiting on a person.
	info: '110;190;170',
	idle: '75;125;85',
	human: '180;225;255',
}

const NOTES: Partial<Record<EventKey, string>> = {
	a: 'notice, progress, new lane, progress — every effect in turn',
	n: 'ALERT: the jammed radar and countdown take the area, the banner overflows into the header · → EVASION → CAUTION',
	p: 'a codec call takes the area: the commander left, the operative right, the stepped level meter over the frequency',
	r: 'a field display takes the area: LIFE and equipment boxes, the mission log typing, the radar with a new contact',
	i: 'guards patrol the radar · a blip runs along the codec line',
}

// The codec's level meter, rising and falling.
const SPINNER = '▁▂▃▅▇█▇▅▃▂'

// The left-pointing triangle (U+25C0) the display's arrow and the header's shout draw, by its code
// point: the board's glyph table has no row for it, and the board's sources are scanned for
// pictographs that need one; here it is drawn as text, one cell wide, as the demo draws it.
const LEFT_ARROW = '\u{25C0}'

// The frequency of memory `index`, round the stored channels.
function freq_at(index: number): string {
	return CODEC_FREQUENCIES[index % CODEC_FREQUENCIES.length] ?? ''
}

// The LIFE bar's color: a white glint every few seconds.
function life_color(tick: number): string {
	return fg(tick % LIFE.every < LIFE.flash ? LIFE.flash_color : LIFE.color)
}

const run_board_theme_codec_data = {
	CODEC_FREQUENCIES,
	COLORS,
	GREEN,
	LEFT_ARROW,
	NOTES,
	SPINNER,
	STYLE,
	freq_at,
	life_color,
}

export { run_board_theme_codec_data }
