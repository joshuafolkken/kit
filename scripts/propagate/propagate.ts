#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { cli_flags } from '#scripts/lib/cli-flags'
import { status_icons } from '#scripts/lib/status-icons'
import { derive_versions_endpoint } from '#scripts/version/version-command-config'
import { version_targets } from '#scripts/version/version-targets'
import { propagate_git } from './propagate-git'
import { propagate_plan } from './propagate-plan'
import { propagate_publish } from './propagate-publish'
import { propagate_run } from './propagate-run'
import { propagate_select, type TargetSelection } from './propagate-select'
import { propagate_steps, type ReleasePlan } from './propagate-steps'
import { propagate_targets, type PropagateTarget } from './propagate-targets'

// `josh propagate` — carry the release this repository just published into every consumer checked
// out next to it.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const SKIP_PUBLISH_FLAG = '--skip-publish-wait'
const DRY_RUN_FLAG = '--dry-run'
const TARGET_FLAG = '--target'
const KNOWN_FLAGS: ReadonlyArray<string> = [SKIP_PUBLISH_FLAG, DRY_RUN_FLAG]
// Shown in the usage line only: `--target` carries a value, so it is spelled with a placeholder.
const TARGET_USAGE = `${TARGET_FLAG} <repo>`
const DRY_RUN_REASON = 'would be propagated'
const UNTOUCHED_NOTE = 'No consumer was touched.'

interface RunOptions {
	is_dry_run: boolean
	is_publish_wait_skipped: boolean
	// The one consumer to propagate to, when `--target` narrowed the run.
	target?: string
	// The usage message, when the arguments were not accepted. Carried alongside rather than returned
	// instead, so the caller has one shape to branch on.
	usage?: string
}

// `--target` is read as a list so a second one is seen and refused rather than letting one of the two
// names win silently.
const OPTIONS = {
	'skip-publish-wait': { type: 'boolean' },
	'dry-run': { type: 'boolean' },
	target: { type: 'string', multiple: true },
} as const
const USAGE = `Usage: josh propagate [${[...KNOWN_FLAGS, TARGET_USAGE].join('] [')}]`
const TARGET_MISSING = `${TARGET_FLAG} needs a repository name, e.g. ${TARGET_FLAG} app-kit`

type ParsedValues = NonNullable<ReturnType<typeof cli_flags.values_of<typeof OPTIONS>>>

function refused(usage: string): RunOptions {
	return { is_dry_run: false, is_publish_wait_skipped: false, usage }
}

function to_options(values: ParsedValues): RunOptions {
	const [target] = values.target ?? []

	return {
		is_dry_run: values['dry-run'] ?? false,
		is_publish_wait_skipped: values['skip-publish-wait'] ?? false,
		...(target !== undefined && { target }),
	}
}

// Reject anything not on the list rather than ignoring it. `--dryrun` silently falling through to
// the real write path is the mistake this refusal exists to prevent. A `--target` with no usable name
// after it — last on the line, or followed by `--dry-run` — is named on its own, so the caller learns
// which value is missing rather than reading the generic usage.
function read_values(argv: ReadonlyArray<string>): ParsedValues | undefined {
	const values = cli_flags.values_of(argv, OPTIONS)

	return (values?.target?.length ?? 0) > 1 ? undefined : values
}

function parse_options(argv: ReadonlyArray<string>): RunOptions {
	if (cli_flags.is_value_unusable(argv, TARGET_FLAG)) return refused(TARGET_MISSING)
	const values = read_values(argv)

	if (values === undefined) {
		return refused(`Unknown argument(s) or a repeated ${TARGET_FLAG}: ${argv.join(' ')}\n${USAGE}`)
	}

	return to_options(values)
}

// Propagation runs from the supplier's own repository, and only there — kit's, or a toolkit's built
// on it.
//
// This is also what decides who propagates when several sessions are running: in the
// per-repository concurrency model there is one session per checkout, so the session standing in
// the supplier repository is the one that can run this command. It is a
// convention enforced at the boundary, not a lock — two checkouts of the supplier would both pass,
// which is why each consumer is additionally refused unless its working tree is clean.
function refuse_outside_source_repository(project_root: string): string | undefined {
	return propagate_plan.resolve_supplier(project_root).refusal
}

// The version to carry: this repository's own declared version, which is what the merge published.
// Never "whatever is newest" — a consumer several releases behind must not be satisfied by an older
// publish that does not contain the change being propagated.
function resolve_target_version(project_root: string): string | undefined {
	return version_targets.read_workspace_version(project_root)
}

// The version this run would carry, or the message saying why there is none. Both halves are
// carried in one value so the caller has a single thing to branch on.
interface RunVersion {
	version?: string
	refusal?: string
	warning?: string
}

// The supplier's own tree is checked too: run from a checkout that is behind its remote, the version
// read below is the *previous* release — already published, so the wait passes and every consumer is
// told to upgrade to a version that does not contain the change.
// What an unready supplier means for this run. A dry run writes nothing, so it is a warning there
// rather than a refusal — refusing would make the flag useless in exactly the situation it is
// reached for, which is checking the target list while work is still in progress.
function unready_supplier(version: string, reason: string, is_dry_run: boolean): RunVersion {
	if (!is_dry_run) return { refusal: `Refusing to propagate: this repository ${reason}.` }

	return { version, warning: `Note: this repository ${reason}; a real run would refuse.` }
}

// The version once the supplier repository has been accepted as the place to propagate from.
function resolve_supplier_version(project_root: string, is_dry_run: boolean): RunVersion {
	const version = resolve_target_version(project_root)

	if (version === undefined) {
		return { refusal: 'Could not read this repository own version; nothing to propagate.' }
	}

	const state = propagate_git.tree_state(project_root)

	return state.is_ready
		? { version }
		: unready_supplier(version, state.reason ?? 'is not ready', is_dry_run)
}

function resolve_run_version(project_root: string, is_dry_run = false): RunVersion {
	const refusal = refuse_outside_source_repository(project_root)
	if (refusal !== undefined) return { refusal }

	return resolve_supplier_version(project_root, is_dry_run)
}

async function await_publish(
	package_name: string,
	target_version: string,
	is_skipped: boolean,
): Promise<boolean> {
	if (is_skipped) return true
	console.info(`Waiting for ${package_name}@${target_version} to appear in the registry…`)
	const endpoint = derive_versions_endpoint(package_name)
	const result = await propagate_publish.wait_for_publish(endpoint, target_version)

	if (result.state === 'published') {
		console.info(`✓ ${target_version} is published (${String(result.attempts)} probe(s)).`)

		return true
	}

	console.error(
		`${status_icons.FAIL_ICON} ${target_version} did not become available: ${result.state}.`,
	)
	console.error(UNTOUCHED_NOTE)

	return false
}

// Print whatever the version resolution had to say, and hand back the version when there is one.
function announce_run_version(resolved: RunVersion): string | undefined {
	if (resolved.version === undefined) {
		console.error(resolved.refusal ?? 'Nothing to propagate.')

		return undefined
	}

	if (resolved.warning !== undefined) console.info(resolved.warning)

	return resolved.version
}

interface RunPlan {
	version: string
	releases: ReleasePlan
	targets: ReadonlyArray<PropagateTarget>
}

// The consumers this run will consider, narrowed by `--target`. Resolved before the publish wait so
// a mistyped name fails at once instead of after minutes of polling the registry. A consumer that
// installs a toolkit above the supplier is left to that toolkit's propagation.
function resolve_run_targets(
	releases: ReleasePlan,
	version: string,
	target: string | undefined,
): TargetSelection {
	const map = repo_discovery.discover_repositories(PROJECT_ROOT)
	const supplier = propagate_plan.supplier_name(releases)
	const targets = propagate_targets
		.resolve_targets(map, supplier, version)
		.map((candidate) => propagate_plan.mark_carried(candidate, releases))

	return propagate_select.select_target(targets, target)
}

// Print why the run stopped before any consumer was touched.
function refuse_run(refusal: string): void {
	console.error(refusal)
	console.error(UNTOUCHED_NOTE)
}

interface PlanOutcome {
	plan?: RunPlan
	refusal?: string
}

// The releases and the consumers for a version already accepted, or the reason there are none.
function plan_consumers(version: string, options: RunOptions): PlanOutcome {
	const { plan: releases, refusal } = propagate_plan.build_plan(PROJECT_ROOT, version)
	if (releases === undefined) return { refusal: refusal ?? UNTOUCHED_NOTE }
	const selection = resolve_run_targets(releases, version, options.target)
	if (selection.refusal !== undefined) return { refusal: selection.refusal }

	return { plan: { version, releases, targets: selection.targets } }
}

// The version, the releases and the consumers, or nothing once whatever stopped the run has been
// printed.
function plan_run(options: RunOptions): RunPlan | undefined {
	const version = announce_run_version(resolve_run_version(PROJECT_ROOT, options.is_dry_run))
	if (version === undefined) return undefined
	const { plan, refusal } = plan_consumers(version, options)
	if (refusal !== undefined) refuse_run(refusal)

	return plan
}

// Everything after the publish wait: run each consumer, print one report.
function propagate_to_consumers(plan: RunPlan, is_dry_run: boolean): number {
	const { releases, targets } = plan
	const step = is_dry_run
		? propagate_plan.create_step_describer(releases)
		: propagate_steps.create_step_runner(releases)
	const results = propagate_run.run_targets(
		targets,
		step,
		is_dry_run ? DRY_RUN_REASON : propagate_run.PROPAGATED_REASON,
	)

	console.info('')
	console.info(propagate_run.format_report(results))

	return propagate_run.has_failure(results) ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

// A dry run never waits: the whole reason to ask for one is to see the target list, and a wait that
// times out would end the run before the list was ever printed.
async function resolve_publish(plan: RunPlan, options: RunOptions): Promise<boolean> {
	return await await_publish(
		propagate_plan.supplier_name(plan.releases),
		plan.version,
		options.is_dry_run || options.is_publish_wait_skipped,
	)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const options = parse_options(argv)

	if (options.usage !== undefined) {
		console.error(options.usage)

		return FAILURE_EXIT_CODE
	}

	const plan = plan_run(options)
	if (plan === undefined) return FAILURE_EXIT_CODE
	if (!(await resolve_publish(plan, options))) return FAILURE_EXIT_CODE

	return propagate_to_consumers(plan, options.is_dry_run)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exit(await run(argv))
}

const propagate = {
	KNOWN_FLAGS,
	TARGET_FLAG,
	parse_options,
	refuse_outside_source_repository,
	resolve_target_version,
	resolve_run_version,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { RunOptions }
export { propagate }
