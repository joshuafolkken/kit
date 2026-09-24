#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gh_spawn } from '#scripts/gh/gh-spawn'
import { transform_copied_content } from '#scripts/init/init-copy-content'
import { init_logic } from '#scripts/init/init-logic'
import { PACKAGE_DIR, PROJECT_ROOT } from '#scripts/init/init-paths'
import { plugin_install_hint_module } from '#scripts/init/plugin-install-hint'
import { auto_merge_setting } from '#scripts/repo/auto-merge-setting'
import { security_updates } from '#scripts/security/security-updates'
import { sonar_file } from '#scripts/security/sonar-file'
import { did_refuse_self_run } from '#scripts/self-sync-guard/self-sync-refusal'
import { package_manager_version } from '#scripts/version/package-manager-version'
import { copy_directory_failure, directory_copy_blocker } from './directory-copy-guard'
import { REMOVED_SKILL_MANIFEST } from './removed-skill-manifest'
import { skill_migration, type MigrationResult } from './skill-migration'
import { sync_configs } from './sync-configs'
import { sync_hook_safety } from './sync-hook-safety'

const WORKSPACE_YAML = 'pnpm-workspace.yaml'
const PACKAGE_JSON = 'package.json'
const PACKAGE_JSON_UNCHANGED_MSG = '  ✔ unchanged package.json'
const CLAUDE_MD_FILENAME = 'CLAUDE.md'
const CLAUDE_SETTINGS_FILE = '.claude/settings.json'
const CODEX_HOOKS_FILE = '.codex/hooks.json'

function sync_ai_file(source_path: string, destination_path: string): void {
	mkdirSync(path.dirname(destination_path), { recursive: true })
	const content = readFileSync(source_path, 'utf8')

	writeFileSync(destination_path, transform_copied_content(destination_path, content))
}

// Both copied hook files must run against the consumer's installed bundle. When sync is run from a
// newer source than that install, writing either file would leave hooks
// that fail every prompt (joshuafolkken/kit#1930); skip it and print how to update instead.
function should_skip_hook_file(filename: string): boolean {
	if (filename !== CLAUDE_SETTINGS_FILE && filename !== CODEX_HOOKS_FILE) return false
	const warning = sync_hook_safety.hook_write_warning(
		PROJECT_ROOT,
		sync_hook_safety.read_version_at(path.join(PACKAGE_DIR, PACKAGE_JSON)),
		filename,
	)
	if (warning === undefined) return false
	console.warn(warning)

	return true
}

function sync_file(filename: string): void {
	if (should_skip_hook_file(filename)) return
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

// A consumer's stale copy of a distributed skill is removed once it still matches the shipment and
// kept with a warning once it does not (joshuafolkken/kit#1879). Plugin skills compare against the
// package source; a retired skill compares against the frozen manifest (joshuafolkken/kit#1990). The
// note distinguishes the two, and `absent` — the consumer never had the copy — prints nothing.
function report_migration_result(result: MigrationResult): void {
	if (result.action === 'absent') return

	if (result.action === 'removed') {
		console.info(
			`  ✔ removed   ${result.directory}/ (${skill_migration.removed_note(result.source)})`,
		)

		return
	}

	console.warn(`  ⚠ kept      ${result.directory}/ (${skill_migration.kept_note(result.source)})`)
}

function migrate_removed_skills(): void {
	const plugin = skill_migration.migrate_removed_skill_directories(PACKAGE_DIR, PROJECT_ROOT)
	const retired = skill_migration.migrate_manifest_skills(PROJECT_ROOT, REMOVED_SKILL_MANIFEST)

	for (const result of [...plugin, ...retired]) report_migration_result(result)
}

// CLAUDE.md is not byte-copied (joshuafolkken/kit#1878): a consumer's file is one @import of kit's
// published rules plus the project's own additions below it. Ensure the import line is present
// without ever disturbing those additions — so this ignores --force, which would otherwise mean
// discarding a consumer's content.
function sync_claude_md(destination_path: string): void {
	const existing = existsSync(destination_path) ? readFileSync(destination_path, 'utf8') : undefined
	const ensured = init_logic.ensure_claude_md_import(existing)

	if (ensured === existing) {
		console.info(`  ✔ unchanged ${CLAUDE_MD_FILENAME}`)

		return
	}

	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, ensured)
	console.info(`  ✔ synced    ${CLAUDE_MD_FILENAME}`)
}

function sync_ai_copy_all(is_force: boolean): void {
	console.info('AI files:')

	sync_claude_md(path.join(PROJECT_ROOT, CLAUDE_MD_FILENAME))

	for (const filename of init_logic.get_ai_copy_files()) {
		sync_ai_copy_file(filename, is_force)
	}

	for (const { src, dest } of init_logic.get_ai_copy_file_mappings()) {
		sync_file_mapping(path.join(PACKAGE_DIR, src), path.join(PROJECT_ROOT, dest))
	}

	for (const directory_name of init_logic.get_ai_copy_directories()) {
		sync_directory(directory_name)
	}

	migrate_removed_skills()
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

// `lefthook install` fails silently when `core.hooksPath` is set, leaving a consumer with no hooks
// and no message (joshuafolkken/kit#1503). `josh init` rewrites the clause it wrote so the failure
// is reported; this covers everyone already initialized, who never re-runs `josh init`.
function sync_prepare_lefthook_warning(destination_path: string): void {
	sync_package_json_with(
		destination_path,
		(existing) => init_logic.upgrade_prepare_lefthook_warning(existing),
		'  ✔ synced    prepare lefthook install warning (run `pnpm install`)',
	)
}

// Every migration an already-initialized consumer needs applied to its own manifest, run as one
// group so the next one is added here rather than at the call site.
function sync_package_json_migrations(destination_path: string): void {
	sync_package_manager_version(destination_path)
	sync_secretlint_development_deps(destination_path)
	sync_prepare_lefthook_warning(destination_path)
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
	sync_package_json_migrations(path.join(PROJECT_ROOT, PACKAGE_JSON))
	report_repository_settings(name_with_owner)
}

// Checked before anything is written, never per file: the damage is the whole run, and a partial
// sync that stopped halfway would leave the source repository in a state neither `git checkout` nor
// a re-run describes (joshuafolkken/kit#868).
function main(): void {
	if (did_refuse_self_run(PACKAGE_DIR, PROJECT_ROOT)) return

	const is_force = process.argv.includes('--force')

	console.info('\n🔄 Syncing @joshuafolkken/kit AI files\n')
	sync_project_artifacts(is_force)
	plugin_install_hint_module.report_plugin_install_hint()
	console.info('\n✅ Done.\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const sync = {
	should_skip_hook_file,
	sync_file_mapping,
	sync_ai_file,
	sync_workspace_yaml,
	sync_claude_md,
	sync_prettier_config,
	sync_playwright_config,
	sync_deploy_vps,
	sync_package_manager_version,
	sync_secretlint_development_deps,
	sync_prepare_lefthook_warning,
	migrate_prettierrc: did_migrate_prettierrc,
}

// `sync` is the entry point; `sync_directory` and `main` are exported for their own unit tests, the
// way `git-pr-checks.ts` exports the helpers beside its namespace.
export { main, sync, sync_directory }
