#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { self_sync_guard } from '#scripts/self-sync-guard/self-sync-guard-logic'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { derive_versions_endpoint } from '#scripts/version/version-command-config'
import { version_targets } from '#scripts/version/version-targets'
import { propagate_git } from './propagate-git'
import { propagate_publish } from './propagate-publish'
import { propagate_run } from './propagate-run'
import { propagate_steps } from './propagate-steps'
import { propagate_targets } from './propagate-targets'

// `josh propagate` — carry the release this repository just published into every consumer checked
// out next to it (joshuafolkken/kit#863).

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const SKIP_PUBLISH_FLAG = '--skip-publish-wait'
const DRY_RUN_FLAG = '--dry-run'
const KNOWN_FLAGS: ReadonlyArray<string> = [SKIP_PUBLISH_FLAG, DRY_RUN_FLAG]
const DRY_RUN_REASON = 'would be propagated'

interface RunOptions {
	is_dry_run: boolean
	is_publish_wait_skipped: boolean
	// The usage message, when the arguments were not accepted. Carried alongside rather than returned
	// instead, so the caller has one shape to branch on.
	usage?: string
}

// Reject anything not on the list rather than ignoring it. `--dryrun` silently falling through to
// the real write path is the mistake this refusal exists to prevent.
function parse_options(argv: ReadonlyArray<string>): RunOptions {
	const unknown = argv.filter((argument) => !KNOWN_FLAGS.includes(argument))
	const options: RunOptions = {
		is_dry_run: argv.includes(DRY_RUN_FLAG),
		is_publish_wait_skipped: argv.includes(SKIP_PUBLISH_FLAG),
	}

	if (unknown.length === 0) return options
	const usage = `Usage: josh propagate [${KNOWN_FLAGS.join('] [')}]`

	return { ...options, usage: `Unknown argument(s): ${unknown.join(' ')}\n${usage}` }
}

// Propagation runs from the supplier's own repository, and only there.
//
// This is also what decides who propagates when several sessions are running: in the
// per-repository concurrency model there is one session per checkout, so the session standing in
// the supplier repository is the one that can run this command (joshuafolkken/kit#861). It is a
// convention enforced at the boundary, not a lock — two checkouts of the supplier would both pass,
// which is why each consumer is additionally refused unless its working tree is clean.
function refuse_outside_source_repository(project_root: string): string | undefined {
	if (self_sync_guard.read_package_name(project_root) === KIT_PACKAGE_NAME) return undefined

	return [
		`Refusing to propagate: this is not ${KIT_PACKAGE_NAME}'s own repository.`,
		'Propagation carries a published release outward, so it runs from the package that published it.',
		`Run it from the ${KIT_PACKAGE_NAME} checkout instead.`,
	].join('\n')
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

async function await_publish(target_version: string, is_skipped: boolean): Promise<boolean> {
	if (is_skipped) return true
	console.info(`Waiting for ${KIT_PACKAGE_NAME}@${target_version} to appear in the registry…`)
	const endpoint = derive_versions_endpoint(KIT_PACKAGE_NAME)
	const result = await propagate_publish.wait_for_publish(endpoint, target_version)

	if (result.state === 'published') {
		console.info(`✓ ${target_version} is published (${String(result.attempts)} probe(s)).`)

		return true
	}

	console.error(`✗ ${target_version} did not become available: ${result.state}.`)
	console.error('No consumer was touched.')

	return false
}

// Everything after the publish wait: resolve the consumers, run each one, print one report.
function propagate_to_consumers(version: string, is_dry_run: boolean): number {
	const map = repo_discovery.discover_repositories(PROJECT_ROOT)
	const targets = propagate_targets.resolve_targets(map, KIT_PACKAGE_NAME, version)
	const step = is_dry_run
		? propagate_steps.describe_step
		: propagate_steps.create_step_runner({ package_name: KIT_PACKAGE_NAME, version })
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
async function resolve_publish(version: string, options: RunOptions): Promise<boolean> {
	return await await_publish(version, options.is_dry_run || options.is_publish_wait_skipped)
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

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const options = parse_options(argv)

	if (options.usage !== undefined) {
		console.error(options.usage)

		return FAILURE_EXIT_CODE
	}

	const version = announce_run_version(resolve_run_version(PROJECT_ROOT, options.is_dry_run))
	if (version === undefined) return FAILURE_EXIT_CODE
	if (!(await resolve_publish(version, options))) return FAILURE_EXIT_CODE

	return propagate_to_consumers(version, options.is_dry_run)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exit(await run(argv))
}

const propagate = {
	DRY_RUN_REASON,
	KNOWN_FLAGS,
	parse_options,
	refuse_outside_source_repository,
	resolve_target_version,
	resolve_run_version,
	announce_run_version,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { RunOptions, RunVersion }
export { propagate }
