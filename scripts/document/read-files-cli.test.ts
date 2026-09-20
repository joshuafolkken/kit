import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { read_files_cli } from './read-files-cli'

// `read:files` folds several files into one call; these pin the two answers a fold needs — every
// present file printed under the cap, and a directive with no content over it — plus the two failures
// (a missing path, no path at all).

const SUCCESS = 0
const FAILURE = 1
const TINY_CAP = 40

function make_root(): string {
	return mkdtempSync(path.join(tmpdir(), 'read-files-'))
}

function write_file(root: string, name: string, text: string): void {
	writeFileSync(path.join(root, name), text, 'utf8')
}

function write_two(root: string, first: string, second: string): void {
	write_file(root, 'a.ts', first)
	write_file(root, 'b.ts', second)
}

function set_cap(root: string, chars: number): void {
	mkdirSync(path.join(root, '.claude'), { recursive: true })
	const settings = JSON.stringify({ env: { BASH_MAX_OUTPUT_LENGTH: chars } })

	write_file(root, path.join('.claude', 'settings.json'), settings)
}

function spy_on(method: 'info' | 'error'): MockInstance {
	return vi.spyOn(console, method).mockImplementation(() => undefined)
}

function joined(spy: MockInstance): string {
	return spy.mock.calls.map((call) => String(call[0])).join('\n')
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('read:files — the fold', () => {
	it('prints every named file in one call, each under its own header', () => {
		const root = make_root()
		const info = spy_on('info')

		write_two(root, 'AAA', 'BBB')

		const code = read_files_cli.run(['a.ts', 'b.ts'], root)

		expect(code).toBe(SUCCESS)
		expect(info).toHaveBeenCalledTimes(1)
		expect(joined(info)).toContain('a.ts')
		expect(joined(info)).toContain('AAA')
		expect(joined(info)).toContain('BBB')
	})

	it('emits a directive with no content when the batch is over the cap', () => {
		const root = make_root()
		const info = spy_on('info')

		set_cap(root, TINY_CAP)
		write_two(root, 'A'.repeat(TINY_CAP), 'B'.repeat(TINY_CAP))

		const code = read_files_cli.run(['a.ts', 'b.ts'], root)

		expect(code).toBe(SUCCESS)
		expect(joined(info)).toContain(read_files_cli.OVER_CAP_PREFIX)
		expect(joined(info)).toContain('a.ts')
		expect(joined(info)).not.toContain('AAAA')
	})
})

describe('read:files — the failures', () => {
	it('names a missing path and exits non-zero, still printing the present files', () => {
		const root = make_root()
		const info = spy_on('info')
		const error = spy_on('error')

		write_file(root, 'a.ts', 'AAA')

		const code = read_files_cli.run(['a.ts', 'gone.ts'], root)

		expect(code).toBe(FAILURE)
		expect(error).toHaveBeenCalledWith('Cannot read gone.ts')
		expect(joined(info)).toContain('AAA')
	})

	it('prints usage and exits non-zero when no path is given', () => {
		const root = make_root()
		const error = spy_on('error')

		const code = read_files_cli.run([], root)

		expect(code).toBe(FAILURE)
		expect(error).toHaveBeenCalledWith(read_files_cli.USAGE)
	})
})
