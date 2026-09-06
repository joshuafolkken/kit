import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { HistoryReader } from '#scripts/release/release-history'
import { afterAll, describe, expect, it, vi } from 'vitest'

const DEFAULT_BRANCH = 'main'
const fetched = vi.hoisted(() => ({ branches: [] as Array<string> }))

// The two reads `read_tip` makes. Mocked rather than exercised, because resolving the tip fetches
// from `origin` and a unit suite must not reach the network — which is also why every other case
// here passes an explicit `tip`.
vi.mock('./git-command', () => ({
	git_command: {
		get_default_branch: async (): Promise<string> => DEFAULT_BRANCH,
		fetch_branch: async (branch_name: string): Promise<string> => {
			fetched.branches.push(branch_name)

			return ''
		},
	},
}))

const { git_followup_pending } = await import('./git-followup-pending')

// joshuafolkken/kit#1486: the completion notification used to read the local `package.json` and
// report it as the shipping version. Children no longer bump, so that read now names the *previous*
// release — the unconfirmed value presented as fact this suite exists to keep out.
//
// What the assertions are really about is the two directions in which the replacement can be wrong:
// a count that is silently understated by this run's own merge, and a count nobody could measure
// being reported as zero.

const BASE_SHA = 'a1b2c3d4e5f6a7b8'
const CURRENT_VERSION = '1.340.0'
const PREVIOUS_VERSION = '1.339.0'
const PENDING_COUNT = 3
const NO_MERGES = 0
// Every case passes one, because production resolves the tip by fetching the default branch and a
// unit suite must not reach the network. What the tip has to *be* is asserted separately, from the
// range the reader is handed.
const TIP = 'origin/main'

const work_directories: Array<string> = []

function project_at(version: string | undefined): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'josh-followup-pending-'))

	work_directories.push(directory)

	if (version !== undefined) {
		writeFileSync(
			path.join(directory, 'package.json'),
			JSON.stringify({ name: 'fixture', version }),
		)
	}

	return directory
}

// The three reads `release_history` makes, answered without a git repository. `log_first_parent`
// returns one commit that touched `package.json`, `show_file` gives that commit and its parent
// different versions — which is what makes it a version change — and `count_merges` is the number
// under test.
function reader_with(pending: number, seen?: Array<string>): HistoryReader {
	return {
		log_first_parent: async (
			_limit: number,
			_file_path: string,
			tip: string,
		): Promise<Array<string>> => {
			seen?.push(tip)

			return [BASE_SHA]
		},
		show_file: async (spec: string): Promise<string> => {
			const version = spec.startsWith(`${BASE_SHA}^`) ? PREVIOUS_VERSION : CURRENT_VERSION

			return JSON.stringify({ name: 'fixture', version })
		},
		count_merges: async (range: string): Promise<number> => {
			seen?.push(range)

			return pending
		},
	}
}

function failing_reader(): HistoryReader {
	return {
		log_first_parent: async (): Promise<Array<string>> => {
			throw new Error('the default branch could not be fetched')
		},
		show_file: async (): Promise<string> => '',
		count_merges: async (): Promise<number> => NO_MERGES,
	}
}

afterAll(() => {
	for (const directory of work_directories) rmSync(directory, { force: true, recursive: true })
})

describe('git_followup_pending.pending_release_line', () => {
	it('reports the unreleased merge count rather than a project version', async () => {
		const line = await git_followup_pending.pending_release_line({
			is_merge_pending: false,
			cwd: project_at(CURRENT_VERSION),
			reader: reader_with(PENDING_COUNT),
			tip: TIP,
		})

		expect(line).toContain(`unreleased merges on main: ${String(PENDING_COUNT)}`)
		expect(line).not.toContain('project version')
		expect(line).not.toContain(CURRENT_VERSION)
	})

	// The Telegram goes out before the merge, so a bare number is understated by exactly one every
	// time. The note is what keeps the reader from taking it for the count afterwards.
	it('says the pending merge is not in the count when one is coming', async () => {
		const line = await git_followup_pending.pending_release_line({
			is_merge_pending: true,
			cwd: project_at(CURRENT_VERSION),
			reader: reader_with(PENDING_COUNT),
			tip: TIP,
		})

		expect(line).toContain(git_followup_pending.MERGE_PENDING_NOTE)
	})

	// Zero is a real answer — nothing is waiting to ship — and it has to survive as a printed line
	// rather than being swallowed with the cases nobody could measure.
	it('reports a count of zero as a line of its own', async () => {
		const line = await git_followup_pending.pending_release_line({
			is_merge_pending: false,
			cwd: project_at(CURRENT_VERSION),
			reader: reader_with(NO_MERGES),
			tip: TIP,
		})

		expect(line).toBe(`🚚 unreleased merges on main: ${String(NO_MERGES)}`)
	})
})

// The whole point of the tip: `--first-parent` only reads as "main's line" when the walk starts on
// main, and `followup` runs on the feature branch — where every merge main took after the branch was
// cut is not even an ancestor.
describe('git_followup_pending.pending_release_line — which ref the count is read from', () => {
	it('reads the history from the tip it is given, not from HEAD', async () => {
		const seen: Array<string> = []

		await git_followup_pending.pending_release_line({
			is_merge_pending: false,
			cwd: project_at(CURRENT_VERSION),
			reader: reader_with(PENDING_COUNT, seen),
			tip: TIP,
		})

		expect(seen).toStrictEqual([TIP, `${BASE_SHA}..${TIP}`])
	})

	// The half no other case reaches: with no `tip` given, production has to resolve one itself. Left
	// unchecked, `read_tip` could return `HEAD` and the whole suite would still pass — which is the
	// defect this pair of tests exists to pin, not the threading below it.
	it('resolves the fetched default branch when no tip is given', async () => {
		const seen: Array<string> = []

		fetched.branches = []
		await git_followup_pending.pending_release_line({
			is_merge_pending: false,
			cwd: project_at(CURRENT_VERSION),
			reader: reader_with(PENDING_COUNT, seen),
		})

		expect(fetched.branches).toStrictEqual([DEFAULT_BRANCH])
		expect(seen).toStrictEqual([TIP, `${BASE_SHA}..${TIP}`])
	})
})

// A count nobody could measure is not a count of zero, and a notification that reported one would be
// the same false statement in the other direction.
describe('git_followup_pending.pending_release_line — nothing to report', () => {
	it('contributes no line when the project has no readable version', async () => {
		const line = await git_followup_pending.pending_release_line({
			is_merge_pending: true,
			cwd: project_at(undefined),
			reader: reader_with(PENDING_COUNT),
			tip: TIP,
		})

		expect(line).toBeUndefined()
	})

	it('contributes no line when the history cannot be read', async () => {
		const line = await git_followup_pending.pending_release_line({
			is_merge_pending: true,
			cwd: project_at(CURRENT_VERSION),
			reader: failing_reader(),
			tip: TIP,
		})

		expect(line).toBeUndefined()
	})
})
