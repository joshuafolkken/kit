import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fit } from './run-board-fit'
import { run_board_fixture } from './run-board-fixture'

// joshuafolkken/kit#7934: a board a person watches takes the theme; the chat's frame never does. How
// the theme draws a frame is `run-board-theme.test.ts`'s. joshuafolkken/kit#8917: a single frame in a
// theme draws the base look every theme draws over; the theme's own drawing is the live board's.

const { IDLE_ROW, LOCAL, harness, plan_titled } = run_board_fixture
const LAUNCH = { pos: 1, at: '2026-10-08T08:00:00.000Z', kind: 'child-launch', text: '#1 a' }
const THEMED = ['--theme', 'wopr']
const RULE = '─'
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u
const BRAILLE = /[\u{2800}-\u{28FF}]/u
const KEY_OPEN = '\u{E001}'
const NOPE = 'nope'
const TRACE_FIELD = /throughput.* TRACE [■-]{5}$/u

function widths_of(frame: string): Array<number> {
	return frame.split('\n').map((line) => run_board_fit.width_of(line))
}

async function frame_of(argv: Array<string>): Promise<string> {
	const { ports, frames } = harness({ ...LOCAL, events: [LAUNCH] }, [plan_titled('a')])

	await expect(run_board_cli.run(argv, ports)).resolves.toBe(0)

	return frames.join('')
}

// joshuafolkken/kit#8027: a shell that names a theme must not draw the frames these tests take as plain.
beforeEach(() => {
	vi.stubEnv('JOSH_BOARD_THEME', undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_cli.run --theme', () => {
	// joshuafolkken/kit#8917: the names column holds at least 15 columns, so `josh-wopr`, shorter than
	// `josh-board`, leaves every line as wide as the plain frame's (joshuafolkken/kit#8604 narrowed it).
	it('draws --once with dashed rules and no rule character, each line as wide as the plain one', async () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const plain = await frame_of(['--once'])
		const frame = await frame_of([...THEMED, '--once'])

		expect(plain).toContain(RULE)
		expect(frame).not.toContain(RULE)
		expect(widths_of(frame)).toStrictEqual(widths_of(plain))
	})

	it('draws --once with no emoji, spinner dots or row key', async () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const plain = await frame_of(['--once'])
		const frame = await frame_of([...THEMED, '--once'])

		expect(plain).toMatch(PICTOGRAPHIC)
		expect(frame).not.toMatch(PICTOGRAPHIC)
		expect(frame).not.toMatch(BRAILLE)
		expect(frame).not.toContain(KEY_OPEN)
	})

	it('draws the theme JOSH_BOARD_THEME names, an alias too, and --theme over it', async () => {
		vi.stubEnv('JOSH_BOARD_THEME', 'wopr')

		expect(await frame_of(['--once'])).not.toContain(RULE)

		vi.stubEnv('JOSH_BOARD_THEME', 'wargames')

		expect(await frame_of(['--once'])).not.toContain(RULE)

		vi.stubEnv('JOSH_BOARD_THEME', NOPE)

		expect(await frame_of([...THEMED, '--once'])).not.toContain(RULE)
	})

	it('writes the same --chat frame with the theme as without', async () => {
		const plain = await frame_of(['--chat'])

		expect(await frame_of([...THEMED, '--chat'])).toBe(plain)
	})
})

// Runs `argv` with stderr held, and what it wrote there.
async function refused(argv: Array<string>): Promise<{ code: number; stderr: string }> {
	const { ports } = harness(LOCAL, [])
	const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
	const code = await run_board_cli.run(argv, ports)
	const written = stderr.mock.calls.map(([text]) => String(text)).join('')

	stderr.mockRestore()

	return { code, stderr: written }
}

describe('run_board_cli.run --theme refused', () => {
	it('names the theme values in the usage', () => {
		expect(run_board_cli.USAGE).toContain(
			'[--theme wopr|trace|flux|codec|nixie|skynet|magi|deviant|isac|ghost]',
		)
	})

	it('draws --chat and pushes --every whatever JOSH_BOARD_THEME holds', async () => {
		vi.stubEnv('JOSH_BOARD_THEME', NOPE)

		expect(await frame_of(['--chat'])).toContain('a')
		expect(await refused(['--every', 'x'])).toStrictEqual({
			code: 1,
			stderr: `${run_board_cli.USAGE}\n`,
		})
	})

	it('names JOSH_BOARD_THEME when it, not --theme, names no theme', async () => {
		vi.stubEnv('JOSH_BOARD_THEME', NOPE)

		expect(await refused(['--once'])).toStrictEqual({
			code: 1,
			stderr: `JOSH_BOARD_THEME=nope names no theme (wopr, trace, flux, codec, nixie, skynet, magi, deviant, isac, ghost)\n${run_board_cli.USAGE}\n`,
		})
	})

	it('refuses a name no theme has with the usage', async () => {
		expect(await refused(['--theme', NOPE, '--once'])).toStrictEqual({
			code: 1,
			stderr: `${run_board_cli.USAGE}\n`,
		})
	})
})

// joshuafolkken/kit#8505: the icons a board draws, refused as the theme is.
describe('run_board_cli.run --icons', () => {
	it('names the icons in the usage', () => {
		expect(run_board_cli.USAGE).toContain('[--icons emoji|letters|shapes]')
	})

	it('draws a board in no theme in letters where --icons asks', async () => {
		expect(await frame_of(['--once'])).toMatch(PICTOGRAPHIC)
		expect(await frame_of(['--once', '--icons', 'letters'])).not.toMatch(PICTOGRAPHIC)
	})

	it('names JOSH_BOARD_ICONS when it, not --icons, names no icons', async () => {
		vi.stubEnv('JOSH_BOARD_ICONS', NOPE)

		expect(await refused(['--once'])).toStrictEqual({
			code: 1,
			stderr: `JOSH_BOARD_ICONS=nope names no icons (emoji, letters, shapes)\n${run_board_cli.USAGE}\n`,
		})
	})

	it('draws --chat whatever JOSH_BOARD_ICONS holds', async () => {
		vi.stubEnv('JOSH_BOARD_ICONS', NOPE)

		expect(await frame_of(['--chat'])).toContain('a')
	})
})

// The frame of a read carrying the throughput rows.
async function throughput_frame(argv: Array<string>): Promise<string> {
	const local = { ...LOCAL, events: [LAUNCH], throughput: [IDLE_ROW] }
	const { ports, frames } = harness(local, [plan_titled('a')])

	await expect(run_board_cli.run(argv, ports)).resolves.toBe(0)

	return frames.join('')
}

// The frame's first line, and the first line after it holding `alert`.
async function alert_line(argv: Array<string>, alert: string): Promise<Array<string | undefined>> {
	const frame = await throughput_frame(argv)
	const lines = frame.split('\n')

	return [lines[0], lines.slice(1).find((line) => line.includes(alert))]
}

// joshuafolkken/kit#7989, #8107, #8513: the themed throughput rule ends on the alert field — the base
// look's `TRACE` in every theme (joshuafolkken/kit#8917) — the header's first line no longer; no other
// frame has it.
describe('run_board_cli.run --theme alert level', () => {
	it.each(['wopr', 'trace', 'magi'])(
		'ends the --once %s throughput rule on TRACE',
		async (theme) => {
			vi.stubEnv('FORCE_COLOR', '0')
			const [first, rule] = await alert_line(['--theme', theme, '--once'], 'TRACE')

			expect(first).not.toMatch(/TRACE [■-]{5}/u)
			expect(rule).toMatch(TRACE_FIELD)
		},
	)

	it('draws no alert field without a theme or in --chat', async () => {
		vi.stubEnv('FORCE_COLOR', '0')

		const [, plain] = await alert_line(['--once'], 'TRACE')
		const [, chat] = await alert_line([...THEMED, '--chat'], 'TRACE')

		expect(plain).toBeUndefined()
		expect(chat).toBeUndefined()
	})

	// The header gives up the alert and nothing else moves: every line but the throughput rule keeps its
	// width.
	it('keeps every line of the themed frame but the throughput rule as wide as the plain one', async () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const plain = widths_of(await throughput_frame(['--once']))
		const themed = await throughput_frame([...THEMED, '--once'])
		const index = themed.split('\n').findIndex((line) => TRACE_FIELD.test(line))
		const kept = widths_of(themed).map((width, at) => (at === index ? plain[at] : width))

		expect(index).toBeGreaterThan(0)
		expect(kept).toStrictEqual(plain)
	})
})
