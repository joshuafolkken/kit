import { readdirSync } from 'node:fs'
import { Readable } from 'node:stream'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hook_decision } from './hook-decision'
import { hook_payload_capture } from './hook-payload-capture'

const make_directory = temporary_directory()

const { load_environment_file } = vi.hoisted(() => ({ load_environment_file: vi.fn() }))

vi.mock('#scripts/josh/josh-environment-file', () => ({
	josh_environment_file: { load_environment_file },
}))

const COMMAND = 'pretool:guard'
const PAYLOAD = '{"tool_name":"Read"}'

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

// A capture directory in the shell running the suite would otherwise collect these synthetic payloads.
beforeEach(() => {
	vi.stubEnv(hook_payload_capture.CAPTURE_DIR_KEY, '')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
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

	it('hands the piped payload to the responder and awaits it', async () => {
		vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin_of(false, PAYLOAD))
		const written = capture(process.stdout)
		const respond = vi.fn(async (raw: string) => {
			await Promise.resolve()
			process.stdout.write(`${raw}\n`)
		})

		await hook_decision.respond_from_stdin(COMMAND, respond)

		expect(respond).toHaveBeenCalledWith(PAYLOAD)
		expect(written.join('')).toBe(`${PAYLOAD}\n`)
	})

	// The stop guard's session language and every guard switch are read off `.env`, and no responder
	// loads it itself any longer.
	it('loads the .env before the responder reads it', async () => {
		vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin_of(false, PAYLOAD))
		const order: Array<string> = []

		load_environment_file.mockImplementationOnce(() => {
			order.push('env')
		})

		await hook_decision.respond_from_stdin(COMMAND, () => {
			order.push('respond')
		})

		expect(order).toEqual(['env', 'respond'])
	})
})

describe('hook_decision.respond_from_stdin — payload capture', () => {
	it('captures the payload when JOSH_HOOK_CAPTURE_DIR names a directory', async () => {
		const directory = make_directory('hook-decision-stdin-')

		vi.stubEnv(hook_payload_capture.CAPTURE_DIR_KEY, directory)
		vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin_of(false, PAYLOAD))

		await hook_decision.respond_from_stdin(COMMAND, vi.fn())

		expect(readdirSync(directory)).toStrictEqual(['pretool-guard-Read-1.json'])
	})
})
