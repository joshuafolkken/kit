import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { review_record_cli } from './review-record-cli'

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-record-'))
const NOW = new Date('2026-09-22T00:00:00Z')

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

function ledger_path(name: string): string {
	return path.join(TEST_DIR, name)
}

describe('review_record_cli.parse_finding', () => {
	it('keeps a `:line` citation in the file field', () => {
		expect(review_record_cli.parse_finding('bug-risks:medium:src/foo.ts:42')).toEqual({
			category: 'bug-risks',
			severity: 'medium',
			file: 'src/foo.ts:42',
		})
	})

	it('rejects an unknown category', () => {
		expect(review_record_cli.parse_finding('made-up:medium:a.ts')).toBeUndefined()
	})

	it('rejects a missing severity separator', () => {
		expect(review_record_cli.parse_finding('bug-risks-a.ts')).toBeUndefined()
	})

	it('rejects a file field carrying the ledger field separator', () => {
		expect(review_record_cli.parse_finding('tests:low:a.ts | injected')).toBeUndefined()
	})
})

describe('review_record_cli.build_lines', () => {
	it('writes a zero-finding line when no findings are given', () => {
		const lines = review_record_cli.build_lines({ issue: 5, findings: [] }, '2026-09-22')

		expect(lines).toEqual(['- rf:none | none | - | 2026-09-22 | #5'])
	})
})

describe('review_record_cli.run', () => {
	it('appends one finding line per finding', async () => {
		const file = ledger_path('with-findings.md')
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const code = await review_record_cli.run(
			['--issue', '2325', 'tests:medium:a.ts', 'security:low:b.ts'],
			NOW,
			file,
		)

		info.mockRestore()
		expect(code).toBe(0)
		expect(readFileSync(file, 'utf8')).toBe(
			'- rf:tests | medium | a.ts | 2026-09-22 | #2325\n- rf:security | low | b.ts | 2026-09-22 | #2325\n',
		)
	})

	it('records a zero-finding round as one line', async () => {
		const file = ledger_path('zero-round.md')
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await review_record_cli.run(['--issue', '2325'], NOW, file)
		info.mockRestore()

		expect(readFileSync(file, 'utf8')).toBe('- rf:none | none | - | 2026-09-22 | #2325\n')
	})

	it('refuses without a valid issue number and writes nothing', async () => {
		const file = ledger_path('none.md')
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const code = await review_record_cli.run(['tests:low:a.ts'], NOW, file)

		error.mockRestore()
		expect(code).toBe(1)
		expect(existsSync(file)).toBe(false)
	})
})
