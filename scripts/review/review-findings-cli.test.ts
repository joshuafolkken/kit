import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { review_findings_cli } from './review-findings-cli'

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-findings-'))

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

// A checkout whose ledger directory holds one file per given content.
function root_with(...contents: ReadonlyArray<string>): string {
	const root = mkdtempSync(path.join(TEST_DIR, 'root-'))

	for (const [index, content] of contents.entries()) {
		const file = path.join(root, observation_ledger.ledger_file(index + 1))

		mkdirSync(path.dirname(file), { recursive: true })
		writeFileSync(file, content, 'utf8')
	}

	return root
}

async function report_of(root: string): Promise<string> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	const code = await review_findings_cli.run(root)
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
