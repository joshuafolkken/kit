import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import type { KeyInput } from './run-board-keys'

// joshuafolkken/kit#4172: the live board reads its keys in raw mode, names them on its footer, and
// leaves raw mode with the alternate screen; a frame nobody types into reads no key and is unchanged.

const { STOPPED, harness } = run_board_fixture
const ESCAPE = '\u{1B}'
const LEAVE = `${ESCAPE}[?25h${ESCAPE}[?1049l`
const KEYS_LINE = ' l p f q w d: fold · a: all · Ctrl-C: quit'

function keyboard(calls: Array<string>): KeyInput {
	return {
		is_tty: true,
		raw: (is_raw) => {
			calls.push(`raw ${String(is_raw)}`)
		},
		listen: () => {
			calls.push('listen')
		},
		close: () => {
			calls.push('close')
		},
		interrupt: () => {
			calls.push('interrupt')
		},
	}
}

describe('run_board_cli.run keys', () => {
	it('reads keys in raw mode, names them under the footer and leaves raw mode as it leaves', async () => {
		const calls: Array<string> = []
		const { ports, frames, leaves } = harness(undefined, [])

		await expect(run_board_cli.run([], { ...ports, keys: keyboard(calls) })).rejects.toBe(STOPPED)
		expect(stripVTControlCharacters(frames[1] ?? '').endsWith(KEYS_LINE)).toBe(true)
		expect(calls).toStrictEqual(['raw true', 'listen', 'raw false', 'close'])
		expect(frames.at(-1)).toBe(LEAVE)
		leaves[0]?.()
		expect(calls.filter((call) => call === 'raw false')).toHaveLength(1)
	})

	it('reads no key and names none for --once or a live board with no keyboard', async () => {
		const calls: Array<string> = []
		const once = harness(undefined, [])
		const live = harness(undefined, [])

		await run_board_cli.run(['--once'], { ...once.ports, keys: keyboard(calls) })
		await expect(run_board_cli.run([], live.ports)).rejects.toBe(STOPPED)
		expect(calls).toStrictEqual([])
		expect([...once.frames, ...live.frames].join('')).not.toContain(KEYS_LINE)
	})
})
