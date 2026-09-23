#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_command } from '#scripts/git/git-command'
import { release_history } from './release-history'
import { release_plan, type ReleasePlan } from './release-plan'
import { release_publish } from './release-publish'

// `pnpm josh release` — the one place that decides a version (joshuafolkken/kit#1169).
//
// It does three things and no more: count the merges main has taken since the version last changed,
// report and stop when that count is zero, and otherwise raise the version by that many minors, open
// a pull request, merge it and watch for the tag.
//
// **It never touches the root checkout** (joshuafolkken/kit#2411). The count is read from
// `origin/<default>`, and the version bump / commit / push happen in a dedicated work tree
// `release_publish` cuts for the release — so a release can run beside a `backlogrun` (which keeps the
// root on the default branch) and can start even when the root is dirty or on another branch.

const DRY_RUN_FLAG = '--dry-run'
const ARGUMENT_START = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

// **The remote-tracking ref is the tip everything is read from**, so the release measures against
// main's latest rather than whatever the root checkout is sitting on. The fetch refreshes that ref;
// a dry run skips it because a rehearsal writes nothing (a fetch updates refs), reporting on the ref
// the checkout already has.
async function origin_tip(is_dry_run: boolean): Promise<string> {
	const default_branch = await git_command.get_default_branch()

	if (!is_dry_run) await git_command.fetch_branch(default_branch)

	return `origin/${default_branch}`
}

async function build_plan(tip: string): Promise<ReleasePlan> {
	const current_version = await release_history.read_current_version(tip)

	if (current_version === undefined) {
		throw new Error(`Could not read a version from \`${tip}\`'s package.json.`)
	}

	const plan = await release_history.read_release_plan(current_version, undefined, tip)

	if (plan === undefined) {
		throw new Error(
			`Could not find the commit that last changed the version within the last ${String(release_history.BASE_SEARCH_LIMIT)} commits that touched package.json.`,
		)
	}

	return plan
}

async function run(is_dry_run: boolean): Promise<number> {
	const tip = await origin_tip(is_dry_run)
	const plan = await build_plan(tip)

	if (plan.pending === 0) {
		console.info(release_plan.format_nothing_to_release(plan.base))

		return SUCCESS_EXIT_CODE
	}

	console.info(release_plan.format_plan(plan))

	if (is_dry_run) return SUCCESS_EXIT_CODE

	return await release_publish.publish(plan)
}

function is_dry_run_requested(argv: ReadonlyArray<string>): boolean {
	return argv.slice(ARGUMENT_START).includes(DRY_RUN_FLAG)
}

async function main(): Promise<void> {
	try {
		process.exit(await run(is_dry_run_requested(process.argv)))
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(FAILURE_EXIT_CODE)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main()

const release_cli = { is_dry_run_requested, run, DRY_RUN_FLAG }

export { release_cli }
