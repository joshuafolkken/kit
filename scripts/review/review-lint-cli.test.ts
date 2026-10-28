import { afterEach, describe, expect, it, vi } from 'vitest'
import { review_lint_cli } from './review-lint-cli'

const MISMATCH = 'REVIEW TARGET MISMATCH'
const SUMMARY_ONLY = '### Summary\n\ngo'

afterEach(() => {
	vi.restoreAllMocks()
})

function capture(review: string, argv: ReadonlyArray<string>): { code: number; output: string } {
	const lines: Array<string> = []

	vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
		lines.push(String(line))
	})
	vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
		lines.push(String(line))
	})
	const code = review_lint_cli.run(review, argv)

	return { code, output: lines.join('\n') }
}

describe('review_lint_cli.run', () => {
	it('prints ok and exits 0 on a conforming reply', () => {
		expect(capture(MISMATCH, [])).toEqual({ code: 0, output: 'ok' })
	})

	it('prints the violations and the rubric section, exiting 1', () => {
		const { code, output } = capture(SUMMARY_ONLY, [])

		expect(code).toBe(1)
		expect(output).toContain('✖ missing heading: ### Bug risks & logic errors')
		expect(output).toContain('prompts/review-rubric.md → "Review output format"')
	})

	it('checks the round-2 shape under --round 2', () => {
		const { code, output } = capture(SUMMARY_ONLY, ['--round', '2'])

		expect(code).toBe(1)
		expect(output).toContain('✖ missing heading: ### First-round findings')
	})

	it.each([[['--round', '3']], [['--round']], [['--bogus']]])(
		'refuses %j with the usage line',
		(argv) => {
			expect(capture(MISMATCH, argv)).toEqual({
				code: 1,
				output: 'Usage: josh review:lint [--round <1|2>] < review.md',
			})
		},
	)

	it('refuses empty stdin', () => {
		const { code, output } = capture('  \n', [])

		expect(code).toBe(1)
		expect(output).toContain('nothing on stdin')
	})
})
