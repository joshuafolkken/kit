import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { review_record_cli } from './review-record-cli'

vi.mock('#scripts/observations/observation-ledger-home', () => ({
	observation_ledger_home: { ledger_path: vi.fn() },
}))

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-record-'))
const NOW = new Date('2026-09-22T00:00:00Z')

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

function ledger_path(name: string): string {
	return path.join(TEST_DIR, name)
}

function recorded_ledger(name: string): string {
	const file = ledger_path(name)

	writeFileSync(file, '- rf:none | none | - | 2026-09-22 | #2343\n', 'utf8')

	return file
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

// joshuafolkken/kit#2402: a consumer that keeps no observation ledger has no `docs/` at its root, so
// appending without creating the parent first fails with ENOENT and leaves the merge gate
// unsatisfiable. The write path creates the directory it needs.
describe('review_record_cli.run — missing parent directory', () => {
	it('creates the parent directory before appending', async () => {
		const file = path.join(TEST_DIR, 'missing-dir', 'observations.md')
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const code = await review_record_cli.run(['--issue', '2402', 'security:low:c.ts'], NOW, file)

		info.mockRestore()
		expect(code).toBe(0)
		expect(readFileSync(file, 'utf8')).toBe('- rf:security | low | c.ts | 2026-09-22 | #2402\n')
	})
})

describe('review_record_cli.run --check', () => {
	it('exits 0 when the round is recorded', async () => {
		const file = recorded_ledger('check-ok.md')
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const code = await review_record_cli.run(['--check', '--issue', '2343'], NOW, file)

		info.mockRestore()
		expect(code).toBe(0)
	})

	it('exits 0 when no ledger is kept (not-required)', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const code = await review_record_cli.run(
			['--check', '--issue', '2343'],
			NOW,
			ledger_path('check-absent.md'),
		)

		info.mockRestore()
		expect(code).toBe(0)
	})

	it('exits 1 when the round is not recorded', async () => {
		const file = recorded_ledger('check-missing.md')
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const code = await review_record_cli.run(['--check', '--issue', '9999'], NOW, file)

		error.mockRestore()
		expect(code).toBe(1)
	})
})

// joshuafolkken/kit#2419: inside a lane the lane's own ledger never reached the default branch, so
// both halves default to the ledger the primary checkout keeps.
describe('review_record_cli.run — default ledger', () => {
	it('appends to the primary checkout ledger and checks the same file', async () => {
		const file = ledger_path('primary-ledger.md')
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		vi.mocked(observation_ledger_home.ledger_path).mockReturnValue(file)
		await review_record_cli.run(['--issue', '2419'], NOW)
		const code = await review_record_cli.run(['--check', '--issue', '2419'], NOW)

		info.mockRestore()
		expect(readFileSync(file, 'utf8')).toBe('- rf:none | none | - | 2026-09-22 | #2419\n')
		expect(code).toBe(0)
	})
})
