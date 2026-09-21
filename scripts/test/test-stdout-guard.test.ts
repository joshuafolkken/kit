import { expect, test } from 'vitest'
import { test_stdout_guard } from './test-stdout-guard'

// joshuafolkken/kit#2296: the guard silences the real streams for the body of every test so a
// fixture's `process.stdout.write` cannot reach `pnpm josh test:unit`'s output. Exercised through its
// own functions rather than the ambient hook, which is already active on this very test.

test('swallows a direct stdout write while silenced', () => {
	const sink: Array<string> = []
	const original = process.stdout.write

	process.stdout.write = (chunk: string | Uint8Array): true => {
		sink.push(String(chunk))

		return true
	}

	const saved = test_stdout_guard.silence_streams()
	const did_write = process.stdout.write('leaked\n')

	test_stdout_guard.restore_streams(saved)
	process.stdout.write = original

	expect(did_write).toBe(true)
	expect(sink).toEqual([])
})

test('restores exactly the write functions it replaced', () => {
	const before_out = process.stdout.write
	const before_error = process.stderr.write

	const saved = test_stdout_guard.silence_streams()

	test_stdout_guard.restore_streams(saved)

	expect(process.stdout.write).toBe(before_out)
	expect(process.stderr.write).toBe(before_error)
})
