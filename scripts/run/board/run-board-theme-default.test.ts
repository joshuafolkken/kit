import { stripVTControlCharacters, styleText } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_label_pair } from './run-board-label-pair'
import type { BoardPorts } from './run-board-state'
import { run_board_theme } from './run-board-theme'

// joshuafolkken/kit#8397 and joshuafolkken/kit#8505: the board in no theme — what a terminal without
// 24-bit color, and a theme run showing none, draws (joshuafolkken/kit#8917). Only a heading's `─` rules
// take the dim; body rows, gauges and the spinner are left as written, and no theme color is added.

const ESCAPE = '\u{1B}'
const DEFAULT_FOREGROUND = `${ESCAPE}[39m`
const SHORT_RULE = '── LANES ──'
const DIM_RULE = `${ESCAPE}[2m──${ESCAPE}[22m`
const DIM_HEADING = `${DIM_RULE} LANES ${DIM_RULE}`
const BOLD = `${ESCAPE}[1m`
const DIM = `${ESCAPE}[2m`
const INTENSITY_END = `${ESCAPE}[22m`
const BODY = '  ■■■──── 3/7 ── 2 CPU'
const LINK_URL = 'https://github.com/joshuafolkken/kit/issues?q=is%3Aissue+is%3Aopen'
const LINK_OPEN = `${ESCAPE}]8;id=josh-run-board;${LINK_URL}\u{7}`
const LINK_CLOSE = `${ESCAPE}]8;;\u{7}`

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_theme no-theme section rules', () => {
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

		expect(run_board_theme.marked(undefined, frame)).toBe(
			run_board_label_pair.titled(`▾ ${label} ${DIM_RULE}`),
		)
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

// joshuafolkken/kit#8591: the dimmed dashes reach the heading's text only, never a link's URL.
describe('run_board_theme no-theme heading link', () => {
	it('keeps a heading link escape whole', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const drawn = run_board_theme.restyle(
			undefined,
			`── LANES ── IS ${LINK_OPEN}51${LINK_CLOSE} ──`,
		)

		expect(drawn.split(LINK_OPEN)).toHaveLength(2)
		expect(drawn).toContain(`${LINK_OPEN}51${LINK_CLOSE}`)
	})
})

describe('run_board_theme no-theme icons', () => {
	it('draws an icon as letters of its width, in no theme color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(run_board_theme.restyle(undefined, '🚨 a', 'letters')).toBe('P1 a')
	})

	it('keeps emoji where the icons are emoji', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(run_board_theme.restyle(undefined, '🚨 a', 'emoji')).toBe('🚨 a')
	})
})

describe('run_board_theme no-theme output boundaries', () => {
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

	it('adds no escapes with NO_COLOR and no FORCE_COLOR', () => {
		vi.stubEnv('FORCE_COLOR', undefined)
		vi.stubEnv('NO_COLOR', '1')

		expect(run_board_theme.restyle(undefined, SHORT_RULE)).toBe(SHORT_RULE)
	})

	it('styles ordinary writes and lets already drawn frames through unchanged', () => {
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

		expect(Reflect.get(ports, 'theme')).toBeUndefined()
		expect(frames).toStrictEqual([DIM_HEADING, DIM_HEADING])
	})
})
