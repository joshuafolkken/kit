import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_fold_apply } from './issue-fold-apply'
import { issue_fold_existing_cli } from './issue-fold-existing-cli'

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))

const PATH = 'assessment.json'
const APPLY_FLAG = '--apply'
const FINGERPRINT_FLAG = '--fingerprint'
const ORIGINAL_CRITERION = 'Original criterion'
const FINGERPRINT = 'assessed-thread'
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

describe('issue_fold_existing_cli.run refusals', () => {
	it.each([
		[[APPLY_FLAG]],
		[[APPLY_FLAG, '0']],
		[[APPLY_FLAG, '12', '--json']],
		[['--json', '12']],
	])('prints the usage for the options %j', async (options) => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_fold_existing_cli.run([PATH, ...options])).toBe(1)
		expect(error.mock.calls.join('\n')).toContain('Usage')
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
