import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { changed_paths } from '#scripts/git/changed-paths'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import type { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { review_comment_round } from './review-comment-round'
import { review_finding_ledger } from './review-finding-ledger'
import { review_record_cli } from './review-record-cli'

vi.mock('./review-comment-round', async (original) => {
	const actual = await original<{ review_comment_round: typeof review_comment_round }>()
	const carry = vi.fn().mockResolvedValue(0)

	return { review_comment_round: { ...actual.review_comment_round, carry } }
})

vi.mock('#scripts/observations/observation-ledger-home', async (original) => {
	const actual = await original<{ observation_ledger_home: typeof observation_ledger_home }>()

	return { observation_ledger_home: { ...actual.observation_ledger_home, ledger_root: vi.fn() } }
})

const changed_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/changed-paths', async (original) => {
	const actual = await original<{ changed_paths: typeof changed_paths }>()

	return { changed_paths: { ...actual.changed_paths, read_changed_paths: changed_mock } }
})

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-record-interaction-'))
const NOW = new Date('2026-09-22T00:00:00Z')
const ISSUE = 4276
const INTERACTION_FLAG = '--interaction'
const ISSUE_FLAG = ['--issue', String(ISSUE)]
const CHECK_ARGV = ['--check', INTERACTION_FLAG, ...ISSUE_FLAG]

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

function issue_file(root: string): string {
	return path.join(root, observation_ledger.ledger_file(ISSUE))
}

// A checkout whose ledger holds only `/code-review`'s zero-finding round for the issue.
function code_only_root(name: string): string {
	const root = path.join(TEST_DIR, name)
	const file = issue_file(root)

	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, `${review_finding_ledger.zero_round_line('2026-09-22', ISSUE)}\n`, 'utf8')

	return root
}

async function quietly(run: () => Promise<number>): Promise<number> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
	const code = await run()

	info.mockRestore()
	error.mockRestore()

	return code
}

describe('review_record_cli.run — the interaction review', () => {
	it('records a clean pass as a zero-finding `- ri:` line', async () => {
		const root = code_only_root('record')

		expect(
			await quietly(
				async () => await review_record_cli.run([...ISSUE_FLAG, INTERACTION_FLAG], NOW, root),
			),
		).toBe(0)
		expect(readFileSync(issue_file(root), 'utf8')).toContain(
			'- ri:none | none | - | 2026-09-22 | #4276',
		)
	})

	it('refuses `--check` when the change is due and only `/code-review` is recorded', async () => {
		changed_mock.mockResolvedValue(['scripts/run/x.ts'])

		expect(
			await quietly(
				async () => await review_record_cli.run(CHECK_ARGV, NOW, code_only_root('due')),
			),
		).toBe(1)
	})

	it('passes `--check` when the change touches no run tooling', async () => {
		changed_mock.mockResolvedValue(['scripts/review/x.ts'])

		expect(
			await quietly(
				async () => await review_record_cli.run(CHECK_ARGV, NOW, code_only_root('not-due')),
			),
		).toBe(0)
	})

	it('treats `--comment` with `--interaction` as a usage error', async () => {
		const argv = [...ISSUE_FLAG, '--comment', INTERACTION_FLAG]

		expect(
			await quietly(async () => await review_record_cli.run(argv, NOW, code_only_root('comment'))),
		).toBe(1)
	})
})
