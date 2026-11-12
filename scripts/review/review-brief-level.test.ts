import { changed_paths } from '#scripts/git/changed-paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_brief_cli } from './review-brief-cli'
import { review_size } from './review-size'

const SOURCE = 'scripts/example.ts'
const LEVEL_ONLY = '--level-only'

beforeEach(() => {
	vi.spyOn(changed_paths, 'read_changed_paths').mockResolvedValue([SOURCE])
	vi.spyOn(review_size, 'read').mockResolvedValue(20)
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
})

afterEach(() => vi.restoreAllMocks())

describe('review:brief --level-only size classification', () => {
	it.each([false, true])('measures the selected staging scope: %s', async (is_staged) => {
		const flags = is_staged ? ['--staged'] : []

		await review_brief_cli.run([LEVEL_ONLY, ...flags, '--json'])

		expect(changed_paths.read_changed_paths).toHaveBeenCalledWith(is_staged)
		expect(review_size.read).toHaveBeenCalledWith([SOURCE], is_staged)
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"level":"low"'))
		expect(console.info).toHaveBeenCalledWith(
			expect.stringContaining('at most 20 added/deleted lines'),
		)
	})

	it.each([21, undefined])('keeps larger or unmeasured changes medium: %s', async (lines) => {
		vi.mocked(review_size.read).mockResolvedValue(lines)

		await review_brief_cli.run([LEVEL_ONLY])

		expect(console.info).toHaveBeenCalledWith('medium')
	})

	it('refuses unknown flags before reading a size', async () => {
		expect(await review_brief_cli.run([LEVEL_ONLY, '--stage'])).toBe(1)
		expect(review_size.read).not.toHaveBeenCalled()
	})
})
