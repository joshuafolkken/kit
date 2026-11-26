// The LAUNCH panel's LED font for the WARGAMES theme (joshuafolkken/kit#8917), ported from the
// confirmed theme demo (`fixed-v21-theme-wargames.mjs`).
// cspell:disable -- segment-name strings (`abcdefkl`).

// Fourteen-segment characters on a 5 by 5 grid of square pixels (a pixel a column, half a row), drawn
// in half blocks: each cell carries two pixels, the upper as its foreground and the lower as its
// background. Segments: a top, d bottom, f/b upper left/right, e/c lower left/right, g/h the two
// middle halves, i/k upper diagonals, j upper middle, l/n lower diagonals, m lower middle. Each pixel
// is written `<row><column>`.
const SEGMENT_AT: Readonly<Record<string, string>> = {
	a: '01 02 03',
	d: '41 42 43',
	f: '10',
	b: '14',
	e: '30',
	c: '34',
	g: '21',
	h: '23',
	i: '11',
	j: '12',
	k: '13',
	l: '31',
	m: '32 42',
	n: '33',
}
// A corner or the centre lights with any segment that meets it: `<pixel> <segments>`.
const JOINS: ReadonlyArray<string> = [
	'00 af',
	'04 ab',
	'20 feg',
	'24 bch',
	'40 ed',
	'44 cd',
	'22 ghjm',
]
// Each character's lit segments; the digits first, as the demo's keys enumerated.
const SEGMENTS: ReadonlyMap<string, string> = new Map([
	['0', 'abcdef'],
	['1', 'bc'],
	['2', 'abghed'],
	['3', 'abhcd'],
	['4', 'fghbc'],
	['5', 'afghcd'],
	['6', 'afedcgh'],
	['7', 'abc'],
	['8', 'abcdefgh'],
	['9', 'abcdfgh'],
	['A', 'abcefgh'],
	['B', 'abcdjmh'],
	['C', 'afed'],
	['D', 'abcdjm'],
	['E', 'afedg'],
	['F', 'afeg'],
	['G', 'afedch'],
	['H', 'febcgh'],
	['J', 'bcde'],
	['K', 'fegkn'],
	['L', 'fed'],
	['M', 'feikbc'],
	['N', 'feinbc'],
	['P', 'abfegh'],
	['R', 'abfeghn'],
	['S', 'afghcd'],
	['T', 'ajm'],
	['U', 'fedcb'],
	['V', 'felk'],
	['W', 'felnbc'],
	['X', 'ikln'],
	['Y', 'ikm'],
	['Z', 'akld'],
])
// The 5 by 5 grid fitted to the window: rows of 2, 3, 2, 3, 2 half-rows (six screen rows).
const ROW_SPANS = '23232'
// K is drawn by hand: the left upright, and a `<` stepping from the right column at the top in to the
// upright at the middle and back out to the right column at the bottom — its column a half-row.
const K_STEPS = '443321123344'

const run_board_theme_wopr_font_data = { JOINS, K_STEPS, ROW_SPANS, SEGMENTS, SEGMENT_AT }

export { run_board_theme_wopr_font_data }
