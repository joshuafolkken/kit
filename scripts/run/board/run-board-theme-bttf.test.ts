import { stripVTControlCharacters } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_colon } from './run-board-colon'
import { run_board_fixture } from './run-board-fixture'
import { run_board_icons } from './run-board-icons'
import { run_board_theme } from './run-board-theme'
import { run_board_theme_defs, type ThemeDefinition } from './run-board-theme-defs'

// joshuafolkken/kit#8673: the bttf theme — `josh-flux`, its opening line, a grey body over slate rules,
// and the header's clock rows in the time circuits' red, green and amber.

const { LOCAL, harness, plan_titled } = run_board_fixture
const BTTF: ThemeDefinition = run_board_theme_defs.THEME_DEFS.bttf
const ESC = '\u{1B}['
const BODY = `${ESC}38;2;190;198;206m`
const RULE = `${ESC}38;2;80;88;98m─`
const DIM_GREY = `${ESC}38;2;105;109;113m`
const CIRCUITS = ['255;70;50', '70;255;110', '255;190;40']
const HEADER_ROWS = 3
const LETTER_MS = 50
const RGB = /38;2;(\d+;\d+;\d+)m/gu

async function framed(flags: ReadonlyArray<string>): Promise<string> {
	const { ports, frames } = harness(LOCAL, [plan_titled('a')])

	await expect(run_board_cli.run(['--frame', '--ansi', ...flags], ports)).resolves.toBe(0)

	return frames.join('')
}

function colors_of(frame: string): Set<string> {
	return new Set([...frame.matchAll(RGB)].map((match) => match[1] ?? ''))
}

beforeEach(() => {
	vi.stubEnv('JOSH_BOARD_THEME', undefined)
	vi.stubEnv('JOSH_BOARD_ICONS', undefined)
	vi.stubEnv('FORCE_COLOR', '3')
	vi.stubEnv('NO_COLOR', undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_theme_defs bttf', () => {
	it('names the board josh-flux and types its line as written', () => {
		expect(BTTF.name).toBe('josh-flux')
		expect(BTTF.intro.line).toBe("Roads? Where we're going, we don't need roads.")
		expect(BTTF.intro.letter_ms).toBe(LETTER_MS)
		expect(BTTF.capitals).toBe(false)
	})

	it('draws text icons, no alert field and no typing sound', () => {
		expect(run_board_icons.default_of('bttf')).toBe('shapes')
		expect(BTTF.alert(1)).toBeUndefined()
		expect(BTTF.typing(LETTER_MS)).toBeUndefined()
		expect(BTTF.lamps).toBe(true)
	})

	// joshuafolkken/kit#8702: the flux figure keeps its six-row area, the usage rule whole.
	it('keeps the usage rule out of its lamp panel', () => {
		expect(BTTF.rule_lamped).toBe(false)
		expect(run_board_theme_defs.is_rule_lamped('bttf')).toBe(false)
		expect(run_board_theme_defs.is_rule_lamped(undefined)).toBe(false)
	})

	it('keeps the colon blinking every half second', () => {
		expect(run_board_colon.COLON_MS).toBe(500)
	})
})

describe('run_board_theme.choose bttf', () => {
	it('is chosen by --theme and by JOSH_BOARD_THEME', () => {
		expect(run_board_theme.choose(['--theme', 'bttf'], {})?.theme).toBe('bttf')
		expect(run_board_theme.choose([], { JOSH_BOARD_THEME: 'bttf' })?.theme).toBe('bttf')
	})
})

describe('run_board_cli.run --frame --theme bttf', () => {
	it('draws josh-flux in lower case over a grey body and slate rules', async () => {
		const frame = await framed(['--theme', 'bttf'])

		expect(stripVTControlCharacters(frame)).toContain('josh-flux')
		expect(frame).toContain(BODY)
		expect(frame).toContain(RULE)
	})

	it('draws each header row in its circuit', async () => {
		const frame = await framed(['--theme', 'bttf'])
		const lines = frame.split('\n').slice(0, HEADER_ROWS)

		expect(
			lines.map((line) => CIRCUITS.filter((circuit) => colors_of(line).has(circuit))),
		).toStrictEqual(CIRCUITS.map((circuit) => [circuit]))
	})

	it('draws the usage rule in the rule paint, not the dim paint', async () => {
		const frame = await framed(['--theme', 'bttf'])
		const [usage = ''] = frame.split('\n', 1)

		expect(usage).toContain(RULE)
		expect(usage).not.toContain(`${DIM_GREY}─`)
	})

	it('keeps every color the board without a theme draws', async () => {
		const plain = colors_of(await framed([]))
		const themed = colors_of(await framed(['--theme', 'bttf']))

		expect([...plain].filter((color) => !themed.has(color))).toStrictEqual([])
	})
})
