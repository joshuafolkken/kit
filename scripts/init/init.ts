#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolve_local_bin } from '#scripts/build/local-bin'
import { doctor_io } from '#scripts/doctor/doctor-io'
import { package_version_schema, with_package_manager_schema } from '#scripts/lib/schemas'
import { auto_merge_setting } from '#scripts/repo/auto-merge-setting'
import { project_config } from '#scripts/safe-chain/project-config'
import { security_updates } from '#scripts/security/security-updates'
import { did_refuse_self_run } from '#scripts/self-sync-guard/self-sync-refusal'
import { sync } from '#scripts/sync/sync'
import { package_manager_version } from '#scripts/version/package-manager-version'
import { execaSync } from 'execa'
import { z } from 'zod'
import { init_actions, PRETTIER_CONFIG_JS, type FileAction } from './init-actions'
import { init_ai_copy } from './init-ai-copy'
import { init_logic } from './init-logic'
import { PACKAGE_DIR, PROJECT_ROOT } from './init-paths'
import { init_static } from './init-static'
import { plugin_install_hint_module } from './plugin-install-hint'
import { project_profile, type ProjectShape } from './project-profile'

const PACKAGE_JSON = 'package.json'
const KIT_PACKAGE_NAME = '@joshuafolkken/kit'
const LEFTHOOK_BIN = 'lefthook'
const SAMPLE_INDENT_WIDTH = 4
const ARGUMENT_START_INDEX = 2
const SAMPLE_INDENT = ' '.repeat(SAMPLE_INDENT_WIDTH)
const INSTALL_HINT = '→ run `pnpm install` to install what package.json lists'

function write_new_file(action: FileAction, destination_path: string): void {
	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, action.create())
	console.info(`  ✔ created   ${action.dest}`)
}

function show_sample(action: FileAction): void {
	console.info(`  ⚠ exists    ${action.dest} — add manually:`)
	console.info('')
	console.info(action.create().replaceAll(/^/gmu, () => SAMPLE_INDENT))
}

function merge_existing_file(
	merge_function: (existing: string) => string,
	destination_path: string,
	destination: string,
): void {
	const existing = readFileSync(destination_path, 'utf8')
	const merged = merge_function(existing)

	if (merged === existing) {
		console.info(`  ✔ unchanged ${destination}`)

		return
	}

	writeFileSync(destination_path, merged)
	console.info(`  ✔ updated   ${destination}`)
}

function execute_file_action(action: FileAction): void {
	const destination_path = path.join(PROJECT_ROOT, action.dest)
	const is_existing = existsSync(destination_path)

	if (!is_existing) {
		write_new_file(action, destination_path)

		return
	}

	if (action.merge === undefined) {
		show_sample(action)

		return
	}

	merge_existing_file(action.merge, destination_path, action.dest)
}

function get_kit_package_manager(): string | undefined {
	const { packageManager: package_manager } = with_package_manager_schema.parse(
		init_actions.read_package_json(PACKAGE_JSON),
	)

	return package_manager !== undefined && package_manager.length > 0 ? package_manager : undefined
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

function get_eslint_development_dependencies(): Record<string, string> {
	const manifest = z
		.object({
			peerDependencies: z.record(z.string(), z.string()),
			devDependencies: z.record(z.string(), z.string()),
		})
		.parse(init_actions.read_package_json(PACKAGE_JSON))
	const entries = Object.keys(manifest.peerDependencies)
		.filter((name) => name !== '@playwright/test')
		.map((name): [string, string] => {
			const version = manifest.devDependencies[name]
			if (version === undefined) throw new Error(`Missing development version for ${name}`)

			return [name, version]
		})

	return Object.fromEntries(entries)
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
	const with_prettier = init_logic.merge_prettier_plugin_development_deps(merged)
	const with_eslint = init_logic.merge_development_dependencies(
		with_prettier,
		get_eslint_development_dependencies(),
	)
	const with_secretlint = init_logic.merge_secretlint_development_deps(with_eslint)

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

function get_static_versions(): { kit: string; prettier: string } {
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
	if (shape.profile === 'static') {
		return init_static.merge_static_manifest(existing, shape, get_static_versions())
	}

	return init_static.with_recorded_profile(
		apply_package_json_merges(existing, shape.has_git),
		shape.profile,
	)
}

function merge_project_package_json(shape: ProjectShape): void {
	const package_json_path = path.join(PROJECT_ROOT, PACKAGE_JSON)
	const is_existing = existsSync(package_json_path)
	const existing = is_existing
		? readFileSync(package_json_path, 'utf8')
		: init_static.initial_manifest()
	const merged = merged_manifest(existing, shape)

	if (is_existing && merged === existing) {
		console.info('  ✔ unchanged package.json')

		return
	}

	writeFileSync(package_json_path, merged)
	console.info(`  ✔ ${is_existing ? 'updated' : 'created'}   package.json`)
	// `init` writes the manifest but installs nothing, so a tool it just listed is absent until the
	// user installs it — and `josh lint` then fails on it rather than skipping it
	// (joshuafolkken/kit#2709). Saying so here is what tells the user the next step.
	console.info(`    ${INSTALL_HINT}`)
}

function install_lefthook(): void {
	console.info('\nLefthook:')
	const bin = resolve_local_bin(PROJECT_ROOT, LEFTHOOK_BIN)
	const result = execaSync(bin, ['install'], { cwd: PROJECT_ROOT, stdio: 'inherit', reject: false })

	if (result.exitCode === undefined) {
		console.warn('  ⚠ lefthook install failed — run it manually: lefthook install')
	}
}

function run_config_file_actions(shape: ProjectShape): void {
	console.info('Config files:')

	if (
		shape.profile === 'node' &&
		sync.migrate_prettierrc(path.join(PROJECT_ROOT, PRETTIER_CONFIG_JS))
	) {
		console.info('  ✔ migrated  .prettierrc → prettier.config.js')
	}

	for (const action of init_actions.build_file_actions(shape)) {
		execute_file_action(action)
	}
}

// Gated, unlike `sync`: `init` skips a file the consumer already has, so neither the npm-disable
// (joshuafolkken/kit#803) nor the auto-merge workflow (joshuafolkken/kit#834) may have landed, and a
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
// 14 files #868 reproduced, `init` also rewrites `package.json` scripts and devDependencies
// (joshuafolkken/kit#879). Checked before the first write, for the reason the sync guard is.
function run_ai_file_actions(shape: ProjectShape): void {
	console.info('\nAI files:')
	// `init` writes the same npm-disabling `.github/dependabot.yml` that `sync` distributes, so a
	// freshly scaffolded repository is exposed from its first commit — and a new private repository
	// is exactly where the setting is off by default. The name is the one the Sonar config already
	// resolved, so `gh repo view` runs once; the position is the pre-existing one.
	const name_with_owner = init_ai_copy.run_ai_copies(shape)

	if (shape.has_git && shape.profile === 'node') install_lefthook()

	if (shape.has_github) report_repository_settings(name_with_owner)

	if (shape.profile === 'node') plugin_install_hint_module.report_plugin_install_hint()
}

function initialize_project(shape: ProjectShape): void {
	console.info('\n🚀 Initializing @joshuafolkken/kit\n')
	console.info(`profile: ${shape.profile} (${shape.reason})`)
	run_config_file_actions(shape)

	console.info('\nPackage scripts:')
	merge_project_package_json(shape)

	run_ai_file_actions(shape)
	if (shape.profile === 'node') project_config.sync_project_config(PROJECT_ROOT)
	console.info('\n✅ Done.\n')
}

function main(args: ReadonlyArray<string> = []): void {
	if (did_refuse_self_run(PACKAGE_DIR, PROJECT_ROOT)) return
	const requested = project_profile.requested_profile(args)
	const shape = project_profile.inspect_project(PROJECT_ROOT, requested)

	initialize_project(shape)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(ARGUMENT_START_INDEX))
}

const init = {
	copy_ai_file: init_ai_copy.copy_ai_file,
	apply_package_json_merges,
	install_lefthook,
}

// `init` is the entry point; `main` is exported for its own unit test, the way `sync.ts` exports the
// `main()` its self-run guard lives in.
export { init, main }
