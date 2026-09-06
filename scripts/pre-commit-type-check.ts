#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { gate_skip } from './gate-skip'
import { gate_tree, type GateTree } from './gate-tree'
import { hook_gate_reuse } from './hook-gate-reuse'
import type { FileMapStamp } from './josh/file-map-stamp'
import { resolve_spawn_exit } from './spawn-exit'
import { DEFAULT_TYPE_CHECK_ARGS, type_check_step } from './type-check-step'

// The pre-commit hook's type check, which no longer re-runs a project-wide `tsc --noEmit` that a green
// gate already covers (joshuafolkken/kit#1381).
//
// Measured on this repository: `pnpm exec tsc --noEmit` over the whole project takes 3.8–4.4s warm, and
// `pnpm josh git -y` pays it on every commit — a `fullrun` commits twice — seconds after `pnpm josh
// gate` printed the same project-wide type check green on the same tree. The pre-commit hook runs its
// commands in parallel, so that one check is what the hook's wall time was.
//
// **It is the one project-wide check left in the hook.** cspell, prettier and eslint there read only
// `{staged_files}`, which is a different scope from the gate's project-wide run and costs 0.3–1.0s each
// in parallel; skipping them would buy about half a second and would trade a narrow reading for a
// recorded wide one. So they are untouched, and so are `prevent-main-commit` and `secretlint`, which
// the gate does not run at all and which are therefore duplicates of nothing.
//
// **The decision is joshuafolkken/kit#1328's, imported rather than restated** — `hook_gate_reuse`
// carries what this shares with the pre-push hook (joshuafolkken/kit#1334) and defers the record
// comparison itself to `gate_skip.reusable_green_gate`. A hook answering "is this still the recorded
// tree" differently from the gate beside it would be two commands disagreeing about one tree.
//
// **What this adds is one condition, and it only ever narrows.** The record describes the **working
// tree**; a commit carries the **index**. Stage half of a green tree and the map still matches while the
// commit being made is a tree no check ever read. So the reuse also requires the index to match the
// working tree — which is what `pnpm josh git` leaves behind once it has staged — and any doubt whatever
// sends the hook back to the full check.

// The escape hatch's name; the shared reading of it is `hook_gate_reuse.is_force_requested`.
const FORCE_ENV = 'JOSH_PRE_COMMIT_FORCE'

const PNPM = 'pnpm'

// Exactly what `lefthook/base.yml` ran before this wrapper existed. **The set of checks is unchanged**:
// what changes is only whether an already-passed check is executed again on an unchanged tree.
const TYPE_CHECK_ARGUMENTS: ReadonlyArray<string> = ['exec', 'tsc', '--noEmit']

// What an argument this command does not take exits with. A type error's own code comes from `tsc`.
const REFUSED_EXIT_CODE = 1

// `process.argv` is [runner, script, ...arguments].
const FIRST_ARGUMENT_INDEX = 2

// The gate's own two readings plus the two this hook adds.
interface CommitTree extends GateTree {
	is_index_matching_worktree: boolean
	is_recorded_check_this_check: boolean
}

// **The record says the gate's four checks were green; it does not say *which* type check ran.**
// `type-check-step.ts` resolves that per project (joshuafolkken/kit#934): a project carrying a
// `josh-app` / `josh-game` shim has the toolkit's `check:ci` as its gate step, and this hook's step is
// `tsc --noEmit`. Reusing across that difference would skip `tsc --noEmit` on the strength of a
// different check — a `.ts` file inside the root `tsconfig.json` but outside the one `svelte-check` is
// pointed at is exactly the error that would then reach a commit.
//
// So the reuse is refused wherever the two are not the same command, and the resolution is asked of
// `type_check_step` rather than re-derived here. **The hook's own command is unchanged either way**:
// what this narrows is only when an identical check is not re-run.
async function is_recorded_check_this_check(start_directory: string): Promise<boolean> {
	const resolved = await type_check_step.resolve_type_check_args(start_directory)

	return resolved.join(' ') === DEFAULT_TYPE_CHECK_ARGS.join(' ')
}

// The readings are independent, so they are started together rather than one after the other.
async function read_commit_tree(start_directory: string = process.cwd()): Promise<CommitTree> {
	const [tree, lines, is_this_check] = await Promise.all([
		gate_tree.read_gate_tree(),
		hook_gate_reuse.read_status_lines(),
		is_recorded_check_this_check(start_directory),
	])

	return {
		...tree,
		is_index_matching_worktree: hook_gate_reuse.is_index_matching_worktree(lines),
		is_recorded_check_this_check: is_this_check,
	}
}

function reusable_green_commit(
	tree: CommitTree,
	extra_arguments: ReadonlyArray<string>,
	source?: string,
): FileMapStamp | undefined {
	if (!tree.is_recorded_check_this_check) return undefined

	return hook_gate_reuse.reusable_green_hook({
		tree,
		is_tree_carried: tree.is_index_matching_worktree,
		extra_arguments,
		force_env: FORCE_ENV,
		source,
	})
}

// **Nothing is forwarded to `tsc`, and an argument is refused rather than dropped.** `tsc --noEmit
// <file>` ignores `tsconfig.json`, so forwarding a path would silently narrow the very check this
// command exists to run in full — and ignoring the argument in silence would look like it had been
// honored. `--force` is the one argument this command takes, and it is consumed here.
function format_refusal(unexpected: ReadonlyArray<string>): string {
	return (
		`✗ josh pre-commit-type-check takes no argument but \`${gate_skip.FORCE_FLAG}\`; ` +
		`refusing ${unexpected.join(' ')}.\n` +
		`  It type-checks the whole project, so a path here would narrow the check rather than scope it.`
	)
}

function format_skip(taken_at: string): string {
	return gate_skip.format_reuse_notice({
		subject: 'the type check',
		carried_clause: ', and this commit carries that same tree',
		taken_at,
		force_hint: `${FORCE_ENV}=1 git commit`,
		rerun_object: 'it',
	})
}

// The exit code is resolved through `spawn-exit.ts` rather than `exitCode ?? 1`, so a spawn that never
// produced a code — `tsc` missing from PATH — is reported as such instead of being reported as a type
// error. Either way it is non-zero and the commit is blocked.
async function run_type_check(): Promise<number> {
	const result = await execa(PNPM, [...TYPE_CHECK_ARGUMENTS], { stdio: 'inherit', reject: false })

	return resolve_spawn_exit(PNPM, result)
}

function unexpected_arguments(extra_arguments: ReadonlyArray<string>): ReadonlyArray<string> {
	return extra_arguments.filter((argument) => argument !== gate_skip.FORCE_FLAG)
}

async function run_pre_commit_type_check(
	extra_arguments: ReadonlyArray<string> = [],
	source?: string,
): Promise<number> {
	const unexpected = unexpected_arguments(extra_arguments)

	if (unexpected.length > 0) {
		process.stderr.write(`${format_refusal(unexpected)}\n`)

		return REFUSED_EXIT_CODE
	}

	const reusable = reusable_green_commit(await read_commit_tree(), extra_arguments, source)

	if (reusable === undefined) return await run_type_check()

	process.stdout.write(`${format_skip(reusable.taken_at)}\n`)

	return 0
}

// `process.exitCode` rather than `process.exit()`: a non-zero code has to block the commit, and exiting
// outright truncates a piped stdout — which for a failing type check is the output that says why.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_pre_commit_type_check(process.argv.slice(FIRST_ARGUMENT_INDEX))
}

const pre_commit_type_check = {
	FORCE_ENV,
	format_refusal,
	format_skip,
	is_recorded_check_this_check,
	read_commit_tree,
	reusable_green_commit,
	run_pre_commit_type_check,
	unexpected_arguments,
}

export type { CommitTree }
export { pre_commit_type_check }
