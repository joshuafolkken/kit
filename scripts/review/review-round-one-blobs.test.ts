import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { review_round_one_blobs } from './review-round-one-blobs'
import { review_round2_cli } from './review-round2-cli'

// joshuafolkken/kit#4165: round 2 on a moved base carries round 1's blobs onto the new base and names
// the paths the carry does not reproduce. **It drives real git**, because the claim is about what a
// merge of the default branch leaves in the working tree: a path only the default branch changed has
// to drop out, and a fix made after the merge has to stay in.
//
// **One repository per case**: every case moves the base its own way, so none could share one.

const TIMEOUT_MS = 30_000
const WORKSPACE_PREFIX = 'review-round-one-blobs-'
const PRIMARY = 'primary'
const MAIN = 'main'
const FEATURE = 'feature'
const THING = 'thing.ts'
const FOREIGN = 'foreign.ts'
const ADDED = 'added.ts'
// Far enough apart that a change to the first line and one to the last merge cleanly.
const BASE_LINES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven']
const LAST_LINE = BASE_LINES.length - 1
const FOREIGN_ON_MAIN = { [FOREIGN]: ['changed on main'] }
const { git, MAIN_BRANCH } = git_fixture_workspace

const fixture: FixtureWorkspace & { root: string } = {
	previous_cwd: '',
	restore_environment: undefined,
	root: '',
	workspace: '',
}

interface RoundOne {
	blobs: Record<string, string> | undefined
	from: string
}

function with_line(lines: ReadonlyArray<string>, index: number, text: string): Array<string> {
	return lines.map((line, at) => (at === index ? text : line))
}

const ROUND_ONE_LINES = with_line(BASE_LINES, 0, 'round one')

function write_file(name: string, lines: ReadonlyArray<string>): void {
	writeFileSync(path.join(fixture.root, name), `${lines.join('\n')}\n`)
}

async function commit_all(message: string): Promise<void> {
	await git(fixture.root, ['add', '--all'])
	await git(fixture.root, ['commit', '-m', message])
}

async function changed_against(commit: string): Promise<Array<string>> {
	const output = await git(fixture.root, ['diff', '--name-only', commit])

	return output.split('\n').filter((name) => name !== '')
}

async function build_branch(): Promise<void> {
	await git(fixture.workspace, ['init', MAIN_BRANCH, PRIMARY])
	write_file(THING, BASE_LINES)
	write_file(FOREIGN, ['foreign'])
	await commit_all('base')
	await git(fixture.root, ['switch', '-c', FEATURE])
	write_file(THING, ROUND_ONE_LINES)
	await commit_all('implementation')
}

// What `josh review:brief` records in round 1: each changed path's blob, against the base then.
async function read_round_one(): Promise<RoundOne> {
	const from = await git(fixture.root, ['merge-base', MAIN, 'HEAD'])

	return { blobs: review_round_one_blobs.capture(await changed_against(from)), from }
}

// The default branch lands `files`, and the run merges it; a conflict is left for the case to resolve.
async function land_on_main_and_merge(files: Record<string, ReadonlyArray<string>>): Promise<void> {
	await git(fixture.root, ['switch', MAIN])
	for (const [name, lines] of Object.entries(files)) write_file(name, lines)
	await commit_all('upstream')
	await git(fixture.root, ['switch', FEATURE])

	try {
		await git(fixture.root, ['merge', '--no-edit', MAIN])
	} catch {
		/* a conflicting merge exits non-zero; the case resolves it */
	}
}

// What `josh review:round2` carries: from round 1's base onto the base now, over the paths changed now.
async function carry(round_one: RoundOne): Promise<ReadonlyArray<string> | undefined> {
	const to = await git(fixture.root, ['rev-parse', MAIN])

	return review_round_one_blobs.carried_delta({
		...round_one,
		to,
		paths: await changed_against(to),
	})
}

// The working tree and index (`status`) and HEAD — everything `capture` must leave alone.
async function repository_state(): Promise<Array<string>> {
	return [
		await git(fixture.root, ['status', '--porcelain']),
		await git(fixture.root, ['rev-parse', 'HEAD']),
	]
}

beforeEach(async () => {
	Object.assign(fixture, git_fixture_workspace.open_workspace(WORKSPACE_PREFIX))
	fixture.root = path.join(fixture.workspace, PRIMARY)
	await build_branch()
	process.chdir(fixture.root)
}, TIMEOUT_MS)

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
}, TIMEOUT_MS)

describe('review_round_one_blobs.carried_delta — a merge of the default branch alone', () => {
	it('names nothing when the merge brought in a file round 1 never read', async () => {
		const round_one = await read_round_one()

		await land_on_main_and_merge(FOREIGN_ON_MAIN)

		expect(await carry(round_one)).toStrictEqual([])
	})
})

describe('review_round_one_blobs.carried_delta — a fix after the merge', () => {
	it('names the fixed file and never the file the merge brought in', async () => {
		const round_one = await read_round_one()

		await land_on_main_and_merge(FOREIGN_ON_MAIN)
		write_file(THING, with_line(ROUND_ONE_LINES, 1, 'fixed'))

		expect(await carry(round_one)).toStrictEqual([THING])
	})

	it('names a file both main and the fix changed, apart from each other', async () => {
		const round_one = await read_round_one()
		const merged = with_line(ROUND_ONE_LINES, LAST_LINE, 'main')

		await land_on_main_and_merge({ [THING]: with_line(BASE_LINES, LAST_LINE, 'main') })
		write_file(THING, with_line(merged, 1, 'fixed'))

		expect(await carry(round_one)).toStrictEqual([THING])
	})

	it('names nothing when main changed round 1 file apart from round 1 and nothing was fixed', async () => {
		const round_one = await read_round_one()

		await land_on_main_and_merge({ [THING]: with_line(BASE_LINES, LAST_LINE, 'main') })

		expect(await carry(round_one)).toStrictEqual([])
	})
})

describe('review_round_one_blobs.carried_delta — a carry that cannot be made', () => {
	it('answers undefined when main changed the line round 1 changed', async () => {
		const round_one = await read_round_one()

		await land_on_main_and_merge({ [THING]: with_line(BASE_LINES, 0, 'main') })
		write_file(THING, with_line(BASE_LINES, 0, 'resolved'))
		await commit_all('resolve')

		expect(await carry(round_one)).toBeUndefined()
	})

	it('answers undefined when round 1 recorded no blobs', async () => {
		const { from } = await read_round_one()

		await land_on_main_and_merge(FOREIGN_ON_MAIN)

		expect(await carry({ blobs: undefined, from })).toBeUndefined()
	})
})

// joshuafolkken/kit#5791: one path git cannot carry answers for itself, never for the paths beside it.
async function carry_each(
	round_one: RoundOne,
	paths: ReadonlyArray<string>,
): Promise<Record<string, boolean | undefined> | undefined> {
	const to = await git(fixture.root, ['rev-parse', MAIN])

	return review_round_one_blobs.carried_each({ ...round_one, to, paths })
}

describe('review_round_one_blobs.carried_each — each path on its own', () => {
	it('answers undefined for the conflicting path alone', async () => {
		const round_one = await read_round_one()

		await land_on_main_and_merge({ [THING]: with_line(BASE_LINES, 0, 'main'), ...FOREIGN_ON_MAIN })
		write_file(THING, with_line(BASE_LINES, 0, 'resolved'))
		await commit_all('resolve')

		expect(await carry_each(round_one, [THING, FOREIGN])).toStrictEqual({
			[THING]: undefined,
			[FOREIGN]: true,
		})
	})

	it('answers false for a path fixed after the merge', async () => {
		const round_one = await read_round_one()

		await land_on_main_and_merge(FOREIGN_ON_MAIN)
		write_file(THING, with_line(ROUND_ONE_LINES, 1, 'fixed'))

		expect(await carry_each(round_one, [THING, FOREIGN])).toStrictEqual({
			[THING]: false,
			[FOREIGN]: true,
		})
	})

	it('answers nothing to carry over no paths, and undefined with no recorded blobs', async () => {
		const round_one = await read_round_one()

		await land_on_main_and_merge(FOREIGN_ON_MAIN)

		expect(await carry_each(round_one, [])).toStrictEqual({})
		expect(await carry_each({ ...round_one, blobs: undefined }, [THING])).toBeUndefined()
	})
})

describe('review_round_one_blobs.unmoved — the paths a base move left alone', () => {
	it('names the file main left alone and not the one main changed', async () => {
		const { from } = await read_round_one()

		await land_on_main_and_merge(FOREIGN_ON_MAIN)
		const to = await git(fixture.root, ['rev-parse', MAIN])

		expect(review_round_one_blobs.unmoved({ from, to, paths: [THING, FOREIGN] })).toStrictEqual([
			THING,
		])
	})

	it('answers undefined without a recorded base', () => {
		expect(
			review_round_one_blobs.unmoved({ from: undefined, to: MAIN, paths: [THING] }),
		).toBeUndefined()
	})
})

describe('review_round2_cli.carried_reader — the carry over every path changed now', () => {
	it('names a file the fix added after the merge, which no round-1 record holds', async () => {
		const { blobs, from } = await read_round_one()

		await land_on_main_and_merge(FOREIGN_ON_MAIN)
		write_file(ADDED, ['added by the fix'])
		const to = await git(fixture.root, ['rev-parse', MAIN])
		const tree = Object.fromEntries([THING, ADDED].map((name) => [name, '']))
		const read = review_round2_cli.carried_reader(to, tree)

		expect(read({ taken_at: '', files: {}, base: from, blobs: blobs ?? {} })).toStrictEqual([ADDED])
	})
})

describe('review_round_one_blobs.capture — writes objects and nothing else', () => {
	it('leaves the working tree, the index and HEAD as they were', async () => {
		write_file(THING, with_line(ROUND_ONE_LINES, 1, 'uncommitted'))
		const before = await repository_state()

		const blobs = review_round_one_blobs.capture([THING])

		expect(blobs?.[THING]).toMatch(/^[\da-f]{40}$/u)
		expect(await repository_state()).toStrictEqual(before)
	})
})
