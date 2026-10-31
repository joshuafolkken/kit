import { afterEach, describe, expect, it, vi } from 'vitest'
import { ci_timing, type TimingAnswer } from './ci-timing'
import { ci_timing_cli } from './ci-timing-cli'

vi.mock('./ci-timing')

const URL = 'https://example.test/run'
const UNIT = { name: 'unit', seconds: 30, conclusion: 'success', steps: [] }
const TIMED = {
	kind: 'timed',
	runs: [
		{
			run: { id: 7, name: 'CI', conclusion: 'success', head_sha: 'a', html_url: URL },
			jobs: [UNIT],
		},
		{ run: { id: 8, name: 'Lint', head_sha: 'a', html_url: URL }, jobs: [UNIT] },
	],
} satisfies TimingAnswer

const timing_of = vi.mocked(ci_timing.timing_of)

function capture(): { out: () => string; err: () => string } {
	const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	const stderr = vi.spyOn(console, 'error').mockReturnValue()

	return {
		out: () => stdout.mock.calls.map(([text]) => String(text)).join(''),
		err: () => stderr.mock.calls.map(([text]) => String(text)).join('\n'),
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('ci_timing_cli.run', () => {
	it('prints each run heading and its table, a blank line between runs', async () => {
		timing_of.mockResolvedValue(TIMED)
		const output = capture()
		const table = 'job / step   s  conclusion\nunit        30  success'

		await expect(ci_timing_cli.run(['5544'])).resolves.toBe(0)
		expect(output.out()).toBe(
			`run 7 — CI · success · ${URL}\n${table}\n\nrun 8 — Lint · in progress · ${URL}\n${table}\n`,
		)
	})

	it('prints the runs as JSON under --json', async () => {
		timing_of.mockResolvedValue(TIMED)
		const output = capture()

		await expect(ci_timing_cli.run(['5544', '--json'])).resolves.toBe(0)
		expect(JSON.parse(output.out())).toStrictEqual(TIMED.runs)
	})

	it('exits non-zero naming the target when no run exists', async () => {
		timing_of.mockResolvedValue({ kind: 'none', target: 'empty' })
		const output = capture()

		await expect(ci_timing_cli.run(['empty'])).resolves.toBe(1)
		expect(output.err()).toBe('ci:timing empty — no GitHub Actions run found')
	})

	it("exits non-zero with gh's message, not a stack trace, when the lookup fails", async () => {
		timing_of.mockRejectedValue(new Error('gh: Not Found (HTTP 404)'))
		const output = capture()

		await expect(ci_timing_cli.run(['5546'])).resolves.toBe(1)
		expect(output.err()).toBe('ci:timing 5546 — gh: Not Found (HTTP 404)')
	})

	it('prints the usage without exactly one target', async () => {
		const output = capture()

		await expect(ci_timing_cli.run([])).resolves.toBe(1)
		await expect(ci_timing_cli.run(['a', 'b'])).resolves.toBe(1)
		expect(output.err()).toBe(`${ci_timing_cli.USAGE}\n${ci_timing_cli.USAGE}`)
	})
})
