#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auto_merge_setting } from '#scripts/auto-merge-setting'
import { copy_directory_failure, directory_copy_blocker } from '#scripts/directory-copy-guard'
import { gh_spawn } from '#scripts/gh-spawn'
import { transform_copied_content } from '#scripts/init/init-copy-content'
import { init_logic } from '#scripts/init/init-logic'
import { PACKAGE_DIR, PROJECT_ROOT } from '#scripts/init/init-paths'
import { security_updates } from '#scripts/security-updates'
import { sonar_file } from '#scripts/sonar-file'
import { package_manager_version } from '#scripts/version/package-manager-version'
import { sync_configs } from './sync-configs'

const WORKSPACE_YAML = 'pnpm-workspace.yaml'
const PACKAGE_JSON = 'package.json'
const PACKAGE_JSON_UNCHANGED_MSG = '  ✔ unchanged package.json'

function sync_ai_file(source_path: string, destination_path: string): void {
	mkdirSync(path.dirname(destination_path), { recursive: true })
	const content = readFileSync(source_path, 'utf8')

	writeFileSync(destination_path, transform_copied_content(destination_path, content))
}

function sync_file(filename: string): void {
	sync_ai_file(path.join(PACKAGE_DIR, filename), path.join(PROJECT_ROOT, filename))
	console.info(`  ✔ synced    ${filename}`)
}

function sync_file_mapping(source_path: string, destination_path: string): void {
	if (!existsSync(source_path)) {
		console.warn(`  ⚠ skipped   ${path.basename(destination_path)} (not found in package)`)

		return
	}

	// Routed through sync_ai_file rather than cpSync: templates/workflows/ci.yml is a mapped
	// file, so a byte copy would hand the consumer the template's own action pins. The pins
	// have to be resolved from .github/workflows at write time (joshuafolkken/kit#747).
	sync_ai_file(source_path, destination_path)
	console.info(`  ✔ synced    ${path.basename(destination_path)}`)
}

function sync_workspace_yaml(
	template_path: string,
	destination_path: string,
	is_force = false,
): void {
	const template = readFileSync(template_path, 'utf8')
	const existing =
		!is_force && existsSync(destination_path) ? readFileSync(destination_path, 'utf8') : ''
	const merged = init_logic.merge_workspace_yaml(existing, template)

	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, merged)
}

function sync_ai_copy_file(filename: string, is_force: boolean): void {
	if (filename === WORKSPACE_YAML) {
		sync_workspace_yaml(
			path.join(PACKAGE_DIR, WORKSPACE_YAML),
			path.join(PROJECT_ROOT, WORKSPACE_YAML),
			is_force,
		)
		console.info(`  ✔ synced    ${WORKSPACE_YAML}`)

		return
	}

	sync_file(filename)
}

// The reason this directory was not synced, or nothing when it was. Both halves answer the same
// question — what stops the copy — so the caller has one line to print either way.
function directory_sync_failure(directory_name: string): string | undefined {
	const source_path = path.join(PACKAGE_DIR, directory_name)
	const destination_path = path.join(PROJECT_ROOT, directory_name)

	return (
		directory_copy_blocker(source_path, destination_path) ??
		copy_directory_failure(source_path, destination_path)
	)
}

function sync_directory(directory_name: string): void {
	const failure = directory_sync_failure(directory_name)

	if (failure !== undefined) {
		console.warn(`  ⚠ skipped   ${directory_name}/ (${failure})`)

		return
	}

	console.info(`  ✔ synced    ${directory_name}/`)
}

function did_migrate_prettierrc(destination_path: string): boolean {
	const legacy_path = path.join(path.dirname(destination_path), '.prettierrc')
	if (!existsSync(legacy_path)) return false

	const existing = readFileSync(legacy_path, 'utf8')

	writeFileSync(destination_path, init_logic.merge_prettier_config(existing))
	rmSync(legacy_path)

	return true
}

function write_merged_prettier_config(destination_path: string): void {
	const existing = readFileSync(destination_path, 'utf8')
	const merged = init_logic.merge_prettier_config(existing)

	if (merged === existing) {
		console.info('  ✔ unchanged prettier.config.js')

		return
	}

	writeFileSync(destination_path, merged)
	console.info('  ✔ synced    prettier.config.js')
}

function sync_prettier_config(destination_path: string): void {
	if (did_migrate_prettierrc(destination_path)) {
		console.info('  ✔ migrated  .prettierrc → prettier.config.js')

		return
	}

	if (!existsSync(destination_path)) return

	write_merged_prettier_config(destination_path)
}

function sync_playwright_config(destination_path: string): void {
	if (!existsSync(destination_path)) return

	const template = init_logic.generate_playwright_config()
	const existing = readFileSync(destination_path, 'utf8')

	if (template === existing) {
		console.info('  ✔ unchanged playwright.config.ts')

		return
	}

	writeFileSync(destination_path, template)
	console.info('  ✔ synced    playwright.config.ts')
}

function sync_deploy_vps(destination_path: string): void {
	if (!existsSync(destination_path)) return

	const existing = readFileSync(destination_path, 'utf8')
	const patched = init_logic.patch_deploy_vps_pnpm(existing)

	if (patched === existing) {
		console.info('  ✔ unchanged deploy-vps.yml')

		return
	}

	writeFileSync(destination_path, patched)
	console.info('  ✔ synced    deploy-vps.yml')
}

function sync_sonar_with_template(name_with_owner: string | undefined, is_force = false): void {
	const destination = init_logic.get_sonar_template_destination()

	if (name_with_owner === undefined) {
		console.warn(`  ⚠ skipped   ${destination} (gh repo view failed)`)

		return
	}

	const template_source = path.join(PACKAGE_DIR, init_logic.get_sonar_template_source())
	const identifiers = init_logic.derive_sonar_identifiers(name_with_owner)
	const write_function = is_force ? sonar_file.write_sonar_file : sonar_file.merge_sonar_file

	write_function(template_source, path.join(PROJECT_ROOT, destination), identifiers)
	console.info(`  ✔ synced    ${destination}`)
}

function sync_ai_copy_all(is_force: boolean): void {
	console.info('AI files:')

	for (const filename of init_logic.get_ai_copy_files()) {
		sync_ai_copy_file(filename, is_force)
	}

	for (const { src, dest } of init_logic.get_ai_copy_file_mappings()) {
		sync_file_mapping(path.join(PACKAGE_DIR, src), path.join(PROJECT_ROOT, dest))
	}

	for (const directory_name of init_logic.get_ai_copy_directories()) {
		sync_directory(directory_name)
	}
}

function sync_config_files(): void {
	sync_configs.sync_npmrc(path.join(PROJECT_ROOT, '.npmrc'))
	sync_configs.sync_gitignore(path.join(PROJECT_ROOT, '.gitignore'))
	sync_configs.sync_eslint_config(path.join(PROJECT_ROOT, 'eslint.config.js'))
	sync_configs.sync_tsconfig(path.join(PROJECT_ROOT, 'tsconfig.json'))
	sync_configs.sync_cspell_config(path.join(PROJECT_ROOT, 'cspell.config.yaml'))
	sync_configs.sync_lefthook_config(path.join(PROJECT_ROOT, 'lefthook.yml'))
	sync_configs.sync_secretlint_config(path.join(PROJECT_ROOT, '.secretlintrc.json'))
	sync_configs.sync_vscode_extensions_json(path.join(PROJECT_ROOT, '.vscode/extensions.json'))
	sync_configs.sync_vscode_settings_json(path.join(PROJECT_ROOT, '.vscode/settings.json'))
}

function sync_package_json_with(
	destination_path: string,
	transform: (existing: string) => string,
	synced_message: string,
): void {
	if (!existsSync(destination_path)) return

	const existing = readFileSync(destination_path, 'utf8')
	const transformed = transform(existing)

	if (transformed === existing) {
		console.info(PACKAGE_JSON_UNCHANGED_MSG)

		return
	}

	writeFileSync(destination_path, transformed)
	console.info(synced_message)
}

// Repair an existing consumer manifest whose devEngines.packageManager.version
// has drifted from its packageManager pin, so the pnpm dual-declaration warning
// stays suppressed.
function sync_package_manager_version(destination_path: string): void {
	sync_package_json_with(
		destination_path,
		(existing) => package_manager_version.align_development_engines_version(existing),
		'  ✔ synced    devEngines.packageManager.version',
	)
}

// The pre-commit secretlint rule resolves secretlint from the consumer project, so a project
// that predates the rule needs the devDependencies added here (then `pnpm install`) before the
// hook can run. `josh init` covers fresh projects; this covers everyone already initialized.
function sync_secretlint_development_deps(destination_path: string): void {
	sync_package_json_with(
		destination_path,
		(existing) => init_logic.merge_secretlint_development_deps(existing),
		'  ✔ synced    secretlint devDependencies (run `pnpm install`)',
	)
}

// Two distributed artifacts each depend on a repository setting kit cannot write, and both reports
// are tied to the moment the artifact reaches the consumer. `.github/dependabot.yml` disables npm
// version updates (joshuafolkken/kit#803), so a synced consumer only receives npm Dependabot pull
// requests through the security-advisory path (joshuafolkken/kit#805);
// `.github/workflows/dependabot-auto-merge.yml` runs `gh pr merge --auto`, which fails outright
// unless the repository allows auto-merge (joshuafolkken/kit#834). Neither ever fails the sync: both
// are GitHub-side state, not synced artifacts. Unconditional, unlike `init`, because `sync`
// overwrites both files on every run.
function report_repository_settings(name_with_owner: string | undefined): void {
	security_updates.report_security_updates_section(name_with_owner)
	auto_merge_setting.report_auto_merge_section(name_with_owner)
}

function sync_project_artifacts(is_force: boolean): void {
	sync_ai_copy_all(is_force)
	sync_prettier_config(path.join(PROJECT_ROOT, 'prettier.config.js'))
	sync_playwright_config(path.join(PROJECT_ROOT, 'playwright.config.ts'))
	sync_deploy_vps(path.join(PROJECT_ROOT, '.github/workflows/deploy-vps.yml'))
	// Resolved where the Sonar sync has always needed it, and reused by the report below, so
	// `gh repo view` runs once rather than twice. The position is the pre-existing one: the writes
	// after this line already ran after the lookup before this change.
	const name_with_owner = gh_spawn.get_repo_name_with_owner()

	sync_sonar_with_template(name_with_owner, is_force)
	sync_config_files()
	sync_package_manager_version(path.join(PROJECT_ROOT, PACKAGE_JSON))
	sync_secretlint_development_deps(path.join(PROJECT_ROOT, PACKAGE_JSON))
	report_repository_settings(name_with_owner)
}

function main(): void {
	const is_force = process.argv.includes('--force')

	console.info('\n🔄 Syncing @joshuafolkken/kit AI files\n')
	sync_project_artifacts(is_force)
	console.info('\n✅ Done.\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const sync = {
	sync_file_mapping,
	sync_ai_file,
	sync_workspace_yaml,
	sync_prettier_config,
	sync_playwright_config,
	sync_deploy_vps,
	sync_package_manager_version,
	sync_secretlint_development_deps,
	migrate_prettierrc: did_migrate_prettierrc,
}

// `sync` is the entry point; `sync_directory` is exported for its own unit test, the way
// `git-pr-checks.ts` exports the helpers beside its namespace.
export { sync, sync_directory }
