#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolve_local_bin } from '#scripts/build/local-bin'
import { doctor_io } from '#scripts/doctor/doctor-io'
import { error_text } from '#scripts/lib/error-message'
import { package_version_schema, with_package_manager_schema } from '#scripts/lib/schemas'
import { auto_merge_setting } from '#scripts/repo/auto-merge-setting'
import { pack_hook } from '#scripts/safe-chain/pack-hook'
import { project_config } from '#scripts/safe-chain/project-config'
import { security_updates } from '#scripts/security/security-updates'
import { did_refuse_self_run } from '#scripts/self-sync-guard/self-sync-refusal'
import { sync } from '#scripts/sync/sync'
import { package_manager_version } from '#scripts/version/package-manager-version'
import { execaSync } from 'execa'
import { z } from 'zod'
import { init_actions, PRETTIER_CONFIG_JS } from './init-actions'
import { init_ai_copy } from './init-ai-copy'
import { init_basic } from './init-basic'
import { init_bootstrap } from './init-bootstrap'
import { init_file_action } from './init-file-action'
import { init_install } from './init-install'
import { init_logic } from './init-logic'
import { PACKAGE_DIR, PROJECT_ROOT } from './init-paths'
import { kit_development_versions } from './kit-development-versions'
import { kit_setup_state } from './kit-setup-state'
import { package_manager_pin } from './package-manager-pin'
import { project_profile, type ProjectProfile, type ProjectShape } from './project-profile'

const PACKAGE_JSON = 'package.json'
const KIT_PACKAGE_NAME = '@joshuafolkken/kit'
const LEFTHOOK_BIN = 'lefthook'
const ARGUMENT_START_INDEX = 2
const INSTALL_HINT = '→ run `pnpm install` to install what package.json lists'
const INIT_USAGE = 'josh init [--profile basic|full] [--no-install]'

const engine_pin_schema = z.looseObject({ name: z.string(), version: z.string() })

const published_development_engines_schema = z.looseObject({
	devEngines: z.looseObject({ packageManager: engine_pin_schema.optional() }).optional(),
})

// pnpm strips `packageManager` from a published manifest, so the kit a consumer installs carries its
// pin only in `devEngines`. Falling back to that exact version keeps the consumer off the bare
// `>=12.1.0` range, which every later `pnpm` call rejects as an invalid packageManager specification.
function resolve_kit_package_manager(manifest: unknown): string | undefined {
	const { packageManager: package_manager } = with_package_manager_schema.parse(manifest)
	if (package_manager !== undefined && package_manager.length > 0) return package_manager
	const pin = published_development_engines_schema.parse(manifest).devEngines?.packageManager

	return pin === undefined ? undefined : `${pin.name}@${pin.version}`
}

function get_kit_package_manager(): string | undefined {
	return package_manager_pin.choose(
		resolve_kit_package_manager(init_actions.read_package_json(PACKAGE_JSON)),
		process.env['npm_config_user_agent'],
	)
}

function get_kit_development_engines(): Record<string, unknown> {
	return init_logic.get_development_engines_value()
}

// Pin the kit to its own published version so the generated configs (which all import
// `@joshuafolkken/kit/...`) resolve. Exact pin matches the consumer convention.
function get_kit_self_dependency(): Record<string, string> {
	const { version } = package_version_schema.parse(init_actions.read_package_json(PACKAGE_JSON))

	return { [KIT_PACKAGE_NAME]: version }
}

// Each config `init` generates runs a CLI or imports types the consumer has to resolve itself:
// `cspell.config.yaml` → cspell, `playwright.config.ts` → @types/node, `lefthook.yml` → lefthook.
// Prettier, its preset plugins and @playwright/test come in as peers. Without them the first
// `josh gate` after `pnpm install` fails.
const TOOL_DEVELOPMENT_DEPENDENCIES = ['cspell', '@types/node']
const LEFTHOOK_DEVELOPMENT_DEPENDENCY = 'lefthook'

function tool_dependency_names(has_git: boolean): ReadonlyArray<string> {
	return has_git
		? [...TOOL_DEVELOPMENT_DEPENDENCIES, LEFTHOOK_DEVELOPMENT_DEPENDENCY]
		: TOOL_DEVELOPMENT_DEPENDENCIES
}

// Versions mirror kit's own devDependencies, so the consumer runs the toolchain kit is verified with.
function get_toolchain_development_dependencies(has_git: boolean): Record<string, string> {
	return kit_development_versions.versions_of([
		...kit_development_versions.peer_names(),
		...tool_dependency_names(has_git),
	])
}

function apply_dependency_merges(content: string, has_git = true): string {
	const migrated = init_logic.strip_managed_postinstall(content)
	const suggested = init_logic.get_suggested_scripts_for_content(migrated)
	const merged = init_logic.merge_package_scripts(
		migrated,
		has_git
			? suggested
			: Object.fromEntries(Object.entries(suggested).filter(([key]) => key !== 'prepare')),
	)
	const with_toolchain = init_logic.merge_development_dependencies(
		merged,
		get_toolchain_development_dependencies(has_git),
	)
	const with_secretlint = init_logic.merge_secretlint_development_deps(with_toolchain)

	return init_logic.merge_development_dependencies(with_secretlint, get_kit_self_dependency())
}

function apply_package_json_merges(content: string, has_git = true): string {
	const with_kit = apply_dependency_merges(content, has_git)
	const upgraded = has_git ? init_logic.upgrade_prepare_lefthook_warning(with_kit) : with_kit
	const with_lifecycle = has_git ? init_logic.merge_prepare_lifecycle_cmd(upgraded) : upgraded
	const kit_pm = get_kit_package_manager()
	const with_pm =
		kit_pm === undefined ? with_lifecycle : init_logic.merge_package_manager(with_lifecycle, kit_pm)
	const with_de = init_logic.merge_development_engines(with_pm, get_kit_development_engines())
	const sorted = init_logic.sort_package_json_keys(with_de)

	// Pin devEngines.packageManager.version to the packageManager just written so a
	// freshly scaffolded (or re-initialized) consumer never trips the pnpm
	// dual-declaration warning.
	return package_manager_version.align_development_engines_version(sorted)
}

function get_basic_versions(): { kit: string; prettier: string } {
	const manifest = z
		.object({
			version: z.string(),
			devDependencies: z.record(z.string(), z.string()),
		})
		.parse(init_actions.read_package_json(PACKAGE_JSON))
	const { prettier } = manifest.devDependencies
	if (prettier === undefined) throw new Error('Missing prettier development version')

	return { kit: manifest.version, prettier }
}

function merged_manifest(existing: string, shape: ProjectShape): string {
	if (shape.profile === 'basic') {
		return init_basic.merge_basic_manifest(existing, shape, get_basic_versions())
	}

	return init_basic.with_recorded_profile(
		apply_package_json_merges(existing, shape.has_git),
		shape.profile,
	)
}

function merge_project_package_json(shape: ProjectShape): void {
	const package_json_path = path.join(PROJECT_ROOT, PACKAGE_JSON)
	const is_existing = existsSync(package_json_path)
	const existing = is_existing
		? readFileSync(package_json_path, 'utf8')
		: init_basic.initial_manifest()
	const merged = merged_manifest(existing, shape)

	if (is_existing && merged === existing) {
		console.info('  ✔ unchanged package.json')

		return
	}

	writeFileSync(package_json_path, merged)
	console.info(`  ✔ ${is_existing ? 'updated' : 'created'}   package.json`)
}

// Under `--no-install` a fresh project has no lefthook yet — added to devDependencies above — so the
// `prepare` script of the user's own `pnpm install` installs the hooks once it is.
function install_lefthook(project_root: string = PROJECT_ROOT): void {
	console.info('\nLefthook:')
	const bin = resolve_local_bin(project_root, LEFTHOOK_BIN)

	if (!existsSync(bin)) {
		console.info('  ℹ lefthook is not installed yet — `pnpm install` installs the git hooks')

		return
	}

	const result = execaSync(bin, ['install'], { cwd: project_root, stdio: 'inherit', reject: false })

	if (result.exitCode === undefined) {
		console.warn('  ⚠ lefthook install failed — run it manually: lefthook install')
	}
}

function run_config_file_actions(shape: ProjectShape): void {
	console.info('Config files:')

	if (
		shape.profile === 'full' &&
		sync.migrate_prettierrc(path.join(PROJECT_ROOT, PRETTIER_CONFIG_JS))
	) {
		console.info('  ✔ migrated  .prettierrc → prettier.config.js')
	}

	for (const action of init_actions.build_file_actions(shape)) {
		init_file_action.execute_file_action(action, PROJECT_ROOT)
	}
}

// Gated, unlike `sync`: `init` skips a file the consumer already has, so neither the npm-disable
// nor the auto-merge workflow may have landed, and a
// report's claim would then be false. `sync` overwrites both unconditionally, which is why it needs
// no gate. The gates are the artifacts themselves, so a consumer's own pre-existing auto-merge
// workflow still gets its prerequisite reported — it needs the same repository setting kit's does.
function report_repository_settings(name_with_owner: string | undefined): void {
	if (doctor_io.has_distributed_dependabot_config(PROJECT_ROOT, PROJECT_ROOT)) {
		security_updates.report_security_updates_section(name_with_owner)
	}

	if (doctor_io.has_auto_merge_workflow(PROJECT_ROOT, PROJECT_ROOT)) {
		auto_merge_setting.report_auto_merge_section(name_with_owner)
	}
}

// The same refusal `sync` makes, for a larger blast radius: `init` calls the `sync` writers directly
// rather than through `sync`'s own `main()`, so the guard there never ran for it — and on top of the
// 14 files #868 reproduced, `init` also rewrites `package.json` scripts and devDependencies.
// Checked before the first write, for the reason the sync guard is.
function run_ai_file_actions(shape: ProjectShape): void {
	console.info('\nAI files:')
	// `init` writes the same npm-disabling `.github/dependabot.yml` that `sync` distributes, so a
	// freshly scaffolded repository is exposed from its first commit — and a new private repository
	// is exactly where the setting is off by default. The name is the one the Sonar config already
	// resolved, so `gh repo view` runs once; the position is the pre-existing one.
	const name_with_owner = init_ai_copy.run_ai_copies(shape)

	if (shape.has_github) report_repository_settings(name_with_owner)
}

function initialize_project(shape: ProjectShape): void {
	console.info('\n🚀 Initializing @joshuafolkken/kit\n')
	console.info(`profile: ${shape.profile} (${shape.reason})`)
	run_config_file_actions(shape)

	console.info('\nPackage scripts:')
	merge_project_package_json(shape)

	run_ai_file_actions(shape)
	pack_hook.sync_pack_hook(PROJECT_ROOT, PACKAGE_DIR)
	if (shape.profile === 'full') project_config.sync_project_config(PROJECT_ROOT)
}

// A tool `init` just listed is absent until the user installs it — and `josh lint` then fails on it
// rather than skipping it. Saying so is what tells the user the next step.
function report_manual_install(shape: ProjectShape): void {
	console.info(`\nDependencies:\n  ${INSTALL_HINT}`)
	if (shape.has_git && shape.profile === 'full') install_lefthook()
}

// The install runs the `prepare` script, which installs the git hooks. A failure is thrown rather
// than printed, so `josh start` — which calls this entry point — stops before its first commit.
function finish_dependencies(shape: ProjectShape, is_install: boolean): void {
	if (!is_install) {
		report_manual_install(shape)

		return
	}

	const failure = init_install.run_post_init_steps(PROJECT_ROOT)
	if (failure !== undefined) throw new Error(failure)
}

// A kit run from outside the project — `pnpm dlx`, a global install — sets nothing up itself: it
// installs the project's kit and hands the whole run to that one. Under
// `--no-install` nothing is installed, so the running kit does the setup as before.
function did_hand_off(args: ReadonlyArray<string>): boolean {
	if (init_bootstrap.is_project_kit(PACKAGE_DIR, PROJECT_ROOT)) return false
	const failure = init_bootstrap.hand_off(PACKAGE_DIR, PROJECT_ROOT, args)
	if (failure !== undefined) throw new Error(failure)

	return true
}

function set_up_project(requested: ProjectProfile | undefined, is_install: boolean): void {
	const shape = project_profile.inspect_project(PROJECT_ROOT, requested)

	initialize_project(shape)
	finish_dependencies(shape, is_install)
	console.info('\n✅ Done.\n')
}

// True when this process set the project up — false when it refused, or handed the run to the
// project's own kit, which then speaks for itself.
function main(args: ReadonlyArray<string> = []): boolean {
	if (did_refuse_self_run(PACKAGE_DIR, PROJECT_ROOT)) return false
	const { is_install, rest } = init_install.split_install_flag(args)
	// Validated before the hand-off, so a malformed invocation is refused before kit is installed.
	const requested = project_profile.requested_profile(rest, INIT_USAGE)

	const is_set_up_here = !is_install || !did_hand_off(args)

	if (is_set_up_here) set_up_project(requested, is_install)

	return is_set_up_here
}

// Only the command a person typed points onward to `josh start`: `josh start` calls `main` itself and
// is already the next step.
// A setup that failed after writing, such as a failed install, sets the exit code and points nowhere.
function print_start_hint(): void {
	if (process.exitCode !== undefined && process.exitCode !== 0) return
	const hint = kit_setup_state.start_hint(PROJECT_ROOT)

	if (hint !== undefined) console.info(`${hint}\n`)
}

function run_cli(args: ReadonlyArray<string>): void {
	try {
		if (main(args)) print_start_hint()
	} catch (error) {
		console.error(`\n✖ ${error_text.message_of(error)}\n`)
		process.exitCode = 1
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	run_cli(process.argv.slice(ARGUMENT_START_INDEX))
}

const init = {
	copy_ai_file: init_ai_copy.copy_ai_file,
	apply_package_json_merges,
	install_lefthook,
	resolve_kit_package_manager,
}

// `init` is the entry point; `main` is exported for its own unit test, the way `sync.ts` exports the
// `main()` its self-run guard lives in.
export { init, main }
