import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { stdin_text, type StdinSource } from './stdin-text'

const BODY = 'a body piped in\nwith a second line\n'
const CLI_BODY_MODULE = fileURLToPath(new URL('../josh/cli-body.ts', import.meta.url))
// The writer sleeps before its first byte, so the reader meets an empty non-blocking pipe.
const WRITER_DELAY_SECONDS = '0.5'
const CHILD_TIMEOUT_MS = 20_000

function try_again_error(): Error {
	return Object.assign(new Error('EAGAIN: resource temporarily unavailable, read'), {
		code: 'EAGAIN',
	})
}

// Answers each read from `steps` in turn: an error is thrown, text is copied into the buffer.
function scripted_source(steps: ReadonlyArray<Error | string>): StdinSource & { waits: number } {
	const queue = [...steps]
	const source = {
		waits: 0,
		read(buffer: Uint8Array): number {
			const step = queue.shift() ?? ''

			if (step instanceof Error) throw step

			return Buffer.from(step).copy(buffer)
		},
		wait(): void {
			source.waits += 1
		},
	}

	return source
}

// `process.stdin` is touched first because that is what turns the shared pipe non-blocking in a
// `pnpm josh` process; then the body is read the way every `*-file -` flag reads it.
function child_script(): string {
	return [
		'process.stdin.pause()',
		`const { cli_body } = await import(${JSON.stringify(CLI_BODY_MODULE)})`,
		"process.stdout.write(cli_body.read_file_or_stdin('-'))",
		'process.exit(0)',
	].join('\n')
}

function read_through_delayed_pipe(): ReturnType<typeof spawnSync> {
	return spawnSync(
		'sh',
		[
			'-c',
			'(sleep "$DELAY"; printf %s "$BODY") | "$NODE_BIN" --import tsx --input-type=module -e "$SCRIPT"',
		],
		{
			encoding: 'utf8',
			timeout: CHILD_TIMEOUT_MS,
			env: {
				...process.env,
				BODY,
				DELAY: WRITER_DELAY_SECONDS,
				NODE_BIN: process.execPath,
				SCRIPT: child_script(),
			},
		},
	)
}

describe('stdin_text.read_all — a descriptor with nothing to give yet', () => {
	it('waits and reads again on EAGAIN until the input ends', () => {
		const source = scripted_source([
			try_again_error(),
			'a body ',
			try_again_error(),
			'piped in',
			'',
		])

		expect(stdin_text.read_all(source)).toBe('a body piped in')
		expect(source.waits).toBe(2)
	})

	it('rethrows any other read failure', () => {
		const source = scripted_source([new Error('EBADF: bad file descriptor, read')])

		expect(() => stdin_text.read_all(source)).toThrow('EBADF')
	})

	it('reads nothing as the empty string', () => {
		expect(stdin_text.read_all(scripted_source([]))).toBe('')
	})
})

describe('stdin_text.read_all — a real pipe whose writer is late', () => {
	it('carries the whole body through `-` instead of failing with EAGAIN', () => {
		const result = read_through_delayed_pipe()

		expect(result.stderr).toBe('')
		expect(result.stdout).toBe(BODY)
	})
})
