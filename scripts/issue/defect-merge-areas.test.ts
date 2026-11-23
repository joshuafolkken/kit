import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defect_merge_areas } from './defect-merge-areas'

const RECORD = '\u{1E}'
const DEFAULT_BRANCH = 'origin/main'
const RUN_AREA = 'scripts/run'
const LOG = [
	'Merge pull request #10 from owner/10-lane\n\nscripts/run/a.ts\nscripts/run/b.ts\ndocs/x.md\n',
	'Merge pull request #11 from owner/11-lane\n\nscripts/run/c.ts\n',
	"Merge branch 'main' into 12-lane\n\nscripts/lane/d.ts\n",
].map((record) => `${RECORD}${record}`)

afterEach(() => {
	vi.restoreAllMocks()
})

describe('defect:report merges per area', () => {
	it('counts each pull request merge once per area it touched, skipping other merges', () => {
		expect(defect_merge_areas.count_areas(LOG.join(''))).toEqual(
			new Map([
				[RUN_AREA, 2],
				['docs', 1],
			]),
		)
	})

	it('reads the default branch first-parent merges since the period start, not HEAD', async () => {
		vi.spyOn(git_command, 'default_branch_reference').mockResolvedValue(DEFAULT_BRANCH)
		const read = vi.spyOn(git_spawn, 'read').mockResolvedValue(LOG[1] ?? '')

		const counts = await defect_merge_areas.read(new Date('2026-11-16T00:00:00Z'))
		const argv = read.mock.calls[0]?.[0]

		expect(counts).toEqual(new Map([[RUN_AREA, 1]]))
		expect(argv?.slice(0, 2)).toEqual(['log', DEFAULT_BRANCH])
		expect(argv).toEqual(
			expect.arrayContaining(['--first-parent', '--merges', '--since=2026-11-16T00:00:00.000Z']),
		)
	})
})
