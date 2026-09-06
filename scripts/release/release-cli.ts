#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_command } from '#scripts/git/git-command'
import { version_targets } from '#scripts/version/version-targets'
import { release_history } from './release-history'
import { release_plan, type ReleasePlan } from './release-plan'
import { release_publish } from './release-publish'

// `pnpm josh release` — the one place that decides a version (joshuafolkken/kit#1169).
//
// It does three things and no more: count the merges main has taken since the version last changed,
// report and stop when that count is zero, and otherwise raise the version by that many minors, open
// a pull request, merge it and watch for the tag.

const DRY_RUN_FLAG = '--dry-run'
const ARGUMENT_START = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

// **The count is only meaningful on an up-to-date default branch**, and the release commit is made on
// top of it, so both are checked before anything is read rather than after something has been written.
async function ensure_ready(is_dry_run: boolean): Promise<void> {
	const status = await git_command.status()

	if (status.length > 0) {
		throw new Error('The working tree is not clean — commit or stash before releasing.')
	}

	const default_branch = await git_command.get_default_branch()
	const current_branch = await git_command.branch()

	if (current_branch !== default_branch) {
		throw new Error(
			`\`josh release\` runs on \`${default_branch}\`; this checkout is on \`${current_branch}\`.`,
		)
	}

	// **A dry run writes nothing, and a pull is a write.** It fast-forwards the local default branch
	// and can fail outright on a conflict, so the rehearsal reports on the history the checkout
	// already has rather than changing it first.
	if (!is_dry_run) await git_command.pull()
}

async function build_plan(): Promise<ReleasePlan> {
	const current_version = version_targets.read_workspace_version(process.cwd())

	if (current_version === undefined) {
		throw new Error("Could not read a version from this project's package.json.")
	}

	const plan = await release_history.read_release_plan(current_version)

	if (plan === undefined) {
		throw new Error(
			`Could not find the commit that last changed the version within the last ${String(release_history.BASE_SEARCH_LIMIT)} commits that touched package.json.`,
		)
	}

	return plan
}

async function run(is_dry_run: boolean): Promise<number> {
	await ensure_ready(is_dry_run)

	const plan = await build_plan()

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
