#!/usr/bin/env tsx
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auto_merge_setting } from '#scripts/auto-merge-setting'
import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { gh_spawn } from '#scripts/gh-spawn'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { security_updates } from '#scripts/security-updates'
import { running_binary } from '#scripts/version/running-binary'
import { doctor_io, type GitTopLevel } from './doctor-io'
import { doctor_logic } from './doctor-logic'

const FIX_FLAG = '--fix'
const UNKNOWN = '(unknown)'
const NOT_ON_PATH = '(not on PATH)'
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
// Deliberately smaller than the setting query's budget: the two run back to back, so `doctor`'s
// worst case is the git probe plus this plus GH_TIMEOUT_MS — 2000 + 3000 + 5000, ten seconds. That
// keeps a command which made no network calls at all before joshuafolkken/kit#805 prompt enough to
// stay usable when the network is unreachable.
const REPO_LOOKUP_TIMEOUT_MS = 3000

// Where the local applicability gates look for the artifacts that decide whether a report applies.
interface GateScope {
	root: string
	boundary: string | undefined
}

// Which repository-scoped reports this project has a prerequisite for.
interface ApplicableSettings {
	security_updates: boolean
	auto_merge: boolean
}

interface DoctorContext {
	running_version: string | undefined
	running_path: string
	path_josh: string | undefined
	global_josh: string | undefined
}

function gather_context(): DoctorContext {
	return {
		running_version: running_binary.read_running_version(SELF_DIR),
		running_path: running_binary.running_package_directory(SELF_DIR),
		path_josh: doctor_io.resolve_path_josh(),
		global_josh: doctor_io.resolve_pnpm_global_josh(),
	}
}

function print_report(ctx: DoctorContext): void {
	console.info('josh doctor')
	console.info(`  Running:     ${ctx.running_version ?? UNKNOWN}  (${ctx.running_path})`)
	console.info(`  On PATH:     ${ctx.path_josh ?? NOT_ON_PATH}`)
	console.info(`  pnpm global: ${ctx.global_josh ?? UNKNOWN}`)
}

// Remove a confirmed stale kit shim so the pnpm-global josh reclaims PATH precedence. Any other
// shadowing binary is left in place and reported for manual review.
function reclaim_shim(path_josh: string, global_josh: string): void {
	const content = readFileSync(path_josh, 'utf8')
	const decision = doctor_logic.decide_reclaim(path_josh, global_josh, content)

	if (decision.action !== 'remove' || decision.target === undefined) {
		console.info(`  ${decision.reason}`)

		return
	}

	rmSync(decision.target)
	console.info(`  ✓ ${decision.reason}: ${decision.target}`)
}

function handle_shadow(ctx: DoctorContext, is_fix: boolean): void {
	if (ctx.path_josh === undefined || ctx.global_josh === undefined) return
	console.info('')
	console.info(doctor_logic.format_shadow_warning(ctx.path_josh, ctx.global_josh))
	if (is_fix) reclaim_shim(ctx.path_josh, ctx.global_josh)
}

function report_path_diagnosis(ctx: DoctorContext, is_fix: boolean): void {
	if (doctor_logic.is_shadowed(ctx.path_josh, ctx.global_josh)) {
		handle_shadow(ctx, is_fix)

		return
	}

	console.info('  ✓ no PATH shadowing detected')
}

// Where a repository-scoped check should look for the artifact that decides whether it applies.
// An undetermined root still gets gated, against the working directory as the best root available:
// skipping the gate there would warn about a nonexistent repository from a home directory whenever
// `git` is missing or refuses the repository. Inside a known repository the search is bounded to its
// root, so a repository nested under a kit consumer does not inherit the parent's files.
function resolve_gate_scope(git: GitTopLevel): GateScope | undefined {
	if (git.state === 'outside') return undefined
	if (git.state === 'inside') return { root: git.top_level, boundary: git.top_level }

	return { root: PROJECT_ROOT, boundary: undefined }
}

// Which prerequisites this repository actually has, decided locally so the answer does not depend on
// `gh` working. The two are independent: a consumer synced before joshuafolkken/kit#834 has the
// Dependabot config and no auto-merge workflow, and a repository that only ever added an auto-merge
// workflow of its own has the second prerequisite and not the first.
function resolve_applicable(scope: GateScope): ApplicableSettings {
	return {
		security_updates: doctor_io.has_distributed_dependabot_config(scope.root, scope.boundary),
		auto_merge: doctor_io.has_auto_merge_workflow(scope.root, scope.boundary),
	}
}

// Everything past the gate reports, including a failed lookup: `could not be read` is informative
// while silence is the false all-clear joshuafolkken/kit#805 exists to remove.
function report_applicable_settings(
	applicable: ApplicableSettings,
	repo: string | undefined,
): void {
	if (applicable.security_updates) security_updates.report_security_updates_section(repo)
	if (applicable.auto_merge) auto_merge_setting.report_auto_merge_section(repo)
}

// Last, and after the local diagnosis: this is the only part of `doctor` that touches the network,
// and `doctor` is what a user runs when the install is already broken. Offline or behind a hanging
// proxy the PATH report and `--fix` must still complete (joshuafolkken/kit#805).
//
// Applicability is decided by the artifact rather than by the directory. `doctor` diagnoses the
// global install and is routinely run from a home directory or from a clone of an unrelated project;
// each prerequisite only exists where the file that creates it landed, so those files are the gates.
// Without them the warnings would describe a repository that either does not exist or never consumed
// kit, and would print enabling commands for someone else's repository. `init` and `sync` always run
// inside the project they just wrote those files into.
//
// The repository name is resolved once, and only when at least one report will use it: `doctor`
// writes nothing, so the bounded lookup is the right one, and spawning it for a repository with no
// prerequisite at all would be a network call with nothing to report.
function report_repository_settings(git: GitTopLevel): void {
	const scope = resolve_gate_scope(git)
	if (scope === undefined) return
	const applicable = resolve_applicable(scope)
	if (!applicable.security_updates && !applicable.auto_merge) return

	report_applicable_settings(
		applicable,
		gh_spawn.get_repo_name_with_owner_within(REPO_LOOKUP_TIMEOUT_MS),
	)
}

// The discovery map, printed for whichever repository `doctor` is standing in. Nothing is printed
// from outside a repository: discovery is anchored on the current repository's own owner, so without
// one there is no map to be right or wrong about (joshuafolkken/kit#869).
function report_repository_map(git: GitTopLevel): void {
	if (git.state !== 'inside') return

	const map = repo_discovery.discover_repositories(git.top_level)

	console.info('')
	console.info(doctor_logic.format_repository_map(map))
}

function main(): void {
	const is_fix = process.argv.includes(FIX_FLAG)
	const ctx = gather_context()

	// Resolved once and shared: `doctor` is what a user runs when things are already broken, and a
	// second `git rev-parse` would add a second timeout to a command whose whole contract is to stay
	// responsive when git itself is hanging (joshuafolkken/kit#805).
	const git = doctor_io.resolve_git_top_level()

	print_report(ctx)
	report_path_diagnosis(ctx, is_fix)
	report_repository_map(git)
	report_repository_settings(git)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const doctor = {
	gather_context,
	print_report,
	reclaim_shim,
	handle_shadow,
	report_repository_map,
	main,
}

export type { DoctorContext }
export { doctor }
