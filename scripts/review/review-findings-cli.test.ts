import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import { review_findings_cli } from './review-findings-cli'

const make_directory = temporary_directory('suite')
const TEST_DIR = make_directory('review-findings-')

// A checkout whose ledger directory holds one file per given content.
function root_with(...contents: ReadonlyArray<string>): string {
	const root = make_directory('review-findings-root-')

	for (const [index, content] of contents.entries()) {
		const file = path.join(root, observation_ledger.ledger_file(index + 1))

		mkdirSync(path.dirname(file), { recursive: true })
		writeFileSync(file, content, 'utf8')
	}

	return root
}

// 2026-11-10T12:00Z, so a 7-day period starts on 2026-11-03.
const NOW_MS = Date.parse('2026-11-10T12:00:00Z')

async function report_of(root: string, argv: ReadonlyArray<string> = []): Promise<string> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	const code = await review_findings_cli.run(argv, root, NOW_MS)
	const printed = String(info.mock.calls[0]?.[0])

	info.mockRestore()
	expect(code).toBe(0)

	return printed
}

describe('review_findings_cli.format_report', () => {
	it('lists categories with the zero-round count', () => {
		const report = review_findings_cli.format_report([{ category: 'bug-risks', count: 2 }], 1)

		expect(report).toBe('findings by category:\n  bug-risks: 2\nzero-finding rounds recorded: 1')
	})

	it('reports the zero-round count alone when no findings exist', () => {
		expect(review_findings_cli.format_report([], 3)).toBe('zero-finding rounds recorded: 3')
	})

	it('reports nothing recorded when the ledger holds no finding lines', () => {
		expect(review_findings_cli.format_report([], 0)).toBe(review_findings_cli.NO_FINDINGS)
	})
})

describe('review_findings_cli.run', () => {
	// joshuafolkken/kit#2919: each issue writes its own file, and the count spans all of them.
	it('aggregates finding lines and zero rounds across every issue file', async () => {
		const root = root_with(
			'- rf:tests | medium | a.ts | 2026-09-22 | #1\n',
			'- rf:tests | low | b.ts | 2026-09-22 | #2\n',
			'- rf:none | none | - | 2026-09-22 | #3\n',
		)

		expect(await report_of(root)).toBe(
			'findings by category:\n  tests: 2\nzero-finding rounds recorded: 1',
		)
	})

	it('reports nothing recorded for a missing ledger', async () => {
		expect(await report_of(path.join(TEST_DIR, 'absent'))).toBe(review_findings_cli.NO_FINDINGS)
	})
})

// One issue file before the 7-day boundary, one on and after it, and zero rounds on both sides.
const ledger = [
	'- rf:tests | low | a.ts | 2026-11-02 | #1\n',
	'- rf:tests | low | a.ts | 2026-11-03 | #2\n- rf:bug-risks | high | b.ts | 2026-11-09 | #2\n',
	'- rf:none | none | - | 2026-11-10 | #3\n- rf:none | none | - | 2026-11-01 | #4\n',
]

// joshuafolkken/kit#7130: `--period` narrows to the last days and splits by severity.
describe('review_findings_cli.run --period', () => {
	it('prints the in-period counts by severity, medium and up first, with the zero rounds', async () => {
		expect(await report_of(root_with(...ledger), ['--period', '7'])).toBe(
			[
				'findings by category and severity since 2026-11-03:',
				'  bug-risks: high 1 · medium 0 · low 0',
				'  tests: high 0 · medium 0 · low 1',
				'zero-finding rounds recorded: 1',
			].join('\n'),
		)
	})

	it('reports nothing recorded when the period holds no line', async () => {
		expect(await report_of(root_with(ledger[0] ?? ''), ['--period', '1'])).toBe(
			review_findings_cli.NO_FINDINGS,
		)
	})

	it('leaves the run with no argument on the all-time category counts', async () => {
		expect(await report_of(root_with(...ledger))).toBe(
			'findings by category:\n  tests: 2\n  bug-risks: 1\nzero-finding rounds recorded: 2',
		)
	})

	it.each([['0'], ['-3'], ['1.5'], ['week']])(
		'prints the usage and fails for --period %s',
		async (value) => {
			const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
			const code = await review_findings_cli.run(['--period', value], root_with(), NOW_MS)

			expect(code).toBe(1)
			expect(error).toHaveBeenCalledWith(review_findings_cli.USAGE)
			error.mockRestore()
		},
	)
})
