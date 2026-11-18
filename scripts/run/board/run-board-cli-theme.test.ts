import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import { run_board_intro } from './run-board-intro'
import { run_board_typing } from './run-board-typing'

// joshuafolkken/kit#7934: a board a person watches takes the theme; the chat's frame never does. How
// the theme draws a frame is `run-board-theme.test.ts`'s.

const { LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const LAUNCH = { pos: 1, at: '2026-10-08T08:00:00.000Z', kind: 'child-launch', text: '#1 a' }
const THEMED = ['--theme', 'wargames']
const RULE = '─'
const NAMED_CYAN = '\u{1B}[36m'

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
		expect(frame).toBe(plain.replaceAll(RULE, '-'))
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
		expect(frames.join('')).toContain(run_board_intro.LINE.at(0))
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

		expect(text).not.toContain(run_board_intro.LINE)
		expect(text).not.toContain(run_board_typing.CURSOR)
		expect(beats).toBe(0)
	})

	it('types the line on a board JOSH_BOARD_THEME names', async () => {
		vi.stubEnv('JOSH_BOARD_THEME', 'wargames')
		const { text, beats } = await intro_run([])

		expect(text).toContain(run_board_typing.CURSOR)
		expect(beats).toBeGreaterThan(run_board_intro.LINE.length)
	})
})

describe('run_board_cli.run --theme refused', () => {
	it('names the theme in the usage', () => {
		expect(run_board_cli.USAGE).toContain('[--theme wargames]')
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
			`JOSH_BOARD_THEME=nope names no theme (wargames)\n${run_board_cli.USAGE}\n`,
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
