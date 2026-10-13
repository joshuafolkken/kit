#!/usr/bin/env tsx
import { existsSync, readdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { resolve_local_bin } from '#scripts/build/local-bin'
import { ask_yes_no_simple } from '#scripts/git/git-prompt'
import { LEFTHOOK_PATH } from '#scripts/init/init-actions'
import { init_logic_sonar } from '#scripts/init/init-logic-sonar'
import { PACKAGE_DIR, PROJECT_ROOT } from '#scripts/init/init-paths'
import { project_profile, type ProjectProfile } from '#scripts/init/project-profile'
import { error_text } from '#scripts/lib/error-message'
import { file_reader } from '#scripts/lib/read-file'
import { PROJECT_CONFIG_FILE } from '#scripts/safe-chain/project-config'
import { did_refuse_self_run } from '#scripts/self-sync-guard/self-sync-refusal'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { execaSync } from 'execa'
import { distributed_files } from './distributed-files'
import { IGNORE_FILE, uninstall_plan, type FilePlan } from './uninstall-plan'
import { uninstall_report, type UninstallPlan } from './uninstall-report'

const PACKAGE_JSON = 'package.json'
const LEFTHOOK_BIN = 'lefthook'
const ARGUMENT_START_INDEX = 2
const YES_FLAG = '--yes'
const UNINSTALL_USAGE = 'josh uninstall [--profile basic|full] [--yes]'
const QUESTION = 'Remove the files and entries listed under "Remove"? (y/n): '
const NOT_CONFIRMED = 'Nothing was removed.'
const NO_TERMINAL = `${NOT_CONFIRMED} This is a preview: there is no terminal to confirm on, so pass --yes to remove what is listed.`
// Written from the repository's own name and settings, so there is no distributed content to compare
// them with: they are named for review and never deleted.
const REVIEW_ONLY_FILES = [init_logic_sonar.get_sonar_template_destination(), PROJECT_CONFIG_FILE]
const IGNORE_FILE_REVIEW = `${IGNORE_FILE} — delete it only once nothing it ignores (.env, node_modules) is left`

interface Options {
	is_yes: boolean
	profile: ProjectProfile
}

function project_path(relative_path: string): string {
	return path.join(PROJECT_ROOT, relative_path)
}

function read_project_file(relative_path: string): string | undefined {
	return file_reader.read_if_readable(project_path(relative_path))
}

function parse_options(args: ReadonlyArray<string>): Options {
	const rest = args.filter((argument) => argument !== YES_FLAG)
	const requested = project_profile.requested_profile(rest, UNINSTALL_USAGE)

	return {
		is_yes: args.includes(YES_FLAG),
		profile: project_profile.resolve_profile(PROJECT_ROOT, requested).profile,
	}
}

// A lefthook config the profile distributes that still names the package — the one kit wrote, or the
// project's own with kit's preset merged in. One that names it nowhere is the project's alone.
function has_kit_lefthook_config(files: FilePlan): boolean {
	if (![...files.remove, ...files.keep].includes(LEFTHOOK_PATH)) return false

	return read_project_file(LEFTHOOK_PATH)?.includes(KIT_PACKAGE_NAME) === true
}

// Hooks are taken out only where the lefthook config is one kit wrote or merged into: once kit is
// gone that config extends a preset that no longer exists, and a hook left in `.git/hooks` would
// fail every commit on it.
function has_git_hooks(files: FilePlan): boolean {
	return (
		has_kit_lefthook_config(files) &&
		existsSync(project_path('.git')) &&
		existsSync(resolve_local_bin(PROJECT_ROOT, LEFTHOOK_BIN))
	)
}

function review_entries(manifest: string | undefined, profile: ProjectProfile): Array<string> {
	const merged =
		manifest === undefined
			? []
			: uninstall_plan.manifest_review(manifest, distributed_files.kit_manifest(profile))

	return [
		...merged.map((entry) => `${PACKAGE_JSON} ${entry}`),
		...REVIEW_ONLY_FILES.filter((file) => existsSync(project_path(file))),
		...(existsSync(project_path(IGNORE_FILE)) ? [IGNORE_FILE_REVIEW] : []),
	]
}

function build_plan(profile: ProjectProfile): UninstallPlan {
	const files = uninstall_plan.classify_files(distributed_files.list(profile), read_project_file)
	const manifest = read_project_file(PACKAGE_JSON)

	return {
		files,
		has_manifest_entries: manifest !== undefined && uninstall_plan.has_kit_entries(manifest),
		has_git_hooks: has_git_hooks(files),
		review: review_entries(manifest, profile),
	}
}

async function is_confirmed(is_yes: boolean): Promise<boolean> {
	if (is_yes) return true

	if (!process.stdin.isTTY) {
		console.info(`\n${NO_TERMINAL}`)

		return false
	}

	const prompt = createInterface({ input, output })

	try {
		const is_accepted = await ask_yes_no_simple(prompt, `\n${QUESTION}`)
		if (!is_accepted) console.info(NOT_CONFIRMED)

		return is_accepted
	} finally {
		prompt.close()
	}
}

// Run before the config is deleted, while lefthook can still read the project it is leaving.
function remove_git_hooks(): void {
	const bin = resolve_local_bin(PROJECT_ROOT, LEFTHOOK_BIN)
	const result = execaSync(bin, ['uninstall'], {
		cwd: PROJECT_ROOT,
		stdio: 'inherit',
		reject: false,
	})

	if (result.exitCode === 0) console.info('  ✔ removed   git hooks')
	else console.warn('  ⚠ lefthook uninstall failed — run it manually: lefthook uninstall')
}

function is_empty_directory(directory: string): boolean {
	return existsSync(directory) && readdirSync(directory).length === 0
}

// A directory kit created for its own file — `.vscode`, `.github` — goes with the last file in it,
// and one that still holds anything of the project's stays.
function remove_empty_parents(relative_path: string): void {
	let directory = path.dirname(relative_path)

	while (directory !== '.' && is_empty_directory(project_path(directory))) {
		rmdirSync(project_path(directory))
		directory = path.dirname(directory)
	}
}

function remove_file(relative_path: string): void {
	rmSync(project_path(relative_path))
	remove_empty_parents(relative_path)
	console.info(`  ✔ removed   ${relative_path}`)
}

function strip_manifest(): void {
	const manifest = read_project_file(PACKAGE_JSON)
	if (manifest === undefined) return

	writeFileSync(project_path(PACKAGE_JSON), uninstall_plan.strip_kit(manifest))
	console.info(`  ✔ updated   ${PACKAGE_JSON}`)
}

function execute(plan: UninstallPlan): void {
	console.info('\nRemoving:')
	if (plan.has_git_hooks) remove_git_hooks()
	for (const file of plan.files.remove) remove_file(file)
	if (plan.has_manifest_entries) strip_manifest()
	console.info(`\n${uninstall_report.next_steps()}\n\n✅ Done.\n`)
}

// The refusal `josh init` and `josh sync` make, for the opposite damage: in kit's own repository
// every distributed file is the source, and each of them equals what kit distributes.
async function main(args: ReadonlyArray<string> = []): Promise<void> {
	if (did_refuse_self_run(PACKAGE_DIR, PROJECT_ROOT)) return
	const options = parse_options(args)
	const plan = build_plan(options.profile)

	console.info(`\n🧹 Uninstalling @joshuafolkken/kit (profile: ${options.profile})\n`)
	console.info(uninstall_report.describe(plan))

	if (uninstall_report.is_empty(plan)) {
		console.info('\nNothing of kit is left to remove.\n')

		return
	}

	if (await is_confirmed(options.is_yes)) execute(plan)
}

async function run_cli(args: ReadonlyArray<string>): Promise<void> {
	try {
		await main(args)
	} catch (error) {
		console.error(`\n✖ ${error_text.message_of(error)}\n`)
		process.exitCode = 1
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await run_cli(process.argv.slice(ARGUMENT_START_INDEX))
}

export { main }
