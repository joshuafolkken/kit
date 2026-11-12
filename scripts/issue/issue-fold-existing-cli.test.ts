import { readFile } from 'node:fs/promises'
import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
import { epic_classify } from '#scripts/epic/epic-classify'
import { split_resolution } from '#scripts/split/split-resolution'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_fold_apply, type ApplyResult } from './issue-fold-apply'
import { issue_fold_existing_cli } from './issue-fold-existing-cli'

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))

const PATH = 'assessment.json'
const APPLY_FLAG = '--apply'
const FOUND_DURING_FLAG = '--found-during'
const FINGERPRINT_FLAG = '--fingerprint'
const ORIGINAL_CRITERION = 'Original criterion'
const FINGERPRINT = 'assessed-thread'
const RELATION_FAILURE = 'relation failed'
const ASSESSMENT = {
	content: 'compatible',
	is_open: true,
	is_unstarted: true,
	has_pull_request: false,
	has_complete_read: true,
	has_dependency_conflict: false,
	is_separable: true,
	size_verdict: 'single',
	existing_body: ORIGINAL_CRITERION,
	comment_fingerprint: FINGERPRINT,
	draft_body: 'Additional criterion',
	verification: 'Focused unit test',
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_fold_existing_cli.run', () => {
	it('prints the verdict and additive body for a compatible candidate', async () => {
		vi.mocked(readFile).mockResolvedValue(JSON.stringify(ASSESSMENT))
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await issue_fold_existing_cli.run([PATH])).toBe(0)
		expect(info.mock.calls.join('\n')).toContain('Fold: fold')
		expect(info.mock.calls.join('\n')).toContain(ORIGINAL_CRITERION)
	})

	it('prints the verdict and the folded body as one JSON object', async () => {
		vi.mocked(readFile).mockResolvedValue(JSON.stringify(ASSESSMENT))
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await issue_fold_existing_cli.run([PATH, '--json'])).toBe(0)
		const printed = String(info.mock.calls[0]?.[0])

		expect(info).toHaveBeenCalledTimes(1)
		expect(JSON.parse(printed)).toMatchObject({ verdict: 'fold' })
		expect(printed).toContain(ORIGINAL_CRITERION)
	})

	it('reports an unreadable assessment without a fold recommendation', async () => {
		vi.mocked(readFile).mockRejectedValue(new Error('unreadable'))
		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_fold_existing_cli.run([PATH])).toBe(1)
	})
})

describe('issue_fold_existing_cli.run --apply', () => {
	it('applies a fold to the named issue', async () => {
		vi.mocked(readFile).mockResolvedValue(JSON.stringify(ASSESSMENT))
		const apply = vi.spyOn(issue_fold_apply, 'apply').mockResolvedValue('applied')

		vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await issue_fold_existing_cli.run([PATH, APPLY_FLAG, '12'])).toBe(0)
		expect(apply).toHaveBeenCalledWith(
			expect.objectContaining({
				issue_number: '12',
				existing_body: ORIGINAL_CRITERION,
				comment_fingerprint: FINGERPRINT,
			}),
		)
	})

	it('fails when the apply does not complete', async () => {
		vi.mocked(readFile).mockResolvedValue(JSON.stringify(ASSESSMENT))
		vi.spyOn(issue_fold_apply, 'apply').mockResolvedValue('changed')
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_fold_existing_cli.run([PATH, APPLY_FLAG, '12'])).toBe(1)
		expect(error.mock.calls.join('\n')).toContain('nothing written')
	})

	it('writes nothing when the verdict is not fold', async () => {
		vi.mocked(readFile).mockResolvedValue(JSON.stringify({ ...ASSESSMENT, content: 'separate' }))
		const apply = vi.spyOn(issue_fold_apply, 'apply')

		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_fold_existing_cli.run([PATH, APPLY_FLAG, '12'])).toBe(1)
		expect(apply).not.toHaveBeenCalled()
	})
})

function applied(result: ApplyResult = 'applied'): ReturnType<typeof vi.spyOn> {
	vi.mocked(readFile).mockResolvedValue(JSON.stringify(ASSESSMENT))
	vi.spyOn(issue_fold_apply, 'apply').mockResolvedValue(result)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)

	return vi.spyOn(split_resolution, 'record_fold').mockResolvedValue()
}

// joshuafolkken/kit#6630: a split part folded into an existing Issue answers the origin lane's notice.
describe('issue_fold_existing_cli.run --apply --found-during', () => {
	it('records the fold target as the origin lane split child', async () => {
		const record_fold = applied()

		expect(
			await issue_fold_existing_cli.run([PATH, APPLY_FLAG, '12', FOUND_DURING_FLAG, '34']),
		).toBe(0)
		expect(record_fold).toHaveBeenCalledExactlyOnceWith({ origin: '34', target: '12' })
	})

	it('records nothing without --found-during or when the fold does not complete', async () => {
		const record_fold = applied('changed')

		expect(
			await issue_fold_existing_cli.run([PATH, APPLY_FLAG, '12', FOUND_DURING_FLAG, '34']),
		).toBe(1)
		vi.mocked(issue_fold_apply.apply).mockResolvedValue('applied')
		expect(await issue_fold_existing_cli.run([PATH, APPLY_FLAG, '12'])).toBe(0)
		expect(record_fold).not.toHaveBeenCalled()
	})

	it('fails with the cause when the split child cannot be recorded', async () => {
		applied().mockRejectedValue(new Error(RELATION_FAILURE))
		const error = vi.mocked(console.error)

		expect(
			await issue_fold_existing_cli.run([PATH, APPLY_FLAG, '12', FOUND_DURING_FLAG, '34']),
		).toBe(1)
		expect(error.mock.calls.join('\n')).toContain(RELATION_FAILURE)
	})
})

// joshuafolkken/kit#6643: the rerun takes the written fold as applied and records it.
describe('issue_fold_existing_cli.run --apply --found-during on a failed record', () => {
	it.each([
		[PATH, PATH],
		['fold assess.json', "'fold assess.json'"],
	])('names the rerun that records the split child for %s', async (path, quoted) => {
		applied().mockRejectedValue(new Error(RELATION_FAILURE))
		const error = vi.mocked(console.error)

		await issue_fold_existing_cli.run([path, APPLY_FLAG, '12', FOUND_DURING_FLAG, '34'])

		expect(error.mock.calls.join('\n')).toContain(
			`pnpm josh issue:fold-existing ${quoted} ${APPLY_FLAG} 12 ${FOUND_DURING_FLAG} 34`,
		)
	})
})

describe('issue_fold_existing_cli.run --fingerprint', () => {
	it("prints the issue's comment fingerprint", async () => {
		vi.spyOn(issue_fold_apply, 'comment_fingerprint').mockResolvedValue(FINGERPRINT)
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await issue_fold_existing_cli.run([FINGERPRINT_FLAG, '12'])).toBe(0)
		expect(info).toHaveBeenCalledWith(FINGERPRINT)
	})

	it('fails when the comments cannot be read', async () => {
		vi.spyOn(issue_fold_apply, 'comment_fingerprint').mockResolvedValue(undefined)
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_fold_existing_cli.run([FINGERPRINT_FLAG, '12'])).toBe(1)
		expect(error.mock.calls.join('\n')).toContain('could not be read')
	})
})

describe('issue_fold_existing_cli.run — confirmed duplicate dependencies', () => {
	it('records only the explicitly named stopped issue against the existing duplicate', async () => {
		vi.mocked(readFile).mockResolvedValue(JSON.stringify({ ...ASSESSMENT, content: 'duplicate' }))
		const record = vi.spyOn(epic_blocked_by, 'record').mockResolvedValue('recorded')
		const apply = vi.spyOn(issue_fold_apply, 'apply')

		vi.spyOn(issue_fold_apply, 'check_unchanged').mockResolvedValue(undefined)

		vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await issue_fold_existing_cli.run([PATH, APPLY_FLAG, '12', '--blocked', '34'])).toBe(0)
		expect(record).toHaveBeenCalledExactlyOnceWith({ issue: '34', prerequisite: '12' })
		expect(apply).not.toHaveBeenCalled()
	})

	it('reports a failed dependency record', async () => {
		vi.mocked(readFile).mockResolvedValue(JSON.stringify({ ...ASSESSMENT, content: 'duplicate' }))
		vi.spyOn(epic_blocked_by, 'record').mockRejectedValue(new Error(RELATION_FAILURE))
		vi.spyOn(issue_fold_apply, 'check_unchanged').mockResolvedValue(undefined)
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_fold_existing_cli.run([PATH, APPLY_FLAG, '12', '--blocked', '34'])).toBe(1)
		expect(error.mock.calls.join('\n')).toContain(RELATION_FAILURE)
	})
})

describe('issue_fold_existing_cli.run — unchanged duplicate assessment', () => {
	it.each(['changed', 'unreadable'] as const)(
		'does not record a %s duplicate assessment',
		async (refusal) => {
			vi.mocked(readFile).mockResolvedValue(JSON.stringify({ ...ASSESSMENT, content: 'duplicate' }))
			vi.spyOn(issue_fold_apply, 'check_unchanged').mockResolvedValue(refusal)
			const record = vi.spyOn(epic_blocked_by, 'record')

			vi.spyOn(console, 'error').mockImplementation(() => undefined)

			expect(await issue_fold_existing_cli.run([PATH, APPLY_FLAG, '12', '--blocked', '34'])).toBe(1)
			expect(record).not.toHaveBeenCalled()
		},
	)
})

describe('issue_fold_existing_cli.run — read-only duplicate assessment', () => {
	it.each([[], ['--json'], [APPLY_FLAG, '12']])(
		'does not record a duplicate for %j',
		async (...options) => {
			vi.mocked(readFile).mockResolvedValue(JSON.stringify({ ...ASSESSMENT, content: 'duplicate' }))
			const record = vi.spyOn(epic_blocked_by, 'record')

			vi.spyOn(console, 'info').mockImplementation(() => undefined)
			vi.spyOn(console, 'error').mockImplementation(() => undefined)
			await issue_fold_existing_cli.run([PATH, ...options])
			expect(record).not.toHaveBeenCalled()
		},
	)
})

describe('issue_fold_existing_cli.run — unconfirmed duplicate assessment', () => {
	it.each(['compatible', 'separate', 'unknown'])(
		'does not record %s as a duplicate',
		async (content) => {
			vi.mocked(readFile).mockResolvedValue(JSON.stringify({ ...ASSESSMENT, content }))
			const record = vi.spyOn(epic_blocked_by, 'record')

			vi.spyOn(console, 'error').mockImplementation(() => undefined)

			expect(await issue_fold_existing_cli.run([PATH, APPLY_FLAG, '12', '--blocked', '34'])).toBe(1)
			expect(record).not.toHaveBeenCalled()
		},
	)
})

describe('issue_fold_existing_cli.run — duplicate readiness', () => {
	it('keeps the stopped issue out of runnable children after the dependency is recorded', async () => {
		vi.mocked(readFile).mockResolvedValue(JSON.stringify({ ...ASSESSMENT, content: 'duplicate' }))
		const blocked_by: Array<{ repo: string; number: number }> = []
		const repo = 'owner/repo'

		vi.spyOn(issue_fold_apply, 'check_unchanged').mockResolvedValue(undefined)
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		vi.spyOn(epic_blocked_by, 'record').mockImplementation(async ({ prerequisite }) => {
			blocked_by.push({ repo, number: Number(prerequisite) })

			return 'recorded'
		})
		expect(await issue_fold_existing_cli.run([PATH, APPLY_FLAG, '12', '--blocked', '34'])).toBe(0)
		const result = epic_classify.classify_children([
			{ number: 34, repo, state: 'OPEN', labels: [], blocked_by },
			{ number: 12, repo, state: 'OPEN', labels: [], blocked_by: [] },
		])

		expect(result.runnable.map((entry) => entry.number)).toEqual([12])
	})
})

describe('issue_fold_existing_cli.run refusals', () => {
	it.each([
		[[APPLY_FLAG]],
		[[APPLY_FLAG, '0']],
		[[APPLY_FLAG, '12', '--json']],
		[[APPLY_FLAG, '12', '--blocked', 'owner/repo#34']],
		[[APPLY_FLAG, '12', '--blocked', '0']],
		[[APPLY_FLAG, '12', FOUND_DURING_FLAG, '#34']],
		[[APPLY_FLAG, '12', '--other', '34']],
		[['--json', '12']],
	])('prints the usage for the options %j', async (options) => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_fold_existing_cli.run([PATH, ...options])).toBe(1)
		expect(error.mock.calls.join('\n')).toContain('Usage')
		expect(error.mock.calls.join('\n')).toContain('--blocked <stopped-issue>')
	})

	it.each(['draft_body', 'verification', 'comment_fingerprint'])(
		'rejects an empty %s',
		async (field) => {
			vi.mocked(readFile).mockResolvedValue(JSON.stringify({ ...ASSESSMENT, [field]: ' ' }))
			vi.spyOn(console, 'error').mockImplementation(() => undefined)
			const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

			expect(await issue_fold_existing_cli.run([PATH])).toBe(1)
			expect(info).not.toHaveBeenCalled()
		},
	)
})
