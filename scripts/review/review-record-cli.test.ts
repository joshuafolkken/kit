import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { review_finding_ledger } from './review-finding-ledger'
import { review_record_cli } from './review-record-cli'

vi.mock('#scripts/observations/observation-ledger-home', async (original) => {
	const actual = await original<{ observation_ledger_home: typeof observation_ledger_home }>()

	return { observation_ledger_home: { ...actual.observation_ledger_home, ledger_root: vi.fn() } }
})

const issue_comment_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_comment: issue_comment_mock },
}))

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-record-'))
const NOW = new Date('2026-09-22T00:00:00Z')

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

function root_of(name: string): string {
	return path.join(TEST_DIR, name)
}

function issue_file(root: string, issue: number): string {
	return path.join(root, observation_ledger.ledger_file(issue))
}

function recorded_root(name: string): string {
	const file = issue_file(root_of(name), 2343)

	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, '- rf:none | none | - | 2026-09-22 | #2343\n', 'utf8')

	return root_of(name)
}

async function quietly(run: () => Promise<number>): Promise<number> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
	const code = await run()

	info.mockRestore()
	error.mockRestore()

	return code
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
	it('appends one finding line per finding to the issue file', async () => {
		const root = root_of('with-findings')
		const argv = ['--issue', '2325', 'tests:medium:a.ts', 'security:low:b.ts']
		const code = await quietly(async () => await review_record_cli.run(argv, NOW, root))

		expect(code).toBe(0)
		expect(readFileSync(issue_file(root, 2325), 'utf8')).toBe(
			'- rf:tests | medium | a.ts | 2026-09-22 | #2325\n- rf:security | low | b.ts | 2026-09-22 | #2325\n',
		)
	})

	it('records a zero-finding round as one line', async () => {
		const root = root_of('zero-round')

		await quietly(async () => await review_record_cli.run(['--issue', '2325'], NOW, root))

		expect(readFileSync(issue_file(root, 2325), 'utf8')).toBe(
			'- rf:none | none | - | 2026-09-22 | #2325\n',
		)
	})

	it('refuses without a valid issue number and writes nothing', async () => {
		const root = root_of('none')
		const code = await quietly(
			async () => await review_record_cli.run(['tests:low:a.ts'], NOW, root),
		)

		expect(code).toBe(1)
		expect(existsSync(root)).toBe(false)
	})
})

// joshuafolkken/kit#3422: a refused spec printed only the usage line, so the reader grepped for the
// category and severity vocabulary. The refusal now names it, built from the ledger's constants.
async function refusal_of(argv: ReadonlyArray<string>): Promise<string> {
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

	await review_record_cli.run(argv, NOW, root_of('refused'))
	const printed = error.mock.calls.flat().join('\n')

	error.mockRestore()

	return printed
}

describe('review_record_cli.run — a refused spec names the accepted values', () => {
	it.each(review_finding_ledger.CATEGORIES)('names the category %s', async (category) => {
		expect(await refusal_of(['--issue', '3422', 'bug:low:package.json'])).toContain(category)
	})

	it.each(review_finding_ledger.SEVERITIES)('names the severity %s', async (severity) => {
		expect(await refusal_of(['--issue', '3422', 'bug-risks:minor:a.ts'])).toContain(severity)
	})

	it('names the accepted values on an unknown flag too', async () => {
		expect(await refusal_of(['--bogus'])).toBe(review_record_cli.usage_text())
	})

	it('builds the accepted-values line from the list it is given', () => {
		expect(review_record_cli.accepted_values('<x>', ['one', 'two'])).toBe('  <x>: one | two')
	})

	it('keeps the --check usage short', async () => {
		const printed = await refusal_of(['--check'])

		expect(printed).not.toContain(review_finding_ledger.CATEGORIES[0])
	})
})

// joshuafolkken/kit#2919 regression: two lanes recording at once wrote one file's tail, so their pull
// requests conflicted on the ledger. Each issue now writes its own file, and the two never meet.
describe('review_record_cli.run — two parallel lanes', () => {
	it('writes each issue to its own file, and the check finds both', async () => {
		const root = root_of('parallel')

		await quietly(async () => await review_record_cli.run(['--issue', '101'], NOW, root))
		await quietly(async () => await review_record_cli.run(['--issue', '102'], NOW, root))

		expect(readFileSync(issue_file(root, 101), 'utf8')).not.toContain('#102')
		expect(readFileSync(issue_file(root, 102), 'utf8')).not.toContain('#101')
		expect(
			await quietly(
				async () => await review_record_cli.run(['--check', '--issue', '101'], NOW, root),
			),
		).toBe(0)
		expect(
			await quietly(
				async () => await review_record_cli.run(['--check', '--issue', '102'], NOW, root),
			),
		).toBe(0)
	})
})

describe('review_record_cli.run --check', () => {
	it('exits 0 when the round is recorded', async () => {
		const root = recorded_root('check-ok')

		expect(
			await quietly(
				async () => await review_record_cli.run(['--check', '--issue', '2343'], NOW, root),
			),
		).toBe(0)
	})

	it('exits 0 when no ledger is kept (not-required)', async () => {
		const root = root_of('check-absent')

		expect(
			await quietly(
				async () => await review_record_cli.run(['--check', '--issue', '2343'], NOW, root),
			),
		).toBe(0)
	})

	it('exits 1 when the round is not recorded', async () => {
		const root = recorded_root('check-missing')

		expect(
			await quietly(
				async () => await review_record_cli.run(['--check', '--issue', '9999'], NOW, root),
			),
		).toBe(1)
	})
})

// joshuafolkken/kit#3645: a round recorded after the pull request opened goes to the issue, so the
// tree holds no pending ledger append for `pnpm josh followup` to push onto the open pull request.
describe('review_record_cli.run --comment', () => {
	const ZERO_LINE = '- rf:none | none | - | 2026-09-22 | #3645'

	it('posts the lines as an issue comment and appends nothing', async () => {
		const root = root_of('comment')

		issue_comment_mock.mockReset().mockResolvedValue('https://example.test/comment\n')
		const argv = ['--issue', '3645', '--comment', 'tests:low:b.ts']
		const code = await quietly(async () => await review_record_cli.run(argv, NOW, root))

		expect(code).toBe(0)
		expect(issue_comment_mock).toHaveBeenCalledWith(
			'3645',
			review_record_cli.comment_body(['- rf:tests | low | b.ts | 2026-09-22 | #3645']),
		)
		expect(existsSync(issue_file(root, 3645))).toBe(false)
	})

	it('keeps the ledger grammar readable inside the comment', () => {
		expect(review_record_cli.comment_body([ZERO_LINE]).split('\n')).toContain(ZERO_LINE)
	})

	it('exits 1 when the comment could not be posted, the round being recorded nowhere', async () => {
		issue_comment_mock.mockReset().mockRejectedValue(new Error('gh refused'))
		const argv = ['--issue', '3645', '--comment']
		const code = await quietly(async () => await review_record_cli.run(argv, NOW, root_of('lost')))

		expect(code).toBe(1)
	})
})

// joshuafolkken/kit#2919: both halves default to the work tree the command runs in, so a lane records
// into its own tree and checks the same one.
describe('review_record_cli.run — default ledger', () => {
	it('appends to the running work tree and checks the same file', async () => {
		const root = root_of('lane')

		vi.mocked(observation_ledger_home.ledger_root).mockReturnValue(root)
		await quietly(async () => await review_record_cli.run(['--issue', '2419'], NOW))
		const code = await quietly(
			async () => await review_record_cli.run(['--check', '--issue', '2419'], NOW),
		)

		expect(readFileSync(issue_file(root, 2419), 'utf8')).toBe(
			'- rf:none | none | - | 2026-09-22 | #2419\n',
		)
		expect(code).toBe(0)
	})
})
