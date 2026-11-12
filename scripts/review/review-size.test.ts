import { readFile } from 'node:fs/promises'
import { change_base } from '#scripts/git/change-base'
import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_size } from './review-size'

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))

const SOURCE = 'scripts/example.ts'
const TEST = 'scripts/example.test.ts'
const NEW_FILE = 'scripts/new.ts'
const BASE = 'resolved-base'
const ROOT = '/review-root'
const UNQUOTED_PATH_OPTION = 'core.quotePath=false'

function plant_scope(): void {
	vi.spyOn(change_base, 'resolved_through_merge').mockResolvedValue(BASE)
	vi.spyOn(git_command, 'diff_numstat_since').mockResolvedValue(`10\t10\t${SOURCE}`)
	vi.spyOn(git_command, 'untracked_names').mockResolvedValue('')
	vi.spyOn(git_spawn, 'read').mockResolvedValue(ROOT)
}

describe('review_size.read', () => {
	beforeEach(plant_scope)
	afterEach(() => {
		vi.restoreAllMocks()
		vi.mocked(readFile).mockReset()
	})

	it('counts additions and deletions from the resolved branch base (ac-90c34b20)', async () => {
		expect(await review_size.read([SOURCE])).toBe(20)
		expect(git_command.diff_numstat_since).toHaveBeenCalledWith(BASE)
	})

	it('includes test lines in the total', async () => {
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(`1\t0\t${SOURCE}\n20\t0\t${TEST}`)

		expect(await review_size.read([SOURCE, TEST])).toBe(21)
	})

	it('counts a deleted file without reading its missing content', async () => {
		vi.mocked(git_command.diff_numstat_since).mockResolvedValue(`0\t20\t${SOURCE}`)

		expect(await review_size.read([SOURCE])).toBe(20)
		expect(readFile).not.toHaveBeenCalled()
	})

	it('counts untracked additions including a final unterminated line', async () => {
		vi.mocked(git_command.untracked_names).mockResolvedValue(NEW_FILE)
		vi.mocked(readFile).mockResolvedValue(Buffer.from('first\nlast'))

		expect(await review_size.read([SOURCE, NEW_FILE])).toBe(22)
		expect(readFile).toHaveBeenCalledWith(`${ROOT}/${NEW_FILE}`)
	})
})

describe('review_size.read staged scope', () => {
	beforeEach(plant_scope)
	afterEach(() => vi.restoreAllMocks())
	it('measures the index alone for staged additions', async () => {
		vi.mocked(git_spawn.read).mockResolvedValue(`20\t0\t${NEW_FILE}`)

		expect(await review_size.read([NEW_FILE], true)).toBe(20)
		expect(git_spawn.read).toHaveBeenCalledWith([
			'-c',
			UNQUOTED_PATH_OPTION,
			'diff',
			'--cached',
			'--numstat',
			'--no-relative',
			'--no-renames',
			'--',
		])
		expect(git_command.untracked_names).not.toHaveBeenCalled()
		expect(git_command.diff_numstat_since).not.toHaveBeenCalled()
	})

	it('matches non-ASCII staged paths to the name listing', async () => {
		const unicode_file = 'scripts/コ.ts'

		vi.mocked(git_spawn.read).mockImplementation(async (arguments_) =>
			arguments_.includes(UNQUOTED_PATH_OPTION)
				? `1\t0\t${unicode_file}`
				: '1\t0\t"scripts/\\343\\202\\263.ts"',
		)

		expect(await review_size.read([unicode_file], true)).toBe(1)
	})
})

describe('review_size.read failures', () => {
	beforeEach(plant_scope)
	afterEach(() => {
		vi.restoreAllMocks()
		vi.mocked(readFile).mockReset()
	})
	it.each(['-\t-\t', 'bad\t0\t', '1\t', '-1\t0\t'])(
		'keeps invalid or binary tracked counts unknown: %s',
		async (prefix) => {
			vi.mocked(git_command.diff_numstat_since).mockResolvedValue(`${prefix}${SOURCE}`)

			expect(await review_size.read([SOURCE])).toBeUndefined()
		},
	)

	it('keeps binary untracked files unknown', async () => {
		vi.mocked(git_command.untracked_names).mockResolvedValue(NEW_FILE)
		vi.mocked(readFile).mockResolvedValue(Buffer.from([0]))

		expect(await review_size.read([SOURCE, NEW_FILE])).toBeUndefined()
	})

	it('keeps unreadable additions unknown', async () => {
		vi.mocked(git_command.untracked_names).mockResolvedValue(NEW_FILE)
		vi.mocked(readFile).mockRejectedValue(new Error('unreadable'))

		expect(await review_size.read([SOURCE, NEW_FILE])).toBeUndefined()
	})

	it('keeps a failed git read unknown', async () => {
		vi.mocked(git_command.diff_numstat_since).mockRejectedValue(new Error('git failed'))

		expect(await review_size.read([SOURCE])).toBeUndefined()
	})

	it('keeps an unresolved base unknown', async () => {
		vi.mocked(change_base.resolved_through_merge).mockResolvedValue(undefined)

		expect(await review_size.read([SOURCE])).toBeUndefined()
	})

	it('does not treat a missing measurement as zero', async () => {
		expect(await review_size.read([NEW_FILE])).toBeUndefined()
	})
})
