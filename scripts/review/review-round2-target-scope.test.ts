import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { review_brief } from './review-brief'
import { review_round2 } from './review-round2'
import { review_tree } from './review-tree'

// The regression this suite exists for (joshuafolkken/kit#1537): `josh review:brief --round 2` handed
// the reviewer a target list that did not match the branch's diff, in **both** directions — files the
// branch never touched arrived in it, and files the branch did touch were missing from it. The
// omission is the dangerous half: changed code goes unread while the round reports no findings.
//
// **It drives real git**, because the defect is a property of what `git diff` lists against two
// different bases. The round-1 snapshot is a bare `{ path: digest }` map, `change_base` is
// recomputed on every invocation, and `changed_since` unions the two key sets — so when the base
// moves between the rounds the two maps no longer cover the same set of files, and their set
// difference is reported as "round 1's fixes". A mocked git could only re-assert the digest
// comparison `review-brief.test.ts` already pins; it could not show the path sets diverging.
//
// **The fixture is the resumed run, reduced to its smallest shape.** The branch edits `shared.ts`
// and adds `branch-only.ts`; the default branch then lands the *same* edit to `shared.ts` plus one
// file of its own, and the run merges it — which is what a resume does. After the merge the branch's
// real diff is `branch-only.ts` alone, while round 1's snapshot still names `shared.ts`.

const TIMEOUT_MS = 30_000
const WORKSPACE_PREFIX = 'review-round2-target-scope-'
const PRIMARY = 'primary'
const ORIGIN_MAIN_REF = 'refs/remotes/origin/main'
const MAIN_HEAD_REF = 'refs/heads/main'
const CONFIG = 'config'
const UPDATE_REF = 'update-ref'
const MAIN = 'main'
const FEATURE = 'feature'
const SHARED = 'shared.ts'
const BRANCH_ONLY = 'branch-only.ts'
// A file the branch adds and never touches again — what round 1 read and round 1's fixes did not
// change. It is the `carried` half of the reconciliation.
const SETTLED = 'settled.ts'
const FOREIGN = 'foreign.ts'
const TAKEN_AT = '2026-09-07T00:00:00.000Z'
const { git, MAIN_BRANCH } = git_fixture_workspace

const fixture: FixtureWorkspace & { root: string } = {
	previous_cwd: '',
	restore_environment: undefined,
	root: '',
	workspace: '',
}

interface Reading {
	base: string
	tree: Record<string, string>
}

function write_file(name: string, content: string): void {
	writeFileSync(path.join(fixture.root, name), `${content}\n`)
}

async function commit_all(message: string): Promise<void> {
	await git(fixture.root, ['add', '--all'])
	await git(fixture.root, ['commit', '-m', message])
}

// `origin` is declared with `config` rather than `git remote add`, and the tracking ref is moved with
// `update-ref`: the unit suite's network guard refuses `fetch` and `remote` outright, and neither is
// needed to produce the ref state under test.
async function declare_origin(): Promise<void> {
	await git(fixture.root, [
		CONFIG,
		'remote.origin.url',
		path.join(fixture.workspace, 'upstream.git'),
	])
	await git(fixture.root, [CONFIG, 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'])
	await git(fixture.root, [UPDATE_REF, ORIGIN_MAIN_REF, MAIN_HEAD_REF])
	await git(fixture.root, ['symbolic-ref', 'refs/remotes/origin/HEAD', ORIGIN_MAIN_REF])
}

async function build_branch(): Promise<void> {
	await git(fixture.workspace, ['init', MAIN_BRANCH, PRIMARY])
	write_file(SHARED, 'old')
	write_file(FOREIGN, 'old')
	await commit_all('base')
	await declare_origin()
	await git(fixture.root, ['switch', '-c', FEATURE])
	write_file(SHARED, 'new')
	write_file(BRANCH_ONLY, 'branch')
	write_file(SETTLED, 'settled')
	await commit_all('implementation')
}

// The default branch lands the branch's own edit to `shared.ts` — another lane shipping the same
// change — plus one file of its own, and the run merges it. That is what takes `shared.ts` out of the
// branch's diff while round 1's record still names it.
async function advance_default_branch_and_merge(): Promise<void> {
	await git(fixture.root, ['switch', MAIN])
	write_file(SHARED, 'new')
	write_file(FOREIGN, 'changed')
	await commit_all('upstream')
	await git(fixture.root, [UPDATE_REF, ORIGIN_MAIN_REF, MAIN_HEAD_REF])
	await git(fixture.root, ['switch', FEATURE])
	await git(fixture.root, ['merge', '--no-edit', ORIGIN_MAIN_REF])
}

// Exactly what `review-brief-cli.ts` reads before it composes: the change base, and the digest map
// over the paths that base makes changed.
async function read_round(): Promise<Reading> {
	const base = await git_command.change_base()
	const paths = await changed_paths.read_changed_paths(false)

	return { base, tree: await review_tree.read_changed_tree(paths) }
}

function snapshot_of(reading: Reading): FileMapStamp {
	return { taken_at: TAKEN_AT, files: reading.tree, base: reading.base }
}

async function reach_round_two(): Promise<{ round_one: FileMapStamp; round_two: Reading }> {
	const round_one = snapshot_of(await read_round())

	await advance_default_branch_and_merge()

	return { round_one, round_two: await read_round() }
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

describe('the round-2 target against the branch it is meant to cover', () => {
	// The reproduction itself, asserted on the raw comparison the brief used to hand over verbatim.
	// Both directions are visible in this one value: `shared.ts` is in it and is not in the branch's
	// diff, and `branch-only.ts` is in the branch's diff and is not in it.
	it(
		'reproduces both directions in the bare digest comparison',
		async () => {
			const { round_one, round_two } = await reach_round_two()

			expect(Object.keys(round_two.tree)).toStrictEqual([BRANCH_ONLY, SETTLED])
			expect(file_map_stamp.changed_since(round_one, round_two.tree)).toStrictEqual([SHARED])
		},
		TIMEOUT_MS,
	)
})

// The merge is what moves the change base, and a moved base is what makes round 1's record describe a
// different set of paths from the one round 2 reads.
describe('a round-2 target after a merge moved the change base', () => {
	it(
		'keeps a file the branch does not change out of the target',
		async () => {
			const { round_one, round_two } = await reach_round_two()

			const scope = review_brief.round_two_scope(round_one, round_two.tree, round_two.base)

			expect(scope.target).not.toContain(SHARED)
			expect(scope.target).not.toContain(FOREIGN)
		},
		TIMEOUT_MS,
	)

	it(
		'covers every file the branch does change',
		async () => {
			const { round_one, round_two } = await reach_round_two()

			const scope = review_brief.round_two_scope(round_one, round_two.tree, round_two.base)

			expect(scope.target).toContain(BRANCH_ONLY)
		},
		TIMEOUT_MS,
	)
})

// The composed text is what the forked agent actually receives, so the properties above are asserted
// there too: naming a file the branch never touched is the symptom the Issue was filed on.
describe('the brief a moved change base composes', () => {
	it(
		'names no file outside the change in the printed brief',
		async () => {
			const { round_one, round_two } = await reach_round_two()

			const block = review_brief.round_two_block(
				round_one,
				round_two.tree,
				fixture.root,
				round_two.base,
			)

			expect(block).not.toContain(SHARED)
			expect(block).toContain(review_brief.BASE_MOVED_PREFIX)
		},
		TIMEOUT_MS,
	)

	// A skip is worse than a mistargeted read, so the same moved base has to make the round due.
	it(
		'requires the second round rather than reading the delta as round 1 fixes',
		async () => {
			const { round_one, round_two } = await reach_round_two()

			const decision = review_round2.decide({
				base: round_two.base,
				is_round_one_closed: true,
				snapshot: round_one,
				tree: round_two.tree,
			})

			expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
			expect(decision.reason).toContain(review_round2.BASE_MOVED_REASON)
		},
		TIMEOUT_MS,
	)
})

// The base is the whole guard, so the run that does not move it must still get the narrow round —
// widening every round 2 would be the cheapest way to pass this suite and would undo #1219.
describe('a round-2 target when the change base did not move', () => {
	it(
		'still names the fix delta when the base did not move',
		async () => {
			const round_one = snapshot_of(await read_round())

			write_file(BRANCH_ONLY, 'fixed')

			const round_two = await read_round()
			const scope = review_brief.round_two_scope(round_one, round_two.tree, round_two.base)

			expect(scope.target).toStrictEqual([BRANCH_ONLY])
		},
		TIMEOUT_MS,
	)

	// The Issue's second acceptance criterion: where the target and `git diff` disagree, say so rather
	// than continue. Round 1's fix reverted `shared.ts`, which takes it out of the change without
	// making it a fix to read, and left `settled.ts` exactly as round 1 read it.
	it(
		'names what left the change and counts what round 1 already read',
		async () => {
			const round_one = snapshot_of(await read_round())

			write_file(SHARED, 'old')
			write_file(BRANCH_ONLY, 'fixed')

			const round_two = await read_round()
			const scope = review_brief.round_two_scope(round_one, round_two.tree, round_two.base)

			expect(scope.target).toStrictEqual([BRANCH_ONLY])
			expect(scope.dropped).toStrictEqual([SHARED])
			expect(scope.carried).toStrictEqual([SETTLED])
		},
		TIMEOUT_MS,
	)
})

describe('the reconciliation the brief prints beside a narrow target', () => {
	it(
		'prints both disagreements rather than passing them over',
		async () => {
			const round_one = snapshot_of(await read_round())

			write_file(SHARED, 'old')
			write_file(BRANCH_ONLY, 'fixed')

			const round_two = await read_round()
			const block = review_brief.round_two_block(
				round_one,
				round_two.tree,
				fixture.root,
				round_two.base,
			)

			expect(block).toContain(review_brief.dropped_line(fixture.root, [SHARED]))
			expect(block).toContain(review_brief.carried_line(fixture.root, round_two.base, 1))
		},
		TIMEOUT_MS,
	)
})
