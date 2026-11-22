import { stripVTControlCharacters, styleText } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_label_pair } from './run-board-label-pair'
import type { BoardPorts } from './run-board-state'
import { run_board_theme } from './run-board-theme'

// joshuafolkken/kit#8397: a section rule's `─` sinks into the idle tone's dim cyan in wargames, on every
// frame (`--once` and `--chat` included); its name, its column titles and a gauge's `-` keep the text's.

const ESCAPE = '\u{1B}'
const DEFAULT_FOREGROUND = `${ESCAPE}[39m`
const RGB_PHOSPHOR = `${ESCAPE}[38;2;62;236;225m`
const RGB_MATRIX = `${ESCAPE}[38;2;0;215;60m`
const RGB_MID = `${ESCAPE}[38;2;0;165;40m`
const RGB_DARK = `${ESCAPE}[38;2;0;100;22m`
const MATRIX_DASH = `${RGB_DARK}-${RGB_MID}`
const RGB_DIM = `${ESCAPE}[38;2;31;118;113m`
// A dim dash as the theme draws it: the dim, then the phosphor cyan resumed after it.
const DIM_DASH = `${RGB_DIM}-${RGB_PHOSPHOR}`
const SHORT_RULE = '── LANES ──'
const ICON_RULE = '── 📈 throughput ──'
const DIM_RULE = `${ESCAPE}[2m──${ESCAPE}[22m`
const DIM_HEADING = `${DIM_RULE} LANES ${DIM_RULE}`
const BOLD = `${ESCAPE}[1m`
const DIM = `${ESCAPE}[2m`
const INTENSITY_END = `${ESCAPE}[22m`
const BODY = '  ■■■──── 3/7 ── 2 CPU'

function wargames(line: string): string {
	return run_board_theme.restyle('wargames', line)
}

function in_phosphor(text: string): string {
	return `${RGB_PHOSPHOR}${text}${DEFAULT_FOREGROUND}`
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_theme.restyle the section rules', () => {
	it('draws every `─` of a section rule in the dim cyan, its name and column titles in the phosphor cyan', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const dashes = DIM_DASH.repeat(2)

		expect(wargames('── LANES ── CPU ──')).toBe(
			in_phosphor(`${dashes} LANES ${dashes} CPU ${dashes}`),
		)
	})

	it('leaves the `-` of a line that is not a section rule in the phosphor cyan', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(wargames(BODY)).toBe(in_phosphor('  ■■■---- 3/7 -- 2 CPU'))
	})

	it.each(['▾ LANES ──', '▸ QUEUE ──', '─ LANES ──'])(
		'dims the rule past the lead of %s',
		(line) => {
			vi.stubEnv('FORCE_COLOR', '3')

			expect(wargames(line)).toContain(`${DIM_DASH}${DIM_DASH}${DEFAULT_FOREGROUND}`)
		},
	)

	it('dims the section icon drawn as a rule, `── 📈 throughput ──` reading `-- -- THROUGHPUT --`', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const dashes = DIM_DASH.repeat(2)

		expect(wargames(ICON_RULE)).toBe(in_phosphor(`${dashes} ${dashes} THROUGHPUT ${dashes}`))
	})
})

describe('run_board_theme.restyle the section rules, left as they were', () => {
	it('keeps wargames dim rules and cyan headings without true color', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const dashes = `${DIM}-${INTENSITY_END}`.repeat(2)

		expect(wargames(SHORT_RULE)).toBe(`${ESCAPE}[36m${dashes} LANES ${dashes}${DEFAULT_FOREGROUND}`)
	})

	it('draws plain dashes where stdout draws no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(wargames(SHORT_RULE)).toBe('-- LANES --')
	})

	it('draws matrix rules dark, section names and column titles mid, and body text in its body green', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const dashes = MATRIX_DASH.repeat(2)

		expect(run_board_theme.restyle('matrix', '── LANES ── CPU ──\nBODY')).toBe(
			`${RGB_MID}${dashes} LANES ${dashes} CPU ${dashes}${DEFAULT_FOREGROUND}\n${RGB_MATRIX}BODY${DEFAULT_FOREGROUND}`,
		)
	})
})

describe('run_board_theme matrix rule boundaries', () => {
	it.each(['▾ 📈 throughput ──', '▸ 📈 throughput ──', ICON_RULE])(
		'draws section icons and rules dark in %s',
		(line) => {
			vi.stubEnv('FORCE_COLOR', '3')
			const drawn = run_board_theme.restyle('matrix', line)

			expect(drawn).toContain(MATRIX_DASH.repeat(2))
			// joshuafolkken/kit#8609: the heading as written.
			expect(drawn).toContain(`${RGB_MID} throughput `)
		},
	)

	it('draws idle glyphs in the matrix mid green on body rows', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(run_board_theme.restyle('matrix', '⏳ WAIT')).toBe(
			`${RGB_MATRIX}${RGB_MID}..${RGB_MATRIX} WAIT${DEFAULT_FOREGROUND}`,
		)
	})

	it('keeps renderer colors on rule dashes and text and body gauges', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const red = styleText('red', '── RED ──')
		const gauge = styleText('cyan', '■──')

		expect(run_board_theme.restyle('matrix', red)).toBe(
			`${RGB_MID}${red.replaceAll('─', '-').split(DEFAULT_FOREGROUND).join(RGB_MID)}${DEFAULT_FOREGROUND}`,
		)
		expect(run_board_theme.restyle('matrix', gauge)).toBe(
			`${RGB_MATRIX}${gauge.replaceAll('─', '-').split(DEFAULT_FOREGROUND).join(RGB_MATRIX)}${DEFAULT_FOREGROUND}`,
		)
	})

	it('falls back to named green for matrix dashes, labels and idle glyphs', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const drawn = run_board_theme.restyle('matrix', '── LANES ──\n⏳ WAIT')

		expect(drawn).toContain(`${ESCAPE}[32m-${ESCAPE}[32m`)
		expect(drawn).toContain(`${ESCAPE}[32m..${ESCAPE}[32m`)
		expect(drawn).not.toContain('[38;2;')
	})
})

describe('run_board_theme default section rules', () => {
	it.each(['── ', '▾ ', '▸ ', '─ '])('dims only the rules of the %s heading', (lead) => {
		vi.stubEnv('FORCE_COLOR', '3')
		const frame = `${lead}📈 throughput ── CPU ──`
		const opening = lead.includes('─') ? `${styleText('dim', lead.trim())} ` : lead

		expect(run_board_theme.restyle(undefined, frame)).toBe(
			`${opening}📈 throughput ${DIM_RULE} CPU ${DIM_RULE}`,
		)
	})

	it('keeps label icons and title marks while styling the marked heading', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const label = run_board_label_pair.pair('📈', 'throughput')
		const frame = run_board_label_pair.titled(`▾ ${label} ──`)
		const drawn = run_board_theme.marked(undefined, frame)

		expect(drawn).toBe(run_board_label_pair.titled(`▾ ${label} ${DIM_RULE}`))
		expect(run_board_theme.restyle(undefined, frame)).toBe(`▾ ${label} ${DIM_RULE}`)
	})

	it('restores bold after each rule without changing the heading color', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const heading = styleText('bold', styleText('red', SHORT_RULE))

		expect(run_board_theme.restyle(undefined, heading)).toBe(
			`${BOLD}${ESCAPE}[31m${DIM_RULE}${BOLD} LANES ${DIM_RULE}${BOLD}${DEFAULT_FOREGROUND}${INTENSITY_END}`,
		)
	})

	it('keeps existing dim on the heading after its rules', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(run_board_theme.restyle(undefined, styleText('dim', SHORT_RULE))).toBe(
			`${DIM}${DIM_RULE}${DIM} LANES ${DIM_RULE}${DIM}${INTENSITY_END}`,
		)
	})
})

// joshuafolkken/kit#8591: a heading's link keeps its escapes whole — the dimmed dashes and the drawn
// glyphs reach the heading's text only, never the `-` inside a link's id or URL.
const LINK_URL = 'https://github.com/joshuafolkken/kit/issues?q=is%3Aissue+is%3Aopen'
const LINK_OPEN = `${ESCAPE}]8;id=josh-run-board;${LINK_URL}\u{7}`
const LINK_CLOSE = `${ESCAPE}]8;;\u{7}`
const DCS = `${ESCAPE}P`
const DOUBLED_ESCAPE = ESCAPE.repeat(2)
const TMUX_LINK_OPEN = `${DCS}tmux;${DOUBLED_ESCAPE}]8;id=josh-run-board;${LINK_URL}\u{7}${ESCAPE}\\`

describe('run_board_theme.restyle a heading carrying a link', () => {
	it.each([
		['wargames', LINK_OPEN],
		['matrix', LINK_OPEN],
		['wargames', TMUX_LINK_OPEN],
		['matrix', TMUX_LINK_OPEN],
	] as const)('keeps the %s heading link escape %j whole', (theme, open) => {
		vi.stubEnv('FORCE_COLOR', '3')
		const drawn = run_board_theme.restyle(theme, `── LANES ── IS ${open}51${LINK_CLOSE} ──`)

		expect(drawn.split(open)).toHaveLength(2)
		expect(drawn).toContain(`${open}51${LINK_CLOSE}`)
	})
})

describe('run_board_theme default output boundaries', () => {
	it('leaves body rows, gauges, empty lines and the standalone spinner unchanged', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const frame = `${BODY}\n${styleText('dim', '────')}\n─\n\n📈 throughput ──`

		expect(run_board_theme.restyle(undefined, frame)).toBe(frame)
	})

	it.each(['0', '1', '3'])('keeps the plain frame and its columns at color depth %s', (force) => {
		vi.stubEnv('FORCE_COLOR', force)
		const frame = `${SHORT_RULE}\n▸ 📈 throughput ── CPU ──\n${BODY}`

		expect(stripVTControlCharacters(run_board_theme.restyle(undefined, frame))).toBe(frame)
	})

	it('adds no escapes with FORCE_COLOR disabled', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(run_board_theme.restyle(undefined, SHORT_RULE)).toBe(SHORT_RULE)
	})

	it('adds no escapes with NO_COLOR and no FORCE_COLOR', () => {
		vi.stubEnv('FORCE_COLOR', undefined)
		vi.stubEnv('NO_COLOR', '1')

		expect(run_board_theme.restyle(undefined, SHORT_RULE)).toBe(SHORT_RULE)
	})

	it('styles ordinary writes and lets already drawn default frames through unchanged', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const frames: Array<string> = []
		const original: Pick<BoardPorts, 'write' | 'write_drawn'> = {
			write: (frame: string) => {
				frames.push(frame)
			},
		}
		const ports = run_board_theme.themed(original, undefined)

		ports.write(SHORT_RULE)
		ports.write_drawn?.(DIM_HEADING)
		expect(frames).toStrictEqual([DIM_HEADING, DIM_HEADING])
	})
})
