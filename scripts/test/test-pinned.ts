import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_spawn } from '#scripts/git/git-spawn'
import { review_code_tree } from '#scripts/review/review-code-tree'
import { test_pinned_cache, type LoadedCache, type Reached } from './test-pinned-cache'
import { test_pinned_cache_logic, type Known, type Recheck } from './test-pinned-cache-logic'
import { test_pinned_emit } from './test-pinned-emit'
import { test_pinned_functions } from './test-pinned-functions'
import type { PinnedOrigin } from './test-pinned-ledger'
import {
	test_pinned_logic,
	type Hunk,
	type HunkOutcome,
	type PinnedReport,
} from './test-pinned-logic'
import { test_pinned_probe, type CheckOptions, type Probe } from './test-pinned-probe'
import { test_pinned_reach, type Reach } from './test-pinned-reach'
import type { Staged } from './test-pinned-stage'
import { test_red } from './test-red'
import type { RedProbe } from './test-red-logic'

// `josh test:pinned` (joshuafolkken/kit#4516) — put each changed hunk of a non-test code file back to
// the merge-base's lines, one at a time, run that file's related tests, and list the hunks no test went
// red on: the "reverting it stays green" finding a review used to stop a lane on.
//
// **The reverts happen in a detached worktree at HEAD, never the caller's checkout** (`base-tree.ts`).
// The changed files are copied in from the working tree first, so what is reverted is the change as it
// stands, committed or not, and each hunk's file is restored before the next one runs.

const HEAD = 'HEAD'

interface StubRead {
	hunks: ReadonlyArray<Hunk>
	unparsed: ReadonlyArray<string>
}

// `rewired` counts the changed hunks left out as a rewire (`test-pinned-rewire.ts`).
interface ProbeRead extends StubRead {
	rewired: number
}

interface RunOptions {
	max_hunks: number
	is_cached_only: boolean
	is_first_unpinned?: boolean
	rewired?: number
	origin?: PinnedOrigin | undefined
}

// One run's probing: the checked hunks, what the cache knows of each, and the cache they are written to.
interface ProbeRun {
	hunks: ReadonlyArray<Hunk>
	known: ReadonlyArray<Known>
	cache: LoadedCache
	keys: ReadonlyArray<string>
	options: RunOptions
}

// Each hunk's verdict, and how many of the fresh probes ran in stages.
interface Verdicts {
	verdicts: Array<RedProbe | undefined>
	staged: Staged
}

const NO_OUTCOME: HunkOutcome = { unpinned: [], stopped: [] }
const NO_REPORT = { ...NO_OUTCOME, unchecked: [], unparsed: [] } as const

// `--diff-filter=M`: an added file's one hunk is the whole file, and reverting it is a missing module
// every importer fails on, which says nothing about the tests — its functions are probed instead
// (`stub_hunks_of`). The prefixes are pinned: a user's `diff.mnemonicPrefix` writes `+++ w/<file>`,
// which would read as no hunk at all.
async function read_hunks(base: string, files: ReadonlyArray<string>): Promise<Array<Hunk>> {
	if (files.length === 0) return []
	const diff_args = ['diff', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=M']
	const prefix_args = ['--src-prefix=a/', '--dst-prefix=b/', base, '--']

	return test_pinned_logic.parse_hunks(
		await git_spawn.read([...diff_args, ...prefix_args, ...files]),
	)
}

// The key of each hunk, read off the working file its lines sit in now.
async function keys_of(hunks: ReadonlyArray<Hunk>): Promise<Array<string>> {
	const contents = await Promise.all(hunks.map(async (hunk) => await readFile(hunk.file, 'utf8')))

	return test_pinned_cache_logic.distinct(
		hunks.map((hunk, index) => test_pinned_cache_logic.hunk_key(hunk, contents[index] ?? '')),
	)
}

// The verdict the cache already holds; one left to recheck holds none yet.
function held_of(known: Known): RedProbe | undefined {
	return test_pinned_cache_logic.is_recheck(known) ? undefined : known
}

function recheck_of(known: Known): Recheck | undefined {
	return test_pinned_cache_logic.is_recheck(known) ? known : undefined
}

// The hunks no held verdict covers, each with its recheck where the cache named one.
function probes_of(hunks: ReadonlyArray<Hunk>, known: ReadonlyArray<Known>): Array<Probe> {
	return hunks
		.map((hunk, index) => ({ hunk, index, recheck: recheck_of(known[index]) }))
		.filter((probe) => held_of(known[probe.index]) === undefined)
}

// The probes in the order they run: the fewest tests reached first (`test_pinned_logic.by_reach`),
// each file's count read once and carried on its probes, which a wide one runs in stages by
// (`test-pinned-stage.ts`); a file with no graph to read counts as 0.
async function by_reach(probes: ReadonlyArray<Probe>, reach: Reach): Promise<Array<Probe>> {
	const files = test_pinned_cache_logic.distinct(probes.map((probe) => probe.hunk.file))
	const related = await Promise.all(files.map(async (file) => await reach.related(file)))
	const counts = new Map(files.map((file, index) => [file, related[index]?.length ?? 0]))
	const counted = probes.map((probe) => ({ ...probe, reach: counts.get(probe.hunk.file) }))

	return test_pinned_logic.by_reach(counted, counts)
}

function reached_of(verdicts: ReadonlyArray<RedProbe | undefined>): Array<Reached> {
	return verdicts.flatMap((verdict, index) => (verdict === undefined ? [] : [[index, verdict]]))
}

// The fresh run's options: the hunks the cache held, then the run's own.
function check_options(held: number, options: RunOptions): CheckOptions {
	return {
		held,
		rewired: options.rewired ?? 0,
		is_first_unpinned: options.is_first_unpinned === true,
		origin: options.origin,
	}
}

// Each hunk's verdict: the cached one where it still holds, else a fresh run's, in the hunks' order.
// The held ones are written first and each fresh one as it is reached (`test_pinned_cache.writer`).
// Under `is_first_unpinned` a hunk the run stopped before keeps no verdict.
async function verdicts_on(paths: ReadonlyArray<string>, probing: ProbeRun): Promise<Verdicts> {
	const verdicts = probing.known.map((entry) => held_of(entry))
	const reached = reached_of(verdicts)
	const probes = await by_reach(probes_of(probing.hunks, probing.known), probing.cache.reach)
	const writer = test_pinned_cache.writer(probing.cache, probing.keys)
	const options = check_options(reached.length, probing.options)

	await writer.record(reached)
	const checked = await test_pinned_probe.checked_on(
		paths,
		probes,
		async (index, verdict) => {
			verdicts[index] = verdict
			await writer.record([[index, verdict]])
		},
		options,
	)

	return { verdicts, staged: checked.staged }
}

function outcome_of(
	hunks: ReadonlyArray<Hunk>,
	verdicts: ReadonlyArray<RedProbe | undefined>,
): HunkOutcome {
	const is_held = verdicts.every((verdict) => verdict !== undefined)

	return { ...test_pinned_logic.outcome(hunks, verdicts), is_held }
}

// The hunks a run probed and stopped before (`is_first_unpinned`); none, no `cut` key.
function cut_of(
	hunks: ReadonlyArray<Hunk>,
	verdicts: ReadonlyArray<RedProbe | undefined>,
): Pick<HunkOutcome, 'cut'> {
	const cut = hunks.filter((_hunk, index) => verdicts[index] === undefined)

	return cut.length === 0 ? {} : { cut }
}

// A fresh cached verdict is reused without a run (`test-pinned-cache.ts`); every hunk's verdict is
// stored again, so a rerun on the same tree starts no vitest. `is_cached_only` runs no probe: only the
// verdicts the cache holds are read, and nothing is written.
async function outcome_on(
	base: string,
	paths: ReadonlyArray<string>,
	hunks: ReadonlyArray<Hunk>,
	options: RunOptions,
): Promise<HunkOutcome> {
	if (hunks.length === 0) return NO_OUTCOME
	const cache = await test_pinned_cache.load(base, hunks)
	const keys = await keys_of(hunks)
	const known = await test_pinned_cache.known(
		cache,
		keys,
		hunks.map((hunk) => hunk.file),
	)

	if (options.is_cached_only) {
		return outcome_of(
			hunks,
			known.map((entry) => held_of(entry)),
		)
	}

	const { verdicts, staged } = await verdicts_on(paths, { hunks, known, cache, keys, options })

	return { ...outcome_of(hunks, verdicts), ...cut_of(hunks, verdicts), staged }
}

// A target the base's tree does not hold is added — committed on the branch or still untracked.
async function added_scripts(base: string, targets: ReadonlyArray<string>): Promise<Array<string>> {
	const held = new Set(await changed_paths.read_held_at(base, targets))

	return targets.filter((file) => !held.has(file) && test_pinned_functions.is_script(file))
}

// Without `typescript` (an optional peer in a consumer) no function can be read, so every added file
// is reported unchecked rather than passed as pinned.
async function stub_hunks_of(added: ReadonlyArray<string>): Promise<StubRead> {
	const api = review_code_tree.load_typescript(process.cwd())
	if (api === undefined) return { hunks: [], unparsed: added }
	const contents = await Promise.all(added.map(async (file) => await readFile(file, 'utf8')))
	const hunks = added.flatMap((file, index) =>
		test_pinned_functions.stub_hunks(api, file, contents[index] ?? ''),
	)

	return { hunks, unparsed: [] }
}

// A changed hunk whose revert emits the same JavaScript, or a rewire, is dropped before the cap
// (`test-pinned-emit.ts`), so neither is `unchecked`; without `typescript` every hunk is kept, so the
// run checks more rather than less.
async function runtime_hunks(hunks: ReadonlyArray<Hunk>): Promise<ProbeRead> {
	const api = review_code_tree.load_typescript(process.cwd())
	if (api === undefined) return { hunks: [...hunks], unparsed: [], rewired: 0 }
	const contents = await Promise.all(hunks.map(async (hunk) => await readFile(hunk.file, 'utf8')))

	return { ...test_pinned_emit.probed_of(api, hunks, contents), unparsed: [] }
}

async function read_probes(base: string, targets: ReadonlyArray<string>): Promise<ProbeRead> {
	const stubs = await stub_hunks_of(await added_scripts(base, targets))
	const changed = await runtime_hunks(await read_hunks(base, targets))
	const hunks = [...changed.hunks, ...stubs.hunks]

	return { hunks, unparsed: stubs.unparsed, rewired: changed.rewired }
}

// The work tree's files that differ from `commit`, deleted ones dropped. Read since `HEAD` they are
// what the worktree at `HEAD` needs copied in to hold the work tree — a conflicted merge's incoming
// files included; read since the change base they are this branch's own change.
async function existing_since(commit: string): Promise<Array<string>> {
	const changed = await changed_paths.read_changed_since(commit)

	return changed.filter((file) => existsSync(file))
}

async function report_on(
	base: string,
	options: RunOptions,
	has_runner: boolean,
): Promise<PinnedReport> {
	const { max_hunks } = options
	const paths = await existing_since(HEAD)
	const changed = await existing_since(base)
	const targets = await test_pinned_reach.probed_files(
		changed.filter((file) => test_pinned_logic.is_target(file)),
	)
	const probes = await read_probes(base, targets)
	const { checked, unchecked } = test_pinned_logic.split(probes.hunks, has_runner ? max_hunks : 0)
	const outcome = await outcome_on(base, paths, checked, { ...options, rewired: probes.rewired })

	return { ...outcome, unchecked, unparsed: probes.unparsed, max_hunks, has_runner }
}

async function report(options: RunOptions): Promise<PinnedReport> {
	const base = await change_base.resolved_through_merge()
	const has_runner = test_red.has_runner()
	if (base === undefined) return { ...NO_REPORT, max_hunks: options.max_hunks, has_runner }

	return await report_on(base, options, has_runner)
}

// No merge-base (not a repository, no default branch) checks nothing, as `josh test:red` does. The cap
// is shared: changed hunks first, then the added files' functions. Without Vitest (a consumer that has
// none) no probe runs, so every one is unchecked rather than unpinned. `is_first_unpinned` starts no
// probe once one is unpinned (joshuafolkken/kit#5153): the hunks left are reported `cut`. `origin` is
// what started the run, for its ledger row.
async function run(
	max_hunks: number,
	is_first_unpinned = false,
	origin?: PinnedOrigin,
): Promise<PinnedReport> {
	return await report({ max_hunks, is_cached_only: false, is_first_unpinned, origin })
}

// The unpinned hunks the cache already answers for this tree, probing nothing (joshuafolkken/kit#4936):
// what a check still running — or one stopped mid-way — has reached for the hunks that did not move.
async function cached(max_hunks: number): Promise<PinnedReport> {
	return await report({ max_hunks, is_cached_only: true })
}

// The cached report when the cache holds every checked hunk's verdict for this tree, probing nothing
// (joshuafolkken/kit#5078); `undefined` when a hunk moved or was never probed, so the caller probes.
async function held_report(max_hunks: number): Promise<PinnedReport | undefined> {
	const read = await cached(max_hunks)

	return read.is_held === true ? read : undefined
}

const test_pinned = { cached, held_report, run }

export { test_pinned }
