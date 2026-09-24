import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_fold_existing_cli } from './issue-fold-existing-cli'

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))

const PATH = 'assessment.json'
const ORIGINAL_CRITERION = 'Original criterion'
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

	it('reports an unreadable assessment without a fold recommendation', async () => {
		vi.mocked(readFile).mockRejectedValue(new Error('unreadable'))
		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_fold_existing_cli.run([PATH])).toBe(1)
	})

	it.each(['draft_body', 'verification'])('rejects an empty %s', async (field) => {
		vi.mocked(readFile).mockResolvedValue(JSON.stringify({ ...ASSESSMENT, [field]: ' ' }))
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await issue_fold_existing_cli.run([PATH])).toBe(1)
		expect(info).not.toHaveBeenCalled()
	})
})
