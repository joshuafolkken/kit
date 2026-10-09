#!/usr/bin/env tsx
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { project_checks } from '#scripts/gate/project-checks'
import { gh_spawn } from '#scripts/gh/gh-spawn'
import { basic_path_migration } from '#scripts/init/basic-path-migration'
import { init_logic } from '#scripts/init/init-logic'
import { PACKAGE_DIR, PROJECT_ROOT } from '#scripts/init/init-paths'
import { project_profile } from '#scripts/init/project-profile'
import { auto_merge_setting } from '#scripts/repo/auto-merge-setting'
import { repository_labels } from '#scripts/repo/repository-labels'
import { project_config } from '#scripts/safe-chain/project-config'
import { security_updates } from '#scripts/security/security-updates'
import { sonar_file } from '#scripts/security/sonar-file'
import { did_refuse_self_run } from '#scripts/self-sync-guard/self-sync-refusal'
import { package_manager_version } from '#scripts/version/package-manager-version'
import { file_content } from './file-content'
import { sync_ai_files } from './sync-ai-files'
import { sync_configs } from './sync-configs'

const PACKAGE_JSON = 'package.json'
const PACKAGE_JSON_UNCHANGED_MSG = '  ✔ unchanged package.json'
const BASIC_PRETTIER_CONFIG = 'prettier.config.mjs'

function did_migrate_prettierrc(destination_path: string): boolean {
	const legacy_path = path.join(path.dirname(destination_path), '.prettierrc')
	if (!existsSync(legacy_path)) return false

	const existing = readFileSync(legacy_path, 'utf8')

	writeFileSync(
		destination_path,
		init_logic.merge_prettier_config(existing, path.dirname(destination_path)),
	)
	rmSync(legacy_path)

	return true
}

function write_merged_prettier_config(destination_path: string): void {
	const existing = readFileSync(destination_path, 'utf8')
	const merged = init_logic.merge_prettier_config(existing, path.dirname(destination_path))

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

// A basic project's prettier config written under the static profile name still imports the static
// preset path; it is moved onto the basic one with the rule `josh init` applies.
function sync_basic_prettier_config(destination_path: string): void {
	if (!existsSync(destination_path)) return

	const existing = readFileSync(destination_path, 'utf8')
	const did_change = file_content.write_text_if_changed(
		destination_path,
		basic_path_migration.migrate_basic_paths(existing),
	)

	console.info(`  ✔ ${did_change ? 'synced   ' : 'unchanged'} ${BASIC_PRETTIER_CONFIG}`)
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
	sync_configs.sync_vscode_tasks_json(path.join(PROJECT_ROOT, '.vscode/tasks.json'))
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

// A manifest an earlier `josh init` wrote rejects a standalone pnpm of another version outright;
// `"download"` fetches the pin instead.
function sync_package_manager_on_fail(destination_path: string): void {
	sync_package_json_with(
		destination_path,
		(existing) => package_manager_version.upgrade_development_engines_on_fail(existing),
		'  ✔ synced    devEngines.packageManager.onFail',
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

// `lefthook install` fails silently when `core.hooksPath` is set, leaving a consumer with no hooks
// and no message. `josh init` rewrites the clause it wrote so the failure
// is reported; this covers everyone already initialized, who never re-runs `josh init`.
function sync_prepare_lefthook_warning(destination_path: string): void {
	sync_package_json_with(
		destination_path,
		(existing) => init_logic.upgrade_prepare_lefthook_warning(existing),
		'  ✔ synced    prepare lefthook install warning (run `pnpm install`)',
	)
}

// The `preinstall` earlier kits wrote fetched safe-chain on every install;
// `josh init` replaces it, and this covers everyone already initialized.
function sync_safe_chain_preinstall(destination_path: string): void {
	sync_package_json_with(
		destination_path,
		(existing) => init_logic.upgrade_safe_chain_preinstall(existing),
		'  ✔ synced    preinstall safe-chain check',
	)
}

// Every migration an already-initialized consumer needs applied to its own manifest, run as one
// group so the next one is added here rather than at the call site.
function sync_package_json_migrations(destination_path: string): void {
	sync_package_manager_version(destination_path)
	sync_package_manager_on_fail(destination_path)
	sync_secretlint_development_deps(destination_path)
	sync_prepare_lefthook_warning(destination_path)
	sync_safe_chain_preinstall(destination_path)
}

// Two distributed artifacts each depend on a repository setting kit cannot write, and both reports
// are tied to the moment the artifact reaches the consumer. `.github/dependabot.yml` disables npm
// version updates, so a synced consumer only receives npm Dependabot pull
// requests through the security-advisory path;
// `.github/workflows/dependabot-auto-merge.yml` runs `gh pr merge --auto`, which fails outright
// unless the repository allows auto-merge. Neither ever fails the sync: both
// are GitHub-side state, not synced artifacts. Unconditional, unlike `init`, because `sync`
// overwrites both files on every run.
//
// The labels are the same kind of GitHub-side prerequisite, and one kit *can* write: the synced
// `pr-classification.yml` requires one of the release classification labels, so the missing ones are
// created here rather than reported.
function report_repository_settings(name_with_owner: string | undefined): void {
	security_updates.report_security_updates_section(name_with_owner)
	auto_merge_setting.report_auto_merge_section(name_with_owner)
	repository_labels.ensure_labels(name_with_owner)
}

function sync_project_artifacts(is_force: boolean): void {
	sync_ai_files.sync_ai_copy_all(is_force)
	sync_prettier_config(path.join(PROJECT_ROOT, 'prettier.config.js'))
	sync_playwright_config(path.join(PROJECT_ROOT, 'playwright.config.ts'))
	sync_deploy_vps(path.join(PROJECT_ROOT, '.github/workflows/deploy-vps.yml'))
	// Resolved where the Sonar sync has always needed it, and reused by the report below, so
	// `gh repo view` runs once rather than twice. The position is the pre-existing one: the writes
	// after this line already ran after the lookup before this change.
	const name_with_owner = gh_spawn.get_repo_name_with_owner()

	sync_sonar_with_template(name_with_owner, is_force)
	sync_config_files()
	// After `sync_ai_copy_all`, which may add the `pnpm-workspace.yaml` window `.aikido`'s age is
	// derived from.
	project_config.sync_project_config(PROJECT_ROOT)
	sync_package_json_migrations(path.join(PROJECT_ROOT, PACKAGE_JSON))
	report_repository_settings(name_with_owner)
}

// A basic project gets what `josh init` gives that profile and nothing more: its AI file set and the
// move of its prettier preset path. The full toolchain's configs, Sonar, package.json migrations and
// repository settings are never written into it.
function sync_basic_artifacts(is_force: boolean): void {
	console.info('profile: basic (package.json josh.profile)\n')
	sync_ai_files.sync_ai_copy_all(is_force, project_profile.inspect_project(PROJECT_ROOT, 'basic'))
	sync_basic_prettier_config(path.join(PROJECT_ROOT, BASIC_PRETTIER_CONFIG))
}

// Checked before anything is written, never per file: the damage is the whole run, and a partial
// sync that stopped halfway would leave the source repository in a state neither `git checkout` nor
// a re-run describes.
//
// Only a recorded basic profile switches the file set; an unrecorded one stays full, as every
// project initialized before the profile was recorded was set up.
function main(): void {
	if (did_refuse_self_run(PACKAGE_DIR, PROJECT_ROOT)) return

	const is_force = process.argv.includes('--force')

	console.info('\n🔄 Syncing @joshuafolkken/kit AI files\n')
	if (project_checks.is_basic(PROJECT_ROOT)) sync_basic_artifacts(is_force)
	else sync_project_artifacts(is_force)
	console.info('\n✅ Done.\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const sync = {
	should_skip_hook_file: sync_ai_files.should_skip_hook_file,
	sync_file_mapping: sync_ai_files.sync_file_mapping,
	sync_ai_file: sync_ai_files.sync_ai_file,
	sync_workspace_yaml: sync_ai_files.sync_workspace_yaml,
	sync_claude_md: sync_ai_files.sync_claude_md,
	sync_prettier_config,
	sync_playwright_config,
	sync_deploy_vps,
	sync_package_manager_version,
	sync_package_manager_on_fail,
	sync_secretlint_development_deps,
	sync_prepare_lefthook_warning,
	sync_safe_chain_preinstall,
	sync_package_json_migrations,
	migrate_prettierrc: did_migrate_prettierrc,
}

// `sync` is the entry point; `sync_directory` and `main` are exported for their own unit tests, the
// way `git-pr-checks.ts` exports the helpers beside its namespace.
const { sync_directory } = sync_ai_files

export { main, sync, sync_directory }
