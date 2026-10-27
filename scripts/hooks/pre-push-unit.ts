#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { core_budget } from '#scripts/gate/core-budget'
import { gate_plan } from '#scripts/gate/gate-plan'
import { gate_skip, type GateReuse } from '#scripts/gate/gate-skip'
import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { hook_gate_reuse } from '#scripts/gate/hook-gate-reuse'
import type { PushMissRecord } from '#scripts/lane/lane-ledger-schema'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { test_unit_guard } from '#scripts/test/test-unit-guard'
import { pre_push_related_switch } from './pre-push-related-switch'

// The pre-push hook's unit run, which does not re-run a suite a green gate already covers: the gate
// writes its record down, and re-running `vitest run` on a tree it just printed green is the bulk of
// what `pnpm josh git -y` would otherwise spend.
//
// **The decision is the gate's, imported rather than restated.** "There is a green
// record and nothing it covers has moved" is one question, and a hook answering it differently from
// the gate beside it would be two commands disagreeing about the same tree — the clone `CLAUDE.md`
// prohibits. So `gate_skip.reusable_green_gate` decides all three of its conditions here too: the
// file map matches, the **base commit** the map is a diff against matches, and the map is non-empty.
//
// **What this hook shares with the pre-commit type check is `hook-gate-reuse.ts`**:
// the escape hatch, the pre-filter in front of the record and the one
// `git status` reading both narrow themselves from. Only the narrowing itself is written here, because
// only it is about a push.
//
// **What this adds is one condition, and it only ever narrows.** A commit changes nothing outside
// this checkout; a push puts code where other people and CI read it, so an unverified commit reaching
// the remote is the failure this must not have. The gate's record describes the **working tree**, and
// a push carries **HEAD** — the same thing only while nothing is uncommitted. Commit half of a green
// tree and the map still matches while the commit being pushed is a tree no check ever read. So the
// reuse also requires a clean working tree, which is exactly what `josh git` leaves behind when it
// commits before pushing, and any doubt whatever sends the hook back to the full suite.
//
// **`audit` is untouched.** The gate does not run it, so it is not a duplicate of anything.

// The escape hatch's name; the shared reading of it is `hook_gate_reuse.is_force_requested`.
const FORCE_ENV = 'JOSH_PRE_PUSH_FORCE'

// The gate's own two readings — the changed-file map and the commit it is a diff against, taken from
// `gate-tree.ts` rather than read a second way here — plus the one this hook adds.
interface PushTree extends GateTree {
	is_clean: boolean
	// What a dirty tree reports as the reason the record was not reused — the
	// paths name a lock file a hook's own `pnpm install` rewrote, the case that went unexplained.
	carry_miss: string
}

function carry_miss(lines: ReadonlyArray<string> | undefined): string {
	if (lines === undefined) return 'git status could not be read'

	return `the working tree differs from HEAD (${lines.join('; ')})`
}

// `git status --porcelain` prints one line per difference from HEAD, untracked files included — so an
// empty output is the whole of "what this push carries is what the record was taken from". Untracked
// files count: the gate's map covers them, and one left behind is content the record was green on
// that the pushed commit does not have. An unreadable status fails toward running the suite, like
// every other read here.
//
// The readings are independent, so they are started together rather than one after the other.
async function read_push_tree(): Promise<PushTree> {
	const [tree, lines] = await Promise.all([
		gate_tree.read_gate_tree(),
		hook_gate_reuse.read_status_lines(),
	])

	return {
		...tree,
		is_clean: hook_gate_reuse.is_worktree_clean(lines),
		carry_miss: carry_miss(lines),
	}
}

// `--force` is the gate's own flag, reused rather than respelled: it and `JOSH_PRE_PUSH_FORCE` are
// one instruction in the two places a person gives it — typing the command, and pushing through the
// hook, whose line carries no flags of its own. It is consumed here rather than forwarded, because
// vitest would refuse it.
function forwarded_arguments(extra_arguments: ReadonlyArray<string>): ReadonlyArray<string> {
	return extra_arguments.filter((argument) => argument !== gate_skip.FORCE_FLAG)
}

// The stamp rather than a boolean, for the same reason `gate_skip` hands one back: the caller prints
// `taken_at`, and a record that does not describe this tree has no timestamp worth printing.
//
// **Any argument at all refuses the reuse**, not only `--force`. Everything else is forwarded to
// vitest, and a caller who narrowed the run to one spec asked for that run rather than for a
// recorded result about a whole tree. The hook's own line passes none, so this costs it nothing.
function push_reuse(
	tree: PushTree,
	extra_arguments: ReadonlyArray<string>,
	source?: string,
): GateReuse {
	return hook_gate_reuse.hook_reuse({
		tree,
		is_tree_carried: tree.is_clean,
		carry_miss: tree.carry_miss,
		extra_arguments,
		force_env: FORCE_ENV,
		source,
	})
}

// **The sentence claims the result, never merely the omission.** "unit tests skipped" reads as "not
// verified", which is the one thing this line must not be mistaken for while the push it precedes
// goes on to the remote. So it says what passed, on which tree, when, and how to run it anyway — in
// the one sentence every reader of the record shares.
function format_skip(taken_at: string): string {
	return gate_skip.format_reuse_notice({
		subject: 'the unit tests',
		carried_clause: ', and this push carries that same tree',
		taken_at,
		force_hint: `${FORCE_ENV}=1 git push`,
		rerun_object: 'them',
	})
}

// The suite is run through the guard `josh test:unit` uses rather than a bare `vitest run`, so a
// project with no vitest prints a skip notice instead of failing the push — the behavior the hook's
// other commands already have. **A project that has vitest and no test file at all fails the push
// instead**: the guard treats that half as a broken state rather than a
// young project, and the hook returns what the guard returns.
// **A fall back to the whole suite says why, in one line**: under a crowded
// machine the suite costs minutes, and a silent miss left a moved merge base, a dirty tree and a
// mismatched record indistinguishable from one another.
function format_miss(reason: string): string {
	return `↻ running the whole unit suite — the green gate record does not cover this push: ${reason}.`
}

// **A unit run claims its place in the core budget, the one `josh test:unit` claims.** Without it a
// push's run went beside other lanes' gates off the ledger, so their admission saw its workers only as
// foreign load (joshuafolkken/kit#3874). Only the miss reserves: a reused record runs nothing, and a
// claim there could make a push wait out a full ledger for a suite it then skips.
async function run_reserved(command: string, run: () => Promise<number>): Promise<number> {
	const claim = gate_plan.DIRECT_UNIT_CLAIM

	return await core_budget.with_command_reservation(claim.core_weight(), run, {
		memory_mb: claim.memory_mb(),
		command,
		is_unit: claim.is_unit_claim,
	})
}

async function run_reserved_suite(vitest_arguments: ReadonlyArray<string>): Promise<number> {
	return await run_reserved(
		'pre-push test:unit',
		async () => await test_unit_guard.run_guarded_unit(process.cwd(), vitest_arguments),
	)
}

// **A push its caller makes ahead of the gate runs the related tests, not the whole suite**
// (joshuafolkken/kit#5067). `josh ship` pushes the tree its sync merged with the default branch onto an
// open pull request so CI starts beside the gate, and the gate that follows runs the whole suite over
// that same tree; the push itself only needs what this branch's change reaches. Only the caller sets
// it, `--force` and the escape hatch still win, and a narrowed run asked for its own arguments rather
// than this scope.
function is_related_requested(extra_arguments: ReadonlyArray<string>): boolean {
	const { SWITCH_ENV_KEY, SWITCH_ON } = pre_push_related_switch

	if (process.env[SWITCH_ENV_KEY] !== SWITCH_ON || extra_arguments.length > 0) return false

	return !hook_gate_reuse.is_force_requested(FORCE_ENV)
}

function format_related(reason: string): string {
	return `↻ running the related unit tests — the push runs ahead of its gate, and the green gate record does not cover it: ${reason}.`
}

// Imported only on this path, so every other push leaves the import graph `test-related.ts` loads alone.
async function run_related(): Promise<number> {
	const { test_related } = await import('#scripts/test/test-related')

	return await run_reserved(
		'pre-push test:related',
		async () => await test_related.run_related_tests([]),
	)
}

// joshuafolkken/kit#5234: the miss's kind goes to the lane ledger, so `lane:stats` counts the suites a
// push ran and why beside the gate's own fallbacks.
async function record_miss(scope: PushMissRecord['scope'], kind: string): Promise<void> {
	await lane_ledger_write.record_push_miss({ scope, reason: kind })
}

async function run_miss(
	reason: string,
	kind: string,
	extra_arguments: ReadonlyArray<string>,
): Promise<number> {
	if (is_related_requested(extra_arguments)) {
		process.stdout.write(`${format_related(reason)}\n`)
		await record_miss('related', kind)

		return await run_related()
	}

	process.stdout.write(`${format_miss(reason)}\n`)
	await record_miss('whole', kind)

	return await run_reserved_suite(forwarded_arguments(extra_arguments))
}

async function run_pre_push_unit(
	extra_arguments: ReadonlyArray<string> = [],
	source?: string,
): Promise<number> {
	const tree = await read_push_tree()
	const reuse = push_reuse(tree, extra_arguments, source)

	if ('miss' in reuse) {
		const kind = hook_gate_reuse.miss_kind(reuse.miss, {
			carry_miss: tree.carry_miss,
			force_env: FORCE_ENV,
		})

		return await run_miss(reuse.miss, kind, extra_arguments)
	}

	process.stdout.write(`${format_skip(reuse.stamp.taken_at)}\n`)

	return 0
}

// `process.exitCode` rather than `process.exit()`: a non-zero code has to block the push, and exiting
// outright truncates a piped stdout — which for a failing suite is the output that says why.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	// `process.argv` is [runner, script, ...arguments].
	const FIRST_ARGUMENT_INDEX = 2

	process.exitCode = await run_pre_push_unit(process.argv.slice(FIRST_ARGUMENT_INDEX))
}

const pre_push_unit = {
	FORCE_ENV,
	run_pre_push_unit,
}

export { pre_push_unit }
