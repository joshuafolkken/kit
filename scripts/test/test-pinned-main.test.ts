import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PinnedReport } from './test-pinned-logic'
import { test_pinned_main } from './test-pinned-main'

const { run } = vi.hoisted(() => ({ run: vi.fn<(max_hunks: number) => Promise<PinnedReport>>() }))

const { write_stamp } = vi.hoisted(() => ({ write_stamp: vi.fn() }))

const { read_changed_tree } = vi.hoisted(() => ({
	read_changed_tree: vi.fn<() => Promise<Record<string, string>>>(),
}))

vi.mock('./test-pinned', () => ({ test_pinned: { run } }))
vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: {
		digest: (content: string) => content,
		stamp_path: (prefix: string) => prefix,
		write_stamp,
	},
}))
vi.mock('#scripts/review/review-tree', () => ({ review_tree: { read_changed_tree } }))

const FILE = 'a.ts'
const HUNK = { file: FILE, new_start: 4, new_count: 1, old_lines: [], is_green: true }
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
	write_stamp.mockReset()
	read_changed_tree.mockReset()
	read_changed_tree.mockResolvedValue({ [FILE]: 'one' })
})

afterEach(() => {
	vi.restoreAllMocks()
})

const CLEAN_REPORT: PinnedReport = {
	unpinned: [],
	stopped: [],
	unchecked: [],
	unparsed: [],
	max_hunks: 20,
	has_runner: true,
}

describe('test_pinned_main.main', () => {
	it('runs with the default cap and exits clean when every hunk is pinned', async () => {
		run.mockResolvedValue(CLEAN_REPORT)

		expect(await test_pinned_main.main([])).toBe(0)
		expect(run).toHaveBeenCalledWith(20)
		expect(output.stdout.join('')).toBe('unpinned 0 · unchecked 0\n')
	})

	it('passes --max through and exits non-zero on an unpinned hunk', async () => {
		run.mockResolvedValue({ ...CLEAN_REPORT, unpinned: [HUNK], unchecked: [HUNK], max_hunks: 1 })

		expect(await test_pinned_main.main(['--max', '1'])).toBe(1)
		expect(run).toHaveBeenCalledWith(1)
		expect(output.stdout.join('')).toBe(
			'unpinned 1 · unchecked 1\n' +
				'unpinned a.ts:4 — reverting it left every related test green\n' +
				'unchecked a.ts:4 — over the 1-hunk cap\n',
		)
	})

	it('exits clean when only unchecked hunks are left', async () => {
		run.mockResolvedValue({ ...CLEAN_REPORT, unchecked: [HUNK], max_hunks: 1 })

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

// joshuafolkken/kit#4770: `--record` leaves the answer `josh run:review --join` waits on.
const TOKEN = 'launch-4770'
// The record is filed under the token, which the mocked digest passes through.
const RECORD = `josh-test-pinned-record-${TOKEN}-`

describe('test_pinned_main.main --record', () => {
	it('records the report and its unpinned count under the launch token', async () => {
		run.mockResolvedValue({ ...CLEAN_REPORT, unpinned: [HUNK] })

		expect(await test_pinned_main.main(['--record', TOKEN])).toBe(1)
		expect(write_stamp).toHaveBeenCalledWith(RECORD, {
			token: TOKEN,
			text: output.stdout.join(''),
			unpinned: [expect.stringMatching(/^a\.ts /u)],
		})
	})

	it('records a check that could not run as one with nothing unpinned, and still throws', async () => {
		const reason = 'worktree add failed'

		run.mockRejectedValue(new Error(reason))

		await expect(test_pinned_main.main(['--record', TOKEN])).rejects.toThrow(reason)
		expect(write_stamp).toHaveBeenCalledWith(RECORD, {
			token: TOKEN,
			text: `\`josh test:pinned\` could not run, so nothing was checked: ${reason}\n`,
			unpinned: [],
		})
	})

	it('refuses --record without a token', async () => {
		expect(await test_pinned_main.main(['--record'])).toBe(1)
		expect(run).not.toHaveBeenCalled()
	})

	it('records nothing without --record', async () => {
		run.mockResolvedValue(CLEAN_REPORT)

		await test_pinned_main.main([])

		expect(write_stamp).not.toHaveBeenCalled()
	})
})

describe('test_pinned_main.main --record on a moving tree', () => {
	it('checks again when the tree moved under the check, and records the settled answer', async () => {
		read_changed_tree
			.mockResolvedValueOnce({ [FILE]: 'one' })
			.mockResolvedValueOnce({ [FILE]: 'two' })
		run.mockResolvedValueOnce({ ...CLEAN_REPORT, unpinned: [HUNK] }).mockResolvedValue(CLEAN_REPORT)

		expect(await test_pinned_main.main(['--record', TOKEN])).toBe(0)
		expect(run).toHaveBeenCalledTimes(2)
		expect(write_stamp).toHaveBeenCalledWith(RECORD, expect.objectContaining({ unpinned: [] }))
	})

	it('records nothing checked when the tree keeps moving', async () => {
		let reads = 0

		read_changed_tree.mockImplementation(async () => {
			reads += 1

			return { [FILE]: String(reads) }
		})
		run.mockResolvedValue({ ...CLEAN_REPORT, unpinned: [HUNK] })

		await expect(test_pinned_main.main(['--record', TOKEN])).rejects.toThrow('kept moving')
		expect(run).toHaveBeenCalledTimes(3)
		expect(write_stamp).toHaveBeenCalledWith(RECORD, expect.objectContaining({ unpinned: [] }))
	})

	it('checks the tree once without --record', async () => {
		read_changed_tree.mockResolvedValueOnce({ [FILE]: 'two' })
		run.mockResolvedValue(CLEAN_REPORT)

		await test_pinned_main.main([])

		expect(run).toHaveBeenCalledTimes(1)
	})
})
