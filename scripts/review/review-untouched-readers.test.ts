import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { git_grep_hits } from '#scripts/git/git-grep-hits'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	review_untouched_readers,
	type Readers,
	type ReadersRead,
} from './review-untouched-readers'

// joshuafolkken/kit#4515, against real git: the change before round 1 of #4475 edited
// `issue_merged.read_merged` and left `run-tidy-cli.ts` reading it, and #4466 changed what a ship
// supervisor's lane counts as and left `run-ship-return.ts` on the old count. Each reader has to be
// listed, and a reader the change itself edits must not be.

const MERGED = 'scripts/issue/issue-merged.ts'
const HANDOFF = 'scripts/lane/lane-handoff.ts'
const TIDY = 'scripts/run/tidy/run-tidy-cli.ts'
const SHIP_RETURN = 'scripts/run/ship/run-ship-return.ts'
const MERGE_COLLECT = 'scripts/run/merge/run-merge-collect.ts'
const OTHER = 'scripts/run/other.ts'
const CONSTANTS = 'scripts/run/constants.ts'
const OVER_CAP = 2

const MERGED_BEFORE = [
	'async function read_merged(issue: string): Promise<boolean> {',
	'	return issue.length > 0',
	'}',
	'',
	'const issue_merged = { read_merged }',
	'',
	'export { issue_merged }',
	'',
].join('\n')

const MERGED_AFTER = MERGED_BEFORE.replace('issue.length > 0', 'issue.length > 0 || is_measured()')

const HANDOFF_BEFORE = [
	'function is_ship_running(issue: string): boolean {',
	"	return issue !== ''",
	'}',
	'',
	'function is_handed_off(): boolean {',
	'	return false',
	'}',
	'',
	'const lane_handoff = { is_handed_off, is_ship_running }',
	'',
	'export { lane_handoff }',
	'',
].join('\n')

const HANDOFF_AFTER = HANDOFF_BEFORE.replace("issue !== ''", "issue !== '' && !is_merge_waiting()")

const READERS: Record<string, string> = {
	[TIDY]: 'const is_merged = memoized(issue_merged.read_merged)\n',
	[SHIP_RETURN]: 'if (lane_handoff.is_ship_running(issue)) return held\n',
	[MERGE_COLLECT]: 'if (lane_handoff.is_ship_running(lane.issue)) return\n',
	[OTHER]: 'lane_handoff.is_handed_off()\n',
}

const fixture: FixtureWorkspace = {
	workspace: '',
	previous_cwd: process.cwd(),
	restore_environment: undefined,
}

async function write(relative: string, text: string): Promise<void> {
	const target = path.join(fixture.workspace, relative)

	await mkdir(path.dirname(target), { recursive: true })
	await writeFile(target, text)
}

async function arrange_base(): Promise<void> {
	const { git } = git_fixture_workspace
	const files = { [MERGED]: MERGED_BEFORE, [HANDOFF]: HANDOFF_BEFORE, ...READERS }

	await git(fixture.workspace, ['init', '-q', git_fixture_workspace.MAIN_BRANCH])
	await Promise.all(
		Object.entries(files).map(async ([relative, text]) => {
			await write(relative, text)
		}),
	)
	await git(fixture.workspace, ['add', '.'])
	await git(fixture.workspace, ['commit', '-qm', 'base'])
}

async function read_whole(paths: ReadonlyArray<string>): Promise<ReadersRead> {
	return await review_untouched_readers.read({ root: fixture.workspace, base: 'HEAD', paths })
}

async function read_after(paths: ReadonlyArray<string>): Promise<ReadonlyArray<Readers>> {
	const { readers } = await read_whole(paths)

	return readers
}

// One direct export per line, more of them than the reader search covers.
function constants(value: number): string {
	const count = review_untouched_readers.MAX_NAMES + OVER_CAP

	return Array.from(
		{ length: count },
		(_unused, index) => `export const c${String(index)} = ${String(value)}\n`,
	).join('')
}

function sites(readers: ReadonlyArray<Readers>): Array<string> {
	return readers.flatMap((entry) => entry.hits.map((hit) => `${entry.target} ${hit.path}`))
}

beforeEach(async () => {
	Object.assign(fixture, git_fixture_workspace.open_workspace('review-readers-'))
	await arrange_base()
})

afterEach(async () => {
	vi.restoreAllMocks()
	await git_fixture_workspace.close_workspace(fixture)
})

describe('review_untouched_readers.read', () => {
	it('lists run-tidy-cli.ts for the #4475 edit of issue_merged.read_merged', async () => {
		await write(MERGED, MERGED_AFTER)

		const readers = await read_after([MERGED])

		expect(sites(readers)).toEqual([`issue_merged.read_merged ${TIDY}`])
		expect(readers[0]?.origin).toBe(`${MERGED}:1`)
	})

	it('lists run-ship-return.ts for the #4466 edit and drops a reader the change also edits', async () => {
		await write(HANDOFF, HANDOFF_AFTER)
		await write(MERGE_COLLECT, 'if (lane_handoff.is_ship_running(lane.issue)) return true\n')

		const readers = await read_after([HANDOFF, MERGE_COLLECT])

		expect(sites(readers)).toEqual([`lane_handoff.is_ship_running ${SHIP_RETURN}`])
	})

	it('counts the edited names past the cap instead of dropping them', async () => {
		const { git } = git_fixture_workspace

		await write(CONSTANTS, constants(0))
		await git(fixture.workspace, ['add', '.'])
		await git(fixture.workspace, ['commit', '-qm', 'constants'])
		await write(CONSTANTS, constants(1))

		const { omitted } = await read_whole([CONSTANTS])

		expect(omitted).toBe(OVER_CAP)
	})

	it('lists nothing where only the namespace object gains a member', async () => {
		await write(HANDOFF, HANDOFF_BEFORE.replace('is_ship_running }', 'is_ship_running, extra }'))

		expect(await read_after([HANDOFF])).toEqual([])
	})
})

describe('review_untouched_readers.read failures', () => {
	it('keeps a name whose search failed, marked as failed rather than reader-free', async () => {
		vi.spyOn(git_grep_hits, 'search').mockResolvedValue({ hits: [], has_failed: true })
		await write(MERGED, MERGED_AFTER)

		const readers = await read_after([MERGED])

		expect(readers.map((entry) => [entry.target, entry.has_failed])).toEqual([
			['issue_merged.read_merged', true],
		])
	})

	it('raises when the diff cannot be read, so the brief can say the list is missing', async () => {
		await expect(
			review_untouched_readers.read({
				root: fixture.workspace,
				base: 'no-such-ref',
				paths: [MERGED],
			}),
		).rejects.toThrow()
	})
})
