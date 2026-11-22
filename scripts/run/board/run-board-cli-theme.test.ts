import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fit } from './run-board-fit'
import { run_board_fixture } from './run-board-fixture'
import { run_board_header_names } from './run-board-header-names'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_typing } from './run-board-typing'

const INTRO_LINE = run_board_theme_defs.THEME_DEFS.wargames.intro.line

// joshuafolkken/kit#7934: a board a person watches takes the theme; the chat's frame never does. How
// the theme draws a frame is `run-board-theme.test.ts`'s.

const { IDLE_ROW, LOCAL, START, STOPPED, harness, plan_titled } = run_board_fixture
const LAUNCH = { pos: 1, at: '2026-10-08T08:00:00.000Z', kind: 'child-launch', text: '#1 a' }
const THEMED = ['--theme', 'wargames']
const RULE = '─'
const NAMED_CYAN = '\u{1B}[36m'
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u
const BRAILLE = /[\u{2800}-\u{28FF}]/u

function widths_of(frame: string): Array<number> {
	return frame.split('\n').map((line) => run_board_fit.width_of(line))
}

// joshuafolkken/kit#8604: the plain frame's widths as wargames draws them — the header's name column,
// its three lines, narrowed by how much shorter `josh-wopr` is than `josh-board`.
const NAME_LINES = 3
const NAME_SHIFT =
	run_board_header_names.BOARD_NAME.length - run_board_theme_defs.THEME_DEFS.wargames.name.length

function wargames_widths(plain: Array<number>): Array<number> {
	return plain.map((width, at) => (at < NAME_LINES ? width - NAME_SHIFT : width))
}

async function frame_of(argv: Array<string>): Promise<string> {
	const { ports, frames } = harness({ ...LOCAL, events: [LAUNCH] }, [plan_titled('a')])

	await expect(run_board_cli.run(argv, ports)).resolves.toBe(0)

	return frames.join('')
}

async function no_pause(): Promise<void> {
	await Promise.resolve()
}

// joshuafolkken/kit#8027: a shell that names a theme must not draw the frames these tests take as plain.
beforeEach(() => {
	vi.stubEnv('JOSH_BOARD_THEME', undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_cli.run --theme', () => {
	it('draws --once with dashed rules and no rule character', async () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const plain = await frame_of(['--once'])
		const frame = await frame_of([...THEMED, '--once'])

		expect(plain).toContain(RULE)
		expect(frame).not.toContain(RULE)
		expect(widths_of(frame)).toStrictEqual(wargames_widths(widths_of(plain)))
	})
})

// joshuafolkken/kit#7988: the theme's --once frame is text a text terminal draws.
describe('run_board_cli.run --theme as text', () => {
	it('draws --once with no emoji, spinner dots or lowercase letter', async () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const plain = await frame_of(['--once'])
		const frame = await frame_of([...THEMED, '--once'])

		expect(plain).toMatch(PICTOGRAPHIC)
		expect(frame).not.toMatch(PICTOGRAPHIC)
		expect(frame).not.toMatch(BRAILLE)
		expect(frame).not.toMatch(/[a-z]/u)
	})

	it('draws the theme JOSH_BOARD_THEME names, and --theme over it', async () => {
		vi.stubEnv('JOSH_BOARD_THEME', 'wargames')

		expect(await frame_of(['--once'])).not.toContain(RULE)

		vi.stubEnv('JOSH_BOARD_THEME', 'nope')

		expect(await frame_of([...THEMED, '--once'])).not.toContain(RULE)
	})

	it('writes the same --chat frame with the theme as without', async () => {
		const plain = await frame_of(['--chat'])

		expect(await frame_of([...THEMED, '--chat'])).toBe(plain)
	})

	it('types the intro line in cyan on a live board', async () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const { ports, frames } = harness(undefined, [])

		await expect(run_board_cli.run(THEMED, { ...ports, intro_sleep: no_pause })).rejects.toBe(
			STOPPED,
		)
		expect(frames[1]?.startsWith(NAMED_CYAN)).toBe(true)
		expect(frames.join('')).toContain(INTRO_LINE.at(0))
	})
})

// joshuafolkken/kit#8006: a live board in the theme reveals its first frame a line at a time before any
// redraw sleeps; one in no theme draws it whole.
const SLEPT = '<sleep>'

async function live_writes(argv: Array<string>): Promise<Array<string>> {
	const { ports, frames } = harness(undefined, [])

	async function sleep(ms: number): Promise<void> {
		frames.push(SLEPT)
		await ports.sleep(ms)
	}

	await expect(run_board_cli.run(argv, { ...ports, sleep, intro_sleep: no_pause })).rejects.toBe(
		STOPPED,
	)

	return frames
}

function line_writes(frames: ReadonlyArray<string>): Array<number> {
	return [...frames.keys()].filter((index) => frames[index]?.startsWith('\n') === true)
}

describe('run_board_cli.run --theme reveal', () => {
	it('writes the first frame a line at a time before the redraw sleeps', async () => {
		const frames = await live_writes(THEMED)
		const lines = line_writes(frames)

		expect(lines.length).toBeGreaterThan(1)
		expect(frames.indexOf(SLEPT)).toBeGreaterThan(lines.at(-1) ?? frames.length)
	})

	it('writes the first frame whole on a board in no theme', async () => {
		const frames = await live_writes([])

		expect(line_writes(frames)).toStrictEqual([])
		expect(frames).toContain(SLEPT)
	})
})

// joshuafolkken/kit#8029: the typed line is the theme's — a board in none types nothing and waits on no
// beat before its first frame; one JOSH_BOARD_THEME names types it as `--theme` does.
async function intro_run(argv: Array<string>): Promise<{ text: string; beats: number }> {
	const { ports, frames } = harness(undefined, [])
	let beats = 0

	async function intro_sleep(): Promise<void> {
		beats += 1
		await Promise.resolve()
	}

	await expect(run_board_cli.run(argv, { ...ports, intro_sleep })).rejects.toBe(STOPPED)

	return { text: frames.join(''), beats }
}

describe('run_board_cli.run --theme intro', () => {
	it('types no line and waits on no beat on a board in no theme', async () => {
		const { text, beats } = await intro_run([])

		expect(text).not.toContain(INTRO_LINE)
		expect(text).not.toContain(run_board_typing.CURSOR)
		expect(beats).toBe(0)
	})

	it('types the line on a board JOSH_BOARD_THEME names', async () => {
		vi.stubEnv('JOSH_BOARD_THEME', 'wargames')
		const { text, beats } = await intro_run([])

		expect(text).toContain(run_board_typing.CURSOR)
		expect(beats).toBeGreaterThan(INTRO_LINE.length)
	})
})

// joshuafolkken/kit#8003: a live board in the theme types a row that appears after its first frame a
// letter at a time at the row's place; the key it finds the row by never reaches a frame.
const KEY_OPEN = '\u{E001}'
const PAST_LOCAL_READ_MS = 7000
// The tail of the move to a row's first column a typed row is written after.
const AT_ROW = ';1H'

// What a live board writes when `#1` is launched on its second local read, or on none.
async function launched_writes(argv: Array<string>, is_launched: boolean): Promise<Array<string>> {
	const board = harness(LOCAL, [plan_titled('a')])
	let reads = 0

	board.read_local.mockImplementation(async () => {
		reads += 1

		return { ...LOCAL, events: is_launched && reads > 1 ? [LAUNCH] : [] }
	})

	async function sleep(ms: number): Promise<void> {
		if (board.clock.now_ms >= START + PAST_LOCAL_READ_MS) throw STOPPED
		board.clock.now_ms += ms
	}

	await expect(
		run_board_cli.run(argv, { ...board.ports, sleep, intro_sleep: no_pause }),
	).rejects.toBe(STOPPED)

	return board.frames
}

function typed_writes(frames: ReadonlyArray<string>): Array<string> {
	return frames.filter((frame) => frame.includes(run_board_typing.CURSOR) && frame.includes(AT_ROW))
}

describe('run_board_cli.run --theme rows', () => {
	it('types a row that appears after the first frame, with the block at its place', async () => {
		const frames = await launched_writes(THEMED, true)

		expect(typed_writes(frames).length).toBeGreaterThan(0)
		expect(frames.join('')).not.toContain(KEY_OPEN)
	})

	it('types no row where none appears', async () => {
		expect(typed_writes(await launched_writes(THEMED, false))).toStrictEqual([])
	})

	it('types no row and writes no key on a board in no theme or drawn once', async () => {
		const frames = await launched_writes([], true)

		expect(typed_writes(frames)).toStrictEqual([])
		expect(frames.join('')).not.toContain(KEY_OPEN)
		expect(await frame_of([...THEMED, '--once'])).not.toContain(KEY_OPEN)
	})
})

describe('run_board_cli.run --theme refused', () => {
	it('names the theme in the usage', () => {
		expect(run_board_cli.USAGE).toContain('[--theme wargames|matrix]')
	})

	it('draws --chat and pushes --every whatever JOSH_BOARD_THEME holds', async () => {
		vi.stubEnv('JOSH_BOARD_THEME', 'nope')
		const plain = await frame_of(['--chat'])
		const { ports } = harness(LOCAL, [])
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		expect(plain).toContain('a')
		await expect(run_board_cli.run(['--every', 'x'], ports)).resolves.toBe(1)
		expect(stderr).toHaveBeenCalledWith(`${run_board_cli.USAGE}\n`)
		stderr.mockRestore()
	})

	it('names JOSH_BOARD_THEME when it, not --theme, names no theme', async () => {
		vi.stubEnv('JOSH_BOARD_THEME', 'nope')
		const { ports } = harness(LOCAL, [])
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		await expect(run_board_cli.run(['--once'], ports)).resolves.toBe(1)
		expect(stderr).toHaveBeenCalledWith(
			`JOSH_BOARD_THEME=nope names no theme (wargames, matrix)\n${run_board_cli.USAGE}\n`,
		)
		stderr.mockRestore()
	})

	it('refuses a name no theme has with the usage', async () => {
		const { ports, frames } = harness(LOCAL, [])
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		await expect(run_board_cli.run(['--theme', 'nope', '--once'], ports)).resolves.toBe(1)
		expect(stderr).toHaveBeenCalledWith(`${run_board_cli.USAGE}\n`)
		expect(frames).toHaveLength(0)
		stderr.mockRestore()
	})
})

// joshuafolkken/kit#8505: the icons a board draws, refused as the theme is.
describe('run_board_cli.run --icons', () => {
	it('names the icons in the usage', () => {
		expect(run_board_cli.USAGE).toContain('[--icons emoji|letters|shapes]')
	})

	it('draws a board in no theme in letters where --icons asks', async () => {
		const pictographic = /\p{Extended_Pictographic}/u

		expect(await frame_of(['--once'])).toMatch(pictographic)
		expect(await frame_of(['--once', '--icons', 'letters'])).not.toMatch(pictographic)
	})

	it('names JOSH_BOARD_ICONS when it, not --icons, names no icons', async () => {
		vi.stubEnv('JOSH_BOARD_ICONS', 'nope')
		const { ports } = harness(LOCAL, [])
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		await expect(run_board_cli.run(['--once'], ports)).resolves.toBe(1)
		expect(stderr).toHaveBeenCalledWith(
			`JOSH_BOARD_ICONS=nope names no icons (emoji, letters, shapes)\n${run_board_cli.USAGE}\n`,
		)
		stderr.mockRestore()
	})

	it('draws --chat whatever JOSH_BOARD_ICONS holds', async () => {
		vi.stubEnv('JOSH_BOARD_ICONS', 'nope')

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

// The frame's first line, and the first line holding `alert`.
async function alert_line(argv: Array<string>, alert: string): Promise<Array<string | undefined>> {
	const frame = await throughput_frame(argv)
	const lines = frame.split('\n')

	// Past the header's first line, which names the matrix board `JOSH-TRACE` (joshuafolkken/kit#8604).
	return [lines[0], lines.slice(1).find((line) => line.includes(alert))]
}

async function rule_of(argv: Array<string>, alert: string): Promise<string | undefined> {
	const [, rule] = await alert_line(argv, alert)

	return rule
}

// joshuafolkken/kit#7989, #8107, #8513: the themed throughput rule ends on the alert level, the header's
// first line no longer; no other frame has it.
describe('run_board_cli.run --theme alert level', () => {
	it('ends the --once throughput rule on DEFCON in the theme alone', async () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const [first, rule] = await alert_line([...THEMED, '--once'], 'DEFCON')

		expect(first).not.toContain('DEFCON')
		expect(rule).toMatch(/THROUGHPUT.* DEFCON(?: \d){0,4} \[\d\](?: \d){0,4}$/u)
		expect(await rule_of(['--once'], 'DEFCON')).toBeUndefined()
		expect(await rule_of([...THEMED, '--chat'], 'DEFCON')).toBeUndefined()
	})

	// The header gives up the alert and nothing else moves: every line but the throughput rule keeps its
	// width. The rule keeps its own where its rule run holds the alert (`tailed`), which this narrow
	// frame's does not.
	it('keeps every line of the themed frame but the throughput rule as wide as the plain one', async () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const plain = wargames_widths(widths_of(await throughput_frame(['--once'])))
		const themed = await throughput_frame([...THEMED, '--once'])
		const index = themed.split('\n').findIndex((line) => line.includes('DEFCON'))
		const kept = widths_of(themed).map((width, at) => (at === index ? plain[at] : width))

		expect(index).toBeGreaterThan(0)
		expect(kept).toStrictEqual(plain)
	})

	// joshuafolkken/kit#8354: `matrix` ends it on TRACE, from --theme or JOSH_BOARD_THEME, --theme winning.
	it('ends the matrix throughput rule on TRACE, never in --chat', async () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const [first, rule] = await alert_line(['--theme', 'matrix', '--once'], 'TRACE')

		// The header names the board `JOSH-TRACE` (joshuafolkken/kit#8604) but draws no gauge.
		expect(first).not.toMatch(/TRACE [■-]{5}/u)
		expect(rule).toMatch(/THROUGHPUT.* TRACE [■-]{5}$/u)
		vi.stubEnv('JOSH_BOARD_THEME', 'matrix')
		expect(await rule_of(['--once'], 'TRACE')).toBeDefined()
		expect(await rule_of([...THEMED, '--once'], 'DEFCON')).toBeDefined()
		expect(await rule_of(['--chat'], 'TRACE')).toBeUndefined()
	})
})
