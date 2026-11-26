import { Console } from 'node:console'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_output_hold } from './run-board-output-hold'

// joshuafolkken/kit#9008: what the process writes to stdout and stderr while the screen is up is held
// and said on stderr once it is left, whichever way it was written.

afterEach(() => {
	vi.restoreAllMocks()
})

// What the terminal's stderr and stdout were given: while the writer ran under a hold, and after it.
function held_run(write: () => void): { during: Array<string>; after: Array<string> } {
	const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	const error = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

	function given(): Array<string> {
		return [...out.mock.calls, ...error.mock.calls].map(([chunk]) => String(chunk))
	}

	const release = run_board_output_hold.hold()

	try {
		write()
		const during = given()

		release()

		return { during, after: given() }
	} finally {
		release()
	}
}

// The process's own console writes through its streams; vitest swaps the global one for its own.
const process_console = new Console(process.stdout, process.stderr)

const KINDS: Array<[string, () => void]> = [
	['console.error', () => process_console.error('from console.error')],
	['console.info', () => process_console.info('from console.info')],
	['console.warn', () => process_console.warn('from console.warn')],
	['process.stderr.write', () => process.stderr.write('from stderr.write')],
	['process.stdout.write', () => process.stdout.write('from stdout.write')],
]

describe('run_board_output_hold', () => {
	it.each(KINDS)('holds %s while the screen is up and says it after', (_kind, write) => {
		const { during, after } = held_run(write)

		expect(during).toStrictEqual([])
		expect(after.join('')).toContain('from ')
	})

	it('says bytes as the text they hold', () => {
		const { after } = held_run(() => process.stdout.write(new TextEncoder().encode('bytes')))

		expect(after).toStrictEqual(['bytes'])
	})

	it('says a character split across two writes whole', () => {
		const [first = 0, second = 0, ...rest] = new TextEncoder().encode('あ')
		const { after } = held_run(() => {
			process.stderr.write(new Uint8Array([first]))
			process.stderr.write(new Uint8Array([second, ...rest]))
		})

		expect(after.join('')).toBe('あ')
	})

	it('tells the callback of a held write that it is done', () => {
		const done = vi.fn()

		held_run(() => process.stderr.write('held', done))

		expect(done).toHaveBeenCalledTimes(1)
	})

	it('puts the streams back as they were once released', () => {
		const { write: out } = process.stdout
		const { write: error } = process.stderr

		run_board_output_hold.hold()()

		expect([process.stdout.write, process.stderr.write]).toStrictEqual([out, error])
	})
})
