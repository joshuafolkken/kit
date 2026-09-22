import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))

const { run_tail_cli } = await import('./run-tail-cli')

const OK = 0
const FAILED = 1
const ISSUE = '2372'

const CITE_COMMAND = 'issue:cite'
const FLUSH = ['observations:flush']
const CITE = [CITE_COMMAND, ISSUE]
const CITE_NONE = [CITE_COMMAND]
const SCOPE = ['release:scope']

const info_lines: Array<string> = []

function argv_calls(): ReadonlyArray<ReadonlyArray<string>> {
	return josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)
}

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	info_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_tail_cli.run — folds the three post-merge steps into one call', () => {
	it('runs flush, cite and scope in order, forwarding the issue numbers to cite alone', async () => {
		const code = await run_tail_cli.run([ISSUE])

		expect(code).toBe(OK)
		expect(argv_calls()).toStrictEqual([FLUSH, CITE, SCOPE])
	})

	it('closes a run given no issue numbers, with an empty cite target', async () => {
		await run_tail_cli.run([])

		expect(argv_calls()).toStrictEqual([FLUSH, CITE_NONE, SCOPE])
	})

	it('joins each step under its header in one composite report', async () => {
		josh_run_mock
			.mockResolvedValueOnce({ code: OK, out: 'flushed' })
			.mockResolvedValueOnce({ code: OK, out: `cited ${ISSUE}` })
			.mockResolvedValueOnce({ code: OK, out: 'skip' })

		await run_tail_cli.run([ISSUE])

		expect(info_lines[0]).toBe(
			`=== observations ===\nflushed\n\n=== citations ===\ncited ${ISSUE}\n\n=== release ===\nskip`,
		)
	})
})

describe('run_tail_cli.run — a failed step fails the whole close', () => {
	it('exits non-zero when the ledger commit failed, even though the later steps succeeded', async () => {
		josh_run_mock
			.mockResolvedValueOnce({ code: FAILED, out: '' })
			.mockResolvedValueOnce({ code: OK, out: '' })
			.mockResolvedValueOnce({ code: OK, out: '' })

		expect(await run_tail_cli.run([ISSUE])).toBe(FAILED)
	})

	it('refuses a non-number argument rather than forwarding it to the wrong step', async () => {
		expect(await run_tail_cli.run(['--force'])).toBe(FAILED)
		expect(josh_run_mock).not.toHaveBeenCalled()
	})
})
