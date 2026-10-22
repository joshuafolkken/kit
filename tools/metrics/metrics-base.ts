import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { base_tree } from '#scripts/git/base-tree'
import { change_base } from '#scripts/git/change-base'
import { git_command } from '#scripts/git/git-command'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { git_spawn } from '#scripts/git/git-spawn'
import { resolve_tsx_runner } from '#scripts/josh/josh-logic'
import { file_reader } from '#scripts/lib/read-file'
import { release_approval_prune } from '#scripts/release/release-approval-prune'
import { execa } from 'execa'
import { metrics_base_cache, type CachedReading } from './metrics-base-cache'
import type { Metrics } from './metrics-logic'
import { metrics_ratchet, type Approval } from './metrics-ratchet'

// What `josh metrics` holds the totals to: the same totals measured on the merge-base, and the
// approvals recorded beside them (`metrics-ratchet.ts` is the comparison).
//
// **The merge-base is measured, by this checkout's own command, in a throwaway tree at that commit**
// (`base-tree.ts`). The same ruler on both trees is what makes the difference this branch's growth: a
// change to how a total is counted moves both sides, so it never reads as growth of its own.
//
// **A merge in progress is measured against the base its commit will have**
// (`change_base.resolved_through_merge`): the tree already holds what the default branch brought in,
// so the merge-base of `HEAD` alone would count all of it as this branch's growth.
//
// **`JOSH_METRICS_BASE` names the commit where the merge-base cannot be asked for.** CI checks a pull
// request out as a shallow merge commit with no default-branch ref beside it; its first parent is the
// default branch's tip, and the workflow names it. A name that does not resolve is an error rather
// than "nothing to compare" — that reading would turn the ratchet off in the one place nobody watches.
//
// **An approval is one file per issue** — `.josh/metrics-accepted/<N>.json` — so two pull requests
// never write the same file, and the reason and the date stay readable on the default branch until
// the next release drops it (`release-approval-prune.ts`).

const BASE_VARIABLE = 'JOSH_METRICS_BASE'
// Peels a tag to the commit it names and refuses anything that is not one.
const COMMIT_PEEL = '^{commit}'
const { APPROVAL_DIRECTORY } = release_approval_prune
const APPROVAL_EXTENSION = '.json'
const TREE_PREFIX = 'josh-metrics-base-'
const JSON_FLAG = '--json'
const COMMAND_SCRIPT = fileURLToPath(new URL('metrics-command.ts', import.meta.url))
// The checkout `COMMAND_SCRIPT` belongs to — the ruler the cache is keyed on.
const RULER_ROOT = fileURLToPath(new URL('../..', import.meta.url))

interface Reading {
	metrics: Metrics
	// Every approval file's text by file name.
	approvals: ReadonlyMap<string, string>
}

// `undefined` only where no commit was named and git has no merge-base to give — not a repository, no
// default branch.
async function resolve_commit(): Promise<string | undefined> {
	const named = process.env[BASE_VARIABLE] ?? ''

	if (named.length === 0) return await change_base.resolved_through_merge()

	try {
		return await git_spawn.read(['rev-parse', '--verify', `${named}${COMMIT_PEEL}`])
	} catch {
		throw new Error(`josh metrics: ${BASE_VARIABLE}=${named} names no commit in this checkout`)
	}
}

function approval_texts(root: string): ReadonlyMap<string, string> {
	const directory = path.join(root, APPROVAL_DIRECTORY)

	if (!existsSync(directory)) return new Map()

	return new Map(
		readdirSync(directory).flatMap((name): Array<[string, string]> => {
			const text = file_reader.read_if_readable(path.join(directory, name))

			return text === undefined ? [] : [[name, text]]
		}),
	)
}

// Returns the repository-relative path written, for the line the command prints.
function write_approval(root: string, issue: number, approval: Approval): string {
	const file = path.join(APPROVAL_DIRECTORY, `${String(issue)}${APPROVAL_EXTENSION}`)

	mkdirSync(path.join(root, APPROVAL_DIRECTORY), { recursive: true })
	writeFileSync(path.join(root, file), metrics_ratchet.approval_text(approval))

	return file
}

// A checkout sitting on the base commit with nothing changed *is* the base tree, so its own reading
// is the answer and no second tree is built — the default branch itself, and every gate fixture.
async function is_at(commit: string): Promise<boolean> {
	const head = await git_spawn.read(['rev-parse', 'HEAD'])
	const status = await git_command.status()

	return head === commit && status.trim().length === 0
}

// **The child runs inside its caller's claim, so it claims none of its own** (joshuafolkken/kit#3944).
// `josh metrics` holds its weight while it waits on this child, and inside the gate the metrics
// step's claim — its memory, and the zero cores `gate-plan.ts` gives it — stands for it. The held mark
// both set reaches the child through the environment.
async function measure_in(tree: string): Promise<string> {
	const runner = resolve_tsx_runner()
	const { stdout } = await execa(
		runner.executable,
		[...runner.leading_arguments, COMMAND_SCRIPT, JSON_FLAG],
		{ cwd: tree, env: git_location_environment.location_free_environment(), extendEnv: true },
	)

	return stdout
}

async function measure_base(commit: string): Promise<CachedReading> {
	return await base_tree.with_tree(TREE_PREFIX, commit, async ({ tree }) => ({
		stdout: await measure_in(tree),
		approvals: [...approval_texts(tree)],
	}))
}

function reading_of(cached: CachedReading): Reading | undefined {
	const metrics = metrics_ratchet.parse_metrics(cached.stdout)

	return metrics === undefined ? undefined : { metrics, approvals: new Map(cached.approvals) }
}

function cached_reading(commit: string): Reading | undefined {
	const cached = metrics_base_cache.read(commit, RULER_ROOT)

	return cached === undefined ? undefined : reading_of(cached)
}

// **One commit under one ruler is measured once** (`metrics-base-cache.ts`): a ship's retries, its gate
// and an `--accept` read the first measurement back. A record that does not parse is measured again.
async function read(commit: string, current: Reading): Promise<Reading> {
	if (await is_at(commit)) return current

	const hit = cached_reading(commit)

	if (hit !== undefined) return hit

	const measured = await measure_base(commit)
	const reading = reading_of(measured)

	if (reading === undefined) throw new Error('josh metrics: the merge-base printed no totals')

	metrics_base_cache.write(commit, RULER_ROOT, measured)

	return reading
}

const metrics_base = {
	APPROVAL_DIRECTORY,
	BASE_VARIABLE,
	JSON_FLAG,
	approval_texts,
	read,
	resolve_commit,
	write_approval,
}

export type { Reading }
export { metrics_base }
