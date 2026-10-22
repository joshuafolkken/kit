import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PinnedReport } from './test-pinned-logic'
import { test_pinned_main } from './test-pinned-main'

const { run } = vi.hoisted(() => ({ run: vi.fn<(max_hunks: number) => Promise<PinnedReport>>() }))

vi.mock('./test-pinned', () => ({ test_pinned: { run } }))

const HUNK = { file: 'a.ts', new_start: 4, new_count: 1, old_lines: [], is_green: true }
const output: { stdout: Array<string>; stderr: Array<string> } = { stdout: [], stderr: [] }

function capture(sink: Array<string>): (chunk: string | Uint8Array) => boolean {
	return function write(chunk: string | Uint8Array): boolean {
		sink.push(String(chunk))

		return true
	}
}

beforeEach(() => {
	output.stdout = []
	output.stderr = []
	vi.spyOn(process.stdout, 'write').mockImplementation(capture(output.stdout))
	vi.spyOn(process.stderr, 'write').mockImplementation(capture(output.stderr))
	run.mockReset()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('test_pinned_main.main', () => {
	it('runs with the default cap and exits clean when every hunk is pinned', async () => {
		run.mockResolvedValue({ unpinned: [], unchecked: [], max_hunks: 20 })

		expect(await test_pinned_main.main([])).toBe(0)
		expect(run).toHaveBeenCalledWith(20)
		expect(output.stdout.join('')).toBe('unpinned 0 · unchecked 0\n')
	})

	it('passes --max through and exits non-zero on an unpinned hunk', async () => {
		run.mockResolvedValue({ unpinned: [HUNK], unchecked: [HUNK], max_hunks: 1 })

		expect(await test_pinned_main.main(['--max', '1'])).toBe(1)
		expect(run).toHaveBeenCalledWith(1)
		expect(output.stdout.join('')).toBe(
			'unpinned 1 · unchecked 1\n' +
				'unpinned a.ts:4 — reverting it left every related test green\n' +
				'unchecked a.ts:4 — over the 1-hunk cap\n',
		)
	})

	it('exits clean when only unchecked hunks are left', async () => {
		run.mockResolvedValue({ unpinned: [], unchecked: [HUNK], max_hunks: 1 })

		expect(await test_pinned_main.main(['--max', '1'])).toBe(0)
	})

	it.each([[['--max', '0']], [['--max', 'x']], [['--limit']], [['--max']]])(
		'refuses %j with the usage and never runs',
		async (argv) => {
			expect(await test_pinned_main.main(argv)).toBe(1)
			expect(run).not.toHaveBeenCalled()
			expect(output.stderr.join('')).toContain('Usage: josh test:pinned')
		},
	)

	it('prints the usage clean on --help', async () => {
		expect(await test_pinned_main.main(['--help'])).toBe(0)
		expect(run).not.toHaveBeenCalled()
	})
})
