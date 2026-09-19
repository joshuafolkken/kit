import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { git_stash, type Selection } from '#scripts/git/git-stash'
import { git_worktree } from '#scripts/git/git-worktree'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_close } from './lane-close'
import { lane_install } from './lane-install'
import { lane_open, type OpenOutcome } from './lane-open'
import { lane_paths } from './lane-paths'
import { lane_registry, type LaneInfo } from './lane-registry'

// Two lanes, open at the same time, in one real repository — the case every lane defect so far has
// been an instance of, and the one no suite covered.
//
// **What was missing.** `lane-open.test.ts`, `lane-close.test.ts` and `lane-registry.test.ts` mock
// git outright: `worktree add` is a bare `mkdirSync`, `worktree list` is hand-written porcelain text,
// and the "two lanes" they reason about are fabricated `LaneInfo` objects. `lane-open-start-point`
// drives real git but opens one lane. `git-stash.test.ts` and `stash-pop-cli.test.ts` are pure. So
// every property that only exists *between* two live lanes — a seat neither can take twice, the port
// pair that follows from it, a head and index one lane cannot move for the other, a stash stack they
// share whether they like it or not — was asserted against this suite's own fixtures, never git.
//
// **What is real here.** `git init`, the base commit, `git worktree add` (through `lane_open`), the
// lane `.env` write, the seat lock, `git worktree list` discovery, `git add` inside a lane,
// the staged-file read, `git rev-parse`, `git stash push`, `git stash pop`, and `lane_close`'s
// work-tree and branch removal. Both lanes are opened in one `Promise.all`, so the seat claim is
// exercised with the
// two opens genuinely interleaved rather than one after the other.
//
// **Which seat each lane wins is not asserted, because the race decides it.** Both orders were
// observed while writing this file. What is asserted is what a race cannot make untrue without a
// defect: the two seats differ, and each lane's ports are the ones *its own* seat resolves to — a
// set of ports would have let the two lanes swap theirs and stay green.
//
// **What is stubbed, and why it is not the subject.** Three calls, the same three
// `lane-open-start-point.test.ts` stubs and for the same reasons:
//
// - `lane_install.install_dependencies` runs a real `pnpm install --frozen-lockfile` with no skip
//   seam of any kind. The fixture repository has no manifest and no lockfile, so the install could
//   only fail — on a manifest that was never what this test is about.
// - `git_worktree.ls_remote_branch` and `git_command.fetch_branch` reach the network, which the unit
//   network guard refuses by design, and the fixture has no remote to ask. `fetch_branch` carries no
//   timeout of its own, so leaving it live would hang the gate on a machine whose global git config
//   resolves `origin` somewhere real.
//
// **What this file does NOT cover, stated rather than implied.** It does not run two lanes in two
// operating-system processes: production dispatches a lane child as its own process, and this suite
// interleaves two `open_lane` calls inside one. A cross-process test cannot be written against the
// code as it stands, because the only seam that lets a lane open without a real `pnpm install` is a
// `vi.spyOn` inside the test process. It also does not start an agent CLI, does not run a
// verification gate inside a lane, and does not cover cache seeding beyond the fact that opening a
// lane did not throw.

const TIMEOUT_MS = 30_000
const PRIMARY = 'primary'
const BASE_FILE = 'base.txt'
const FIRST_ISSUE = '7001'
const SECOND_ISSUE = '7002'
const OPENED = 'opened'
const PARKED_FILE = 'parked.txt'
const SEAT_LOCK_DIR = '.seat-locks'
// `ports/index.js`: a lane's ports are the base plus its seat, with a root `.env` absent counting as
// seed 0 — which is the fixture's state.
const DEV_PORT_BASE = 5173
const PREVIEW_PORT_BASE = 4173
const WORKTREE_LIST_ARGUMENTS: ReadonlyArray<string> = ['worktree', 'list', '--porcelain']
// The index itself, not `status`: every lane carries an untracked `.env` of its own, so a porcelain
// status is never empty and would say nothing about whether the two lanes share an index.
const STAGED_ARGUMENTS: ReadonlyArray<string> = ['diff', '--cached', '--name-only']
const HEAD_ARGUMENTS: ReadonlyArray<string> = ['rev-parse', '--abbrev-ref', 'HEAD']

interface TwoLanes {
	repository_root: string
	first: LaneInfo
	second: LaneInfo
}

// Two holders rather than module-level bindings: `unicorn/no-top-level-assignment-in-function`
// refuses a hook assigning to a top-level `let`. The workspace is held apart from the lanes so that
// a `beforeEach` failing *after* the workspace exists still has something to tear down.
const workspace: { current: FixtureWorkspace | undefined } = { current: undefined }
const state: { current: TwoLanes | undefined } = { current: undefined }

// Throws rather than handing back a half-built fixture: a test that ran without its two lanes must
// fail as a failure, not assert against `undefined`.
function lanes(): TwoLanes {
	if (state.current === undefined) throw new Error('the two-lane fixture was not opened')

	return state.current
}

// The message a parked lane child pushes its stash under, per `backlogrun-park.md`. The message is
// the only thing that attributes an entry to a lane — there is no per-lane ref or namespace.
function park_message(issue: string): string {
	return `backlogrun: parked #${issue}`
}

function opened_lane(outcome: OpenOutcome): LaneInfo {
	if (outcome.kind !== OPENED) throw new Error(`lane was not opened: ${outcome.kind}`)

	return outcome.lane
}

function selected_selector(selection: Selection): string {
	if (selection.kind !== 'match') throw new Error(`stash selection was ${selection.kind}`)

	return selection.selector
}

// Per lane, not across the pair: the two lanes swapping the `.env` they were built from leaves any
// set-of-ports assertion green and this one red.
function ports_match_seat(lane: LaneInfo): boolean {
	if (lane.seat === undefined) return false

	return (
		lane.development_port === DEV_PORT_BASE + lane.seat &&
		lane.preview_port === PREVIEW_PORT_BASE + lane.seat
	)
}

// Throws on an absent directory rather than reading it as "no locks held". Releasing a seat removes
// only its own `seat-N` entry and leaves the parent behind, so the parent missing means this name
// drifted from the one `lane-open.ts` claims seats under — and an empty answer would then be a pass
// this test did not earn.
function held_seat_locks(lane: LaneInfo): ReadonlyArray<string> {
	const directory = path.join(path.dirname(lane.directory), SEAT_LOCK_DIR)

	if (!existsSync(directory)) throw new Error(`no seat lock directory at ${directory}`)

	return readdirSync(directory)
}

async function park_change(directory: string, issue: string): Promise<void> {
	writeFileSync(path.join(directory, PARKED_FILE), issue)
	await git_fixture_workspace.git(directory, ['stash', 'push', '-u', '-m', park_message(issue)])
}

async function park_both_lanes(): Promise<void> {
	const { first, second } = lanes()

	await park_change(first.directory, FIRST_ISSUE)
	await park_change(second.directory, SECOND_ISSUE)
}

function stub_what_the_fixture_cannot_do(): void {
	vi.spyOn(lane_install, 'install_dependencies').mockResolvedValue({
		is_installed: true,
		output: '',
	})
	vi.spyOn(git_worktree, 'ls_remote_branch').mockResolvedValue('')
	vi.spyOn(git_command, 'fetch_branch').mockResolvedValue('')
}

async function build_repository(root: string): Promise<void> {
	const workspace_directory = path.dirname(root)

	await git_fixture_workspace.git(workspace_directory, [
		'init',
		git_fixture_workspace.MAIN_BRANCH,
		PRIMARY,
	])
	writeFileSync(path.join(root, BASE_FILE), 'base\n')
	await git_fixture_workspace.git(root, ['add', BASE_FILE])
	await git_fixture_workspace.git(root, ['commit', '-m', 'base'])
}

// One `Promise.all`, so the two opens interleave at their await points and both reach the seat claim
// before either has written its `.env`.
async function open_both_lanes(): Promise<[LaneInfo, LaneInfo]> {
	const [first, second] = await Promise.all([
		lane_open.open_lane(FIRST_ISSUE),
		lane_open.open_lane(SECOND_ISSUE),
	])

	return [opened_lane(first), opened_lane(second)]
}

beforeEach(async () => {
	workspace.current = git_fixture_workspace.open_workspace('lane-concurrency-')

	const repository_root = path.join(workspace.current.workspace, PRIMARY)

	await build_repository(repository_root)
	// Blank counts as unset, so the lane root is the default sibling of the fixture repository and the
	// lanes land inside the workspace. Stubbed rather than deleted so it is restored afterwards.
	vi.stubEnv(lane_paths.LANE_ROOT_KEY, '')
	process.chdir(repository_root)
	stub_what_the_fixture_cannot_do()

	const [first, second] = await open_both_lanes()

	state.current = { first, repository_root, second }
}, TIMEOUT_MS)

// Unguarded on purpose. A `beforeEach` that failed — which is what this file *doing its job* looks
// like — must still leave the process's directory, environment, spies and temp tree as it found
// them, or the failure spreads to every later file in the same worker.
afterEach(async () => {
	const opened = workspace.current

	state.current = undefined
	workspace.current = undefined
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	if (opened !== undefined) await git_fixture_workspace.close_workspace(opened)
}, TIMEOUT_MS)

describe('two lanes opened at the same time', () => {
	it(
		'gives each lane its own seat, branch and work tree, and releases both seat locks',
		() => {
			const { first, second } = lanes()

			expect(first.seat).not.toBe(second.seat)
			expect([first.branch, second.branch]).toEqual([`${FIRST_ISSUE}-lane`, `${SECOND_ISSUE}-lane`])
			expect(existsSync(first.directory)).toBe(true)
			expect(existsSync(second.directory)).toBe(true)
			expect(held_seat_locks(first)).toEqual([])
		},
		TIMEOUT_MS,
	)

	it(
		'gives each lane the ports its own seat resolves to',
		() => {
			const { first, second } = lanes()

			expect(ports_match_seat(first)).toBe(true)
			expect(ports_match_seat(second)).toBe(true)
			expect(first.development_port).not.toBe(second.development_port)
			expect(first.preview_port).not.toBe(second.preview_port)
		},
		TIMEOUT_MS,
	)
})

describe('what git and the lane registry see', () => {
	it(
		'reads both lanes back with the seat and ports each one was handed',
		async () => {
			const { first, repository_root, second } = lanes()
			const listing = await git_fixture_workspace.git(repository_root, WORKTREE_LIST_ARGUMENTS)
			const listed = await lane_registry.list_lanes()
			const seats = new Map(listed.map((lane) => [lane.issue, lane.seat]))

			expect(listing).toContain(first.directory)
			expect(listing).toContain(second.directory)
			expect(seats.get(FIRST_ISSUE)).toBe(first.seat)
			expect(seats.get(SECOND_ISSUE)).toBe(second.seat)
			expect(listed.filter((lane) => ports_match_seat(lane))).toHaveLength(2)
		},
		TIMEOUT_MS,
	)
})

describe('the head and index each lane holds', () => {
	// Not "two directories are two directories" — that is a property of the filesystem and would stay
	// green if `worktree add` were a `mkdirSync`. Staging inside one lane is what a shared index would
	// make visible in the other, which is the shape joshuafolkken/kit#1530 already found once.
	it(
		'keeps work staged in one lane out of the other, on its own branch',
		async () => {
			const { first, second } = lanes()

			writeFileSync(path.join(first.directory, BASE_FILE), FIRST_ISSUE)
			await git_fixture_workspace.git(first.directory, ['add', BASE_FILE])

			expect(await git_fixture_workspace.git(first.directory, STAGED_ARGUMENTS)).toBe(BASE_FILE)
			expect(await git_fixture_workspace.git(second.directory, STAGED_ARGUMENTS)).toBe('')
			expect(await git_fixture_workspace.git(first.directory, HEAD_ARGUMENTS)).toBe(first.branch)
			expect(await git_fixture_workspace.git(second.directory, HEAD_ARGUMENTS)).toBe(second.branch)
		},
		TIMEOUT_MS,
	)
})

describe('closing one of two open lanes', () => {
	it(
		'leaves the other lane whole',
		async () => {
			const { first, second } = lanes()
			const outcome = await lane_close.close_lane(FIRST_ISSUE)
			const remaining = await lane_registry.list_lanes()

			expect(outcome.kind).toBe('closed')
			expect(existsSync(first.directory)).toBe(false)
			expect(existsSync(second.directory)).toBe(true)
			expect(remaining.map((lane) => lane.issue)).toEqual([SECOND_ISSUE])
			expect(remaining.map((lane) => lane.seat)).toEqual([second.seat])
			// Closing a lane deletes its own branch, so a defect deleting both would leave the issue
			// and seat readings above unchanged and only this one red.
			expect(remaining.map((lane) => lane.branch)).toEqual([second.branch])
		},
		TIMEOUT_MS,
	)
})

describe('the stash stack two lanes share', () => {
	// The premise of joshuafolkken/kit#2050, asserted rather than assumed: the stack is one stack, and
	// the lane that parked last owns its top. A positional pop from the first lane would take the
	// second lane's work into the first lane's tree. Matched through the production rule rather than
	// `toContain`, so the `': '` anchoring is what is being fixed here too.
	it(
		'puts the lane that parked last on top of the stack both lanes see',
		async () => {
			const { first } = lanes()

			await park_both_lanes()

			const [top, beneath] = await git_stash.list(first.directory)

			expect(git_stash.matches(top?.subject ?? '', park_message(SECOND_ISSUE))).toBe(true)
			expect(git_stash.matches(beneath?.subject ?? '', park_message(FIRST_ISSUE))).toBe(true)
		},
		TIMEOUT_MS,
	)

	it(
		'pops a lane its own parked work, not the work the other lane parked later',
		async () => {
			const { first, second } = lanes()

			await park_both_lanes()

			const entries = await git_stash.list(first.directory)
			const selection = git_stash.select(entries, park_message(FIRST_ISSUE))

			await git_stash.pop(selected_selector(selection), first.directory)

			expect(readFileSync(path.join(first.directory, PARKED_FILE), 'utf8')).toBe(FIRST_ISSUE)
			expect(existsSync(path.join(second.directory, PARKED_FILE))).toBe(false)
			expect(await git_stash.list(first.directory)).toHaveLength(1)
		},
		TIMEOUT_MS,
	)
})

describe('a message no lane parked under', () => {
	// The refusal is paired with the match on the same entries, so a matcher that answered `none` to
	// everything could not pass this by refusing.
	it(
		'is refused, while the message that was parked still resolves',
		async () => {
			const { first } = lanes()

			await park_change(first.directory, FIRST_ISSUE)

			const entries = await git_stash.list(first.directory)

			expect(git_stash.select(entries, park_message(FIRST_ISSUE)).kind).toBe('match')
			expect(git_stash.select(entries, park_message(SECOND_ISSUE))).toEqual({ kind: 'none' })
		},
		TIMEOUT_MS,
	)
})
