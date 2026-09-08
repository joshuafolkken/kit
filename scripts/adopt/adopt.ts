#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { refuse_unknown_flags } from '#scripts/cli-flags'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { propagate_run, type TargetResult } from '#scripts/propagate/propagate-run'
import { propagate_steps, type Release, type ReleasePlan } from '#scripts/propagate/propagate-steps'
import type { PropagateTarget } from '#scripts/propagate/propagate-targets'
import { adopt_logic } from './adopt-logic'
import { adopt_toolkits } from './adopt-toolkits'

// `josh adopt` — upgrade every `@joshuafolkken/*` toolkit installed in this repository to latest,
// sync each one's managed files, run the verification gate, and open the issue and pull request
// (joshuafolkken/kit#1085).
//
// It is `josh propagate` seen from the other end: propagation stands in the supplier and pushes one
// released version out to every consumer, adoption stands in the consumer and pulls whatever is
// newest in. The step sequence is literally the same one — `propagate_run.STEP_ORDER`, run through
// `propagate_run.run_target` — so the working-tree pre-check, the ordering and the return to the
// default branch cannot drift between the two.
//
// It stops at the open pull request. Merging is what `pnpm josh followup` does, under an
// authorization a CLI does not have.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const DRY_RUN_FLAG = '--dry-run'
const KNOWN_FLAGS: ReadonlyArray<string> = [DRY_RUN_FLAG]
const DRY_RUN_REASON = 'would be adopted'
const NOTHING_TO_ADOPT = 'No @joshuafolkken toolkit is installed here; nothing to adopt.'
const NO_ORIGIN =
	'Refusing to adopt: this checkout has no GitHub `origin`, so there is nowhere to open the issue.'

interface RunOptions {
	is_dry_run: boolean
	// The usage message, when the arguments were not accepted. Carried alongside rather than returned
	// instead, so the caller has one shape to branch on.
	usage?: string
}

function parse_options(argv: ReadonlyArray<string>): RunOptions {
	const options: RunOptions = { is_dry_run: argv.includes(DRY_RUN_FLAG) }
	const usage = refuse_unknown_flags(argv, KNOWN_FLAGS, 'adopt')

	return usage === undefined ? options : { ...options, usage }
}

function announce_releases(releases: ReadonlyArray<Release>): void {
	console.info(`Adopting: ${releases.map((release) => release.package_name).join(', ')}`)
}

function report(result: TargetResult): number {
	console.info('')
	console.info(propagate_run.format_report([result]))

	return propagate_run.has_failure([result]) ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

// A dry run describes each step and touches nothing; a real run carries the plan. Both go through
// the same sequence, so what the dry run lists is what the real run does.
function run_sequence(target: PropagateTarget, plan: ReleasePlan | undefined): number {
	const step =
		plan === undefined ? propagate_steps.describe_step : propagate_steps.create_step_runner(plan)
	const reason = plan === undefined ? DRY_RUN_REASON : propagate_run.PROPAGATED_REASON

	return report(propagate_run.run_target(target, step, reason))
}

// A declared toolkit that cannot be carried stops the run, whichever of the two ways it fell out —
// placed under `dependencies`, or declared with no runnable CLI here (joshuafolkken/kit#1540). The
// refusal names each one and its cause, so the exclusion is still reported as it was before; what
// changed is that it no longer leaves the run to sync kit alone and revert the overlay tier.
//
// It runs ahead of discovery, so a dry run refuses too: what the dry run lists has to be what the
// real run does, and a plan it printed here would be a plan nothing will ever execute.
function refuse_incomplete_plan(project_root: string): number | undefined {
	const refusal = adopt_logic.refuse_incomplete_plan(
		adopt_toolkits.misplaced_toolkits(project_root),
		adopt_toolkits.unresolved_toolkits(project_root),
	)
	if (refusal === undefined) return undefined

	console.error(refusal)

	return FAILURE_EXIT_CODE
}

// Nothing installed is a skip; kit missing is a refusal. Both stop the run before anything writes,
// and they differ only in the exit code they stop with.
function stop_reason(releases: ReadonlyArray<Release>): number | undefined {
	if (releases.length === 0) {
		console.info(NOTHING_TO_ADOPT)

		return SUCCESS_EXIT_CODE
	}

	const refusal = adopt_logic.refuse_without_kit(releases)
	if (refusal === undefined) return undefined

	console.error(refusal)

	return FAILURE_EXIT_CODE
}

function adopt_target(
	project_root: string,
	releases: ReadonlyArray<Release>,
	is_dry_run: boolean,
): number {
	const target = adopt_logic.resolve_self_target(project_root)

	if (target === undefined) {
		console.error(NO_ORIGIN)

		return FAILURE_EXIT_CODE
	}

	announce_releases(releases)

	return run_sequence(target, is_dry_run ? undefined : adopt_logic.build_plan(releases))
}

// The run once the repository has been accepted as a place to adopt into.
function run_here(project_root: string, is_dry_run: boolean): number {
	const incomplete = refuse_incomplete_plan(project_root)
	if (incomplete !== undefined) return incomplete

	const releases = adopt_toolkits.discover_toolkits(project_root)
	const stop = stop_reason(releases)

	return stop ?? adopt_target(project_root, releases, is_dry_run)
}

function run(argv: ReadonlyArray<string>, project_root: string = PROJECT_ROOT): number {
	const options = parse_options(argv)

	if (options.usage !== undefined) {
		console.error(options.usage)

		return FAILURE_EXIT_CODE
	}

	const refusal = adopt_logic.refuse_inside_kit_repository(project_root)

	if (refusal !== undefined) {
		console.error(refusal)

		return FAILURE_EXIT_CODE
	}

	return run_here(project_root, options.is_dry_run)
}

function main(argv: ReadonlyArray<string>): void {
	process.exit(run(argv))
}

const adopt = {
	DRY_RUN_REASON,
	KNOWN_FLAGS,
	NOTHING_TO_ADOPT,
	parse_options,
	run_here,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export type { RunOptions }
export { adopt }
