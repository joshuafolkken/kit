import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import { run_board_intro } from './run-board-intro'

// joshuafolkken/kit#7934: a board a person watches takes the theme; the chat's frame never does. How
// the theme draws a frame is `run-board-theme.test.ts`'s.

const { LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const LAUNCH = { pos: 1, at: '2026-10-08T08:00:00.000Z', kind: 'child-launch', text: '#1 a' }
const THEMED = ['--theme', 'wargames']
const RULE = '─'
const NAMED_GREEN = '\u{1B}[32m'

async function frame_of(argv: Array<string>): Promise<string> {
	const { ports, frames } = harness({ ...LOCAL, events: [LAUNCH] }, [plan_titled('a')])

	await expect(run_board_cli.run(argv, ports)).resolves.toBe(0)

	return frames.join('')
}

async function no_pause(): Promise<void> {
	await Promise.resolve()
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_cli.run --theme', () => {
	it('draws --once with dashed rules and no rule character', async () => {
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

	it('types the intro line in green on a live board', async () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const { ports, frames } = harness(undefined, [])

		await expect(run_board_cli.run(THEMED, { ...ports, intro_sleep: no_pause })).rejects.toBe(
			STOPPED,
		)
		expect(frames[1]?.startsWith(NAMED_GREEN)).toBe(true)
		expect(frames.join('')).toContain(run_board_intro.LINE.at(0))
	})
})

describe('run_board_cli.run --theme refused', () => {
	it('refuses a name no theme has with the usage', async () => {
		const { ports, frames } = harness(LOCAL, [])
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		await expect(run_board_cli.run(['--theme', 'nope', '--once'], ports)).resolves.toBe(1)
		expect(stderr).toHaveBeenCalledWith(`${run_board_cli.USAGE}\n`)
		expect(frames).toHaveLength(0)
		stderr.mockRestore()
	})
})
