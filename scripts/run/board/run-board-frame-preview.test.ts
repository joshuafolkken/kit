import { describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fit } from './run-board-fit'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_preview } from './run-board-frame-preview'

// joshuafolkken/kit#8434: `--frame` draws one live-form frame in a state its flags fix — the notice,
// its repeat mark, the sound switch, the theme and the size — and never touches the frame store.

const { LOCAL, harness, plan_titled } = run_board_fixture
const { options_of } = run_board_frame_preview
const ESCAPE = '\u{1B}['
const NARROW = 60
const NOTICE = ['--notice', 'running', '--issue', '8426']
const NOTICE_TEXT = /🔊 \S+ #8426 \d{2}:\d{2}/u

async function framed(flags: ReadonlyArray<string>): Promise<{ text: string; code: number }> {
	const { ports, frames } = harness(LOCAL, [plan_titled('a')])
	const code = await run_board_cli.run(['--frame', ...flags], ports)

	return { text: frames.join(''), code }
}

describe('run_board_frame_preview — the notice', () => {
	it('draws the notice with its issue, time and the sound-on mark', async () => {
		const { text, code } = await framed(NOTICE)

		expect(code).toBe(0)
		expect(text).toMatch(NOTICE_TEXT)
		expect(text).not.toContain('×2')
	})

	it('marks a repeat and a muted switch', async () => {
		const { text } = await framed([...NOTICE, '--repeat', '--mute'])

		expect(text).toMatch(/🔇 \S+ #8426 \d{2}:\d{2} ×2/u)
	})

	it('draws no notice when none is named', async () => {
		const { text } = await framed([])

		expect(text).not.toContain('#8426')
		expect(text).toContain('🔊 ')
	})
})

describe('run_board_frame_preview — the form', () => {
	it('keeps every line within a narrow width', async () => {
		const { text } = await framed([...NOTICE, '--columns', String(NARROW)])
		const widths = text.split('\n').map((line) => run_board_fit.width_of(line))

		expect(Math.max(...widths)).toBeLessThanOrEqual(NARROW)
	})

	it('writes plain text unless --ansi keeps the escapes', async () => {
		vi.stubEnv('FORCE_COLOR', '1')
		vi.stubEnv('NO_COLOR', undefined)
		const plain = await framed(NOTICE)
		const colored = await framed([...NOTICE, '--ansi'])

		expect(plain.text).not.toContain(ESCAPE)
		expect(colored.text).toContain(ESCAPE)
	})

	it('draws in the theme it is given', async () => {
		const plain = await framed(['--ansi'])
		const themed = await framed(['--ansi', '--theme', 'wargames'])

		expect(themed.text).not.toBe(plain.text)
	})

	it('runs the lamp panel a lamp theme runs on a live board', async () => {
		vi.stubEnv('FORCE_COLOR', '1')
		vi.stubEnv('NO_COLOR', undefined)
		const { text } = await framed(['--theme', 'wargames'])

		expect(text).toContain('■')
	})

	it('draws past the --once record, neither reading nor recording it', async () => {
		const { ports } = harness(LOCAL, [plan_titled('a')])
		const store = { load: vi.fn(), save: vi.fn() }

		await run_board_cli.run(['--frame', ...NOTICE], { ...ports, frames: store })

		expect(store.load).not.toHaveBeenCalled()
		expect(store.save).not.toHaveBeenCalled()
	})
})

describe('run_board_frame_preview.options_of', () => {
	it('reads the fixed state the flags name', () => {
		expect(options_of([...NOTICE, '--repeat', '--rows', '20', '--columns', '70'])).toStrictEqual({
			cause: { cue: 'launch', word: 'running', issue: 8426 },
			is_repeat: true,
			is_muted: false,
			size: { rows: 20, columns: 70 },
			is_ansi: false,
		})
	})

	it.each([
		['--columns', 'wide'],
		['--rows', '0'],
		['--issue', '-1'],
		['--notice', 'nowhere'],
		['--issue', '8426'],
		['--repeat'],
		['--unknown'],
	])('refuses %s %s', (...flags: Array<string>) => {
		expect(options_of(flags)).toBeUndefined()
	})

	it('answers usage and exit code 1 for a bad flag', async () => {
		const { ports } = harness(LOCAL, [plan_titled('a')])
		const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
		const code = await run_board_cli.run(['--frame', '--columns', 'wide'], ports)

		expect(code).toBe(1)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('--frame'))
		error.mockRestore()
	})
})
