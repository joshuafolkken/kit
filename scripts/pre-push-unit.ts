#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { gate_skip } from './gate-skip'
import { gate_tree, type GateTree } from './gate-tree'
import { git_command } from './git/git-command'
import type { FileMapStamp } from './josh/file-map-stamp'
import { test_unit_guard } from './test-unit-guard'

// The pre-push hook's unit run, which no longer re-runs a suite a green gate already covers
// (joshuafolkken/kit#1334).
//
// Measured on joshuafolkken/kit#1326: `pnpm josh git -y` took 40 seconds, 15.9 of them the pre-push
// `vitest run` — started 40 seconds after `pnpm josh gate` had printed all four checks green on that
// same tree, with nothing edited in between. The gate had written the record down and the hook was
// the one reader that never looked at it.
//
// **The decision is joshuafolkken/kit#1328's, imported rather than restated.** "There is a green
// record and nothing it covers has moved" is one question, and a hook answering it differently from
// the gate beside it would be two commands disagreeing about the same tree — the clone `CLAUDE.md`
// prohibits. So `gate_skip.reusable_green_gate` decides all three of its conditions here too: the
// file map matches, the **base commit** the map is a diff against matches, and the map is non-empty.
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

// The escape hatch, for the times a person knows something outside the tree moved — a `pnpm install`,
// a toolchain change, a cache thrown away. An environment variable rather than the gate's `--force`
// flag because the hook's command line belongs to `lefthook/base.yml`: nobody types this invocation,
// so a flag would be unreachable at the moment it is wanted.
const FORCE_ENV = 'JOSH_PRE_PUSH_FORCE'

// The gate's own two readings — the changed-file map and the commit it is a diff against, taken from
// `gate-tree.ts` rather than read a second way here — plus the one this hook adds.
interface PushTree extends GateTree {
	is_clean: boolean
}

// `git status --porcelain` prints one line per difference from HEAD, untracked files included — so an
// empty output is the whole of "what this push carries is what the record was taken from". Untracked
// files count: the gate's map covers them, and one left behind is content the record was green on
// that the pushed commit does not have.
//
// An unreadable status fails toward running the suite, like every other read here: a git command that
// could not be run says nothing about the tree, and "we could not tell" must never resolve to "no
// need to check".
async function read_is_clean(): Promise<boolean> {
	try {
		const status = await git_command.status()

		return status.trim() === ''
	} catch {
		return false
	}
}

// The readings are independent, so they are started together rather than one after the other.
async function read_push_tree(): Promise<PushTree> {
	const [tree, is_clean] = await Promise.all([gate_tree.read_gate_tree(), read_is_clean()])

	return { ...tree, is_clean }
}

// Any value at all, empty string aside: this is read from a shell, where `JOSH_PRE_PUSH_FORCE=1` and
// `JOSH_PRE_PUSH_FORCE=true` are the two spellings a person reaches for and neither should be the one
// that silently does nothing.
function is_force_requested(): boolean {
	return (process.env[FORCE_ENV] ?? '') !== ''
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
function reusable_green_push(
	tree: PushTree,
	extra_arguments: ReadonlyArray<string>,
	source?: string,
): FileMapStamp | undefined {
	if (extra_arguments.length > 0 || is_force_requested() || !tree.is_clean) return undefined

	return gate_skip.reusable_green_gate(tree.files, tree.base, source)
}

// **The sentence claims the result, never merely the omission.** "unit tests skipped" reads as "not
// verified", which is the one thing this line must not be mistaken for while the push it precedes
// goes on to the remote. So it says what passed, on which tree, when, and how to run it anyway.
function format_skip(taken_at: string): string {
	return (
		`✔ this tree is already green — the unit tests passed on it at ${taken_at} ` +
		`(\`pnpm josh gate\`), and this push carries that same tree.\n` +
		`  Reusing that result; nothing was re-run. \`${FORCE_ENV}=1 git push\` runs them anyway.`
	)
}

// The suite is run through the guard `josh test:unit` uses rather than a bare `vitest run`, so a
// project with no vitest or no test files prints a skip notice instead of failing the push — the
// behavior the hook's other commands already have.
async function run_pre_push_unit(
	extra_arguments: ReadonlyArray<string> = [],
	source?: string,
): Promise<number> {
	const reusable = reusable_green_push(await read_push_tree(), extra_arguments, source)

	if (reusable === undefined) {
		return await test_unit_guard.run_guarded_unit(
			process.cwd(),
			forwarded_arguments(extra_arguments),
		)
	}

	process.stdout.write(`${format_skip(reusable.taken_at)}\n`)

	return 0
}

// `process.argv` is [runner, script, ...arguments].
const FIRST_ARGUMENT_INDEX = 2

// `process.exitCode` rather than `process.exit()`: a non-zero code has to block the push, and exiting
// outright truncates a piped stdout — which for a failing suite is the output that says why.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_pre_push_unit(process.argv.slice(FIRST_ARGUMENT_INDEX))
}

const pre_push_unit = {
	FORCE_ENV,
	format_skip,
	forwarded_arguments,
	is_force_requested,
	read_push_tree,
	reusable_green_push,
	run_pre_push_unit,
}

export type { PushTree }
export { pre_push_unit }
