#!/usr/bin/env tsx
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gh_spawn } from '#scripts/gh-spawn'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { security_updates } from '#scripts/security-updates'
import { running_binary } from '#scripts/version/running-binary'
import { doctor_io } from './doctor-io'
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

// Last, and after the local diagnosis: this is the only part of `doctor` that touches the network,
// and `doctor` is what a user runs when the install is already broken. Offline or behind a hanging
// proxy the PATH report and `--fix` must still complete (joshuafolkken/kit#805).
//
// Applicability is decided locally, and by the artifact rather than by the directory. `doctor`
// diagnoses the global install and is routinely run from a home directory or from a clone of an
// unrelated project; the prerequisite only exists where kit's `.github/dependabot.yml` landed, so
// that file is the gate. Without it the warning would describe a repository that either does not
// exist or never consumed kit, and would print an enabling command for someone else's repository.
//
// The config is resolved from the repository root rather than the working directory, so the check is
// not silently skipped in every subdirectory of a consumer project.
//
// Everything past that gate reports, including a failed lookup: `could not be read` is informative
// while silence is the false all-clear joshuafolkken/kit#805 exists to remove. `init` and `sync`
// always run inside the project they just wrote the file into, so they report unconditionally.
function report_security_updates_setting(): void {
	const git = doctor_io.resolve_git_top_level()
	if (git.state === 'outside') return
	// An undetermined root still gets gated, against the working directory as the best root
	// available. Skipping the gate there would warn about a nonexistent repository from a home
	// directory whenever `git` is missing or refuses the repository.
	// Inside a known repository the search is bounded to its root, so a repository nested under a kit
	// consumer does not inherit the parent's config.
	const root = git.state === 'inside' ? git.top_level : PROJECT_ROOT
	const boundary = git.state === 'inside' ? git.top_level : undefined

	if (!doctor_io.has_distributed_dependabot_config(root, boundary)) return

	// The bounded lookup: `doctor` writes nothing, so returning promptly beats waiting.
	const repo = gh_spawn.get_repo_name_with_owner_within(REPO_LOOKUP_TIMEOUT_MS)

	security_updates.report_security_updates_section(repo)
}

function main(): void {
	const is_fix = process.argv.includes(FIX_FLAG)
	const ctx = gather_context()

	print_report(ctx)
	report_path_diagnosis(ctx, is_fix)
	report_security_updates_setting()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const doctor = { gather_context, print_report, reclaim_shim, handle_shadow, main }

export type { DoctorContext }
export { doctor }
