import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { init_ai_copy } from '#scripts/init/init-ai-copy'
import { transform_copied_content } from '#scripts/init/init-copy-content'
import { init_logic } from '#scripts/init/init-logic'
import { PACKAGE_DIR, PROJECT_ROOT } from '#scripts/init/init-paths'
import type { ProjectShape } from '#scripts/init/project-profile'
import { file_reader } from '#scripts/lib/read-file'
import { pack_hook } from '#scripts/safe-chain/pack-hook'
import { copy_directory_failure, directory_copy_blocker } from './directory-copy-guard'
import { file_content } from './file-content'
import { REMOVED_SKILL_MANIFEST } from './removed-skill-manifest'
import { skill_migration, type MigrationResult } from './skill-migration'
import { sync_hook_safety } from './sync-hook-safety'

const WORKSPACE_YAML = 'pnpm-workspace.yaml'
const PACKAGE_JSON = 'package.json'
const CLAUDE_MD_FILENAME = 'CLAUDE.md'
const CLAUDE_SETTINGS_FILE = '.claude/settings.json'
const CODEX_HOOKS_FILE = '.codex/hooks.json'

function sync_ai_file(source_path: string, destination_path: string): boolean {
	const content = readFileSync(source_path, 'utf8')

	return file_content.write_text_if_changed(
		destination_path,
		transform_copied_content(destination_path, content),
	)
}

// Both copied hook files must run against the consumer's installed bundle. When sync is run from a
// newer source than that install, writing either file would leave hooks
// that fail every prompt; skip it and print how to update instead.
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

function sync_file(source: string, filename: string): void {
	if (should_skip_hook_file(filename)) return
	const did_change = sync_ai_file(path.join(PACKAGE_DIR, source), path.join(PROJECT_ROOT, filename))

	console.info(`  ✔ ${did_change ? 'synced   ' : 'unchanged'} ${filename}`)
}

function sync_file_mapping(source_path: string, destination_path: string): void {
	if (!existsSync(source_path)) {
		console.warn(`  ⚠ skipped   ${path.basename(destination_path)} (not found in package)`)

		return
	}

	// Routed through sync_ai_file rather than cpSync: templates/workflows/ci.yml is a mapped
	// file, so a byte copy would hand the consumer the template's own action pins. The pins
	// have to be resolved from .github/workflows at write time.
	const did_change = sync_ai_file(source_path, destination_path)

	console.info(`  ✔ ${did_change ? 'synced   ' : 'unchanged'} ${path.basename(destination_path)}`)
}

function sync_workspace_yaml(
	template_path: string,
	destination_path: string,
	is_force = false,
): boolean {
	const template = init_ai_copy.read_workspace_template(template_path, destination_path)
	const existing = is_force ? '' : file_reader.read_file_or_empty(destination_path)
	const merged = init_logic.merge_workspace_yaml(existing, template)

	return file_content.write_text_if_changed(destination_path, merged)
}

// The source is the profile's: a basic project syncs from its own templates, as `josh init` wrote it.
function sync_ai_copy_file(filename: string, is_force: boolean, shape?: ProjectShape): void {
	const source = init_ai_copy.ai_file_source(filename, shape)

	if (filename === WORKSPACE_YAML) {
		const did_change = sync_workspace_yaml(
			path.join(PACKAGE_DIR, source),
			path.join(PROJECT_ROOT, WORKSPACE_YAML),
			is_force,
		)

		console.info(`  ✔ ${did_change ? 'synced   ' : 'unchanged'} ${WORKSPACE_YAML}`)

		return
	}

	sync_file(source, filename)
}

// The reason this directory was not synced, or nothing when it was. Both halves answer the same
// question — what stops the copy — so the caller has one line to print either way.
function directory_sync_failure(
	directory_name: string,
	on_copy: (did_change: boolean) => void,
): string | undefined {
	const source_path = path.join(PACKAGE_DIR, directory_name)
	const destination_path = path.join(PROJECT_ROOT, directory_name)

	return (
		directory_copy_blocker(source_path, destination_path) ??
		copy_directory_failure(source_path, destination_path, on_copy)
	)
}

function sync_directory(directory_name: string): void {
	const failure = directory_sync_failure(directory_name, (did_change) => {
		console.info(`  ✔ ${did_change ? 'synced   ' : 'unchanged'} ${directory_name}/`)
	})

	if (failure !== undefined) console.warn(`  ⚠ skipped   ${directory_name}/ (${failure})`)
}

// A consumer's stale copy of a distributed skill is removed once it still matches the shipment and
// kept with a warning once it does not. Plugin skills compare against the
// package source; a retired skill compares against the frozen manifest. The
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

function ensured_claude_md(existing: string | undefined, shape?: ProjectShape): string {
	return shape?.profile === 'basic'
		? init_ai_copy.ensure_basic_claude_md(existing)
		: init_logic.ensure_claude_md_import(existing)
}

// CLAUDE.md is not byte-copied: a consumer's file is one @import of kit's
// published rules plus the project's own additions below it. Ensure the import line is present
// without ever disturbing those additions — so this ignores --force, which would otherwise mean
// discarding a consumer's content.
function sync_claude_md(destination_path: string, shape?: ProjectShape): void {
	const existing = file_reader.read_optional(destination_path)
	const ensured = ensured_claude_md(existing, shape)

	if (ensured === existing) {
		console.info(`  ✔ unchanged ${CLAUDE_MD_FILENAME}`)

		return
	}

	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, ensured)
	console.info(`  ✔ synced    ${CLAUDE_MD_FILENAME}`)
}

// A basic shape syncs the file set `josh init` writes for that profile; no shape is the full set,
// unfiltered, as sync has always written it.
function sync_ai_copy_all(is_force: boolean, shape?: ProjectShape): void {
	console.info('AI files:')

	sync_claude_md(path.join(PROJECT_ROOT, CLAUDE_MD_FILENAME), shape)

	for (const filename of init_ai_copy.ai_files(shape)) {
		sync_ai_copy_file(filename, is_force, shape)
	}

	for (const { src, dest } of init_ai_copy.ai_file_mappings(shape)) {
		sync_file_mapping(path.join(PACKAGE_DIR, src), path.join(PROJECT_ROOT, dest))
	}

	for (const directory_name of init_logic.get_ai_copy_directories()) {
		sync_directory(directory_name)
	}

	migrate_removed_skills()
	// Both profiles write the Safe Chain `preinstall`, so both get the hook that keeps it out of a
	// published package.
	pack_hook.sync_pack_hook(PROJECT_ROOT, PACKAGE_DIR)
}

const sync_ai_files = {
	should_skip_hook_file,
	sync_file_mapping,
	sync_ai_file,
	sync_workspace_yaml,
	sync_claude_md,
	sync_directory,
	sync_ai_copy_all,
}

export { sync_ai_files }
