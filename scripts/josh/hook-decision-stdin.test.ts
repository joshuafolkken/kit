import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hook_decision } from './hook-decision'

const COMMAND = 'pretool:guard'
const PAYLOAD = '{"tool_name":"Read"}'
const REASON = 'refused'

function stdin_of(is_tty: boolean, body: string): typeof process.stdin {
	return Object.assign(Readable.from([body]), {
		isTTY: is_tty,
		fd: 0,
	}) as unknown as typeof process.stdin
}

function capture(stream: NodeJS.WriteStream): Array<string> {
	const written: Array<string> = []

	vi.spyOn(stream, 'write').mockImplementation((chunk: string | Uint8Array) => {
		written.push(String(chunk))

		return true
	})

	return written
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('hook_decision.respond_from_stdin', () => {
	it('reports the hand-run notice on stderr when stdin is a terminal', async () => {
		vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin_of(true, ''))
		const errors = capture(process.stderr)
		const outcome = vi.fn()

		await hook_decision.respond_from_stdin(COMMAND, outcome)

		expect(errors.join('')).toContain(`${COMMAND} reads a Claude Code hook payload on stdin`)
		expect(outcome).not.toHaveBeenCalled()
	})

	it('judges the piped payload and writes its refusal envelope', async () => {
		vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin_of(false, PAYLOAD))
		const written = capture(process.stdout)
		const outcome = vi.fn(() => ({ reason: REASON, notice: undefined, fault: undefined }))

		await hook_decision.respond_from_stdin(COMMAND, outcome)

		expect(outcome).toHaveBeenCalledWith(PAYLOAD)
		expect(written.join('')).toBe(`${hook_decision.deny_envelope(REASON)}\n`)
	})
})
