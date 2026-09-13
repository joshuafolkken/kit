import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { is_transformable } from '#scripts/directory-copy-guard'
import { transform_copied_content } from '#scripts/init/init-copy-content'
import { PLUGIN_SKILL_DIRECTORIES } from './plugin-skill-directories'

// `josh sync` removes a consumer's stale copy of one of the plugin-distributed skill directories —
// but only when the copy still matches what a fresh copy would have written. A copy the consumer
// edited, or a skill the consumer authored under a name not on the distributed list, is left alone
// and reported, because the managed marker the other migrations rely on is never written to a skill.

type MigrationAction = 'removed' | 'kept' | 'absent'

interface MigrationResult {
	directory: string
	action: MigrationAction
}

// `lstatSync` rather than `statSync`: a consumer's skill directory can hold a dangling symlink, and
// `statSync` follows it and throws `ENOENT`, which would abort the whole `josh sync` run uncaught —
// the same reason `directory-copy-guard.ts` uses `lstat` throughout. A symlink then reads as
// not-a-regular-file and is skipped, which correctly counts the tree as modified.
function relative_files(root: string): Array<string> {
	return readdirSync(root, { encoding: 'utf8', recursive: true }).filter((entry) =>
		lstatSync(path.join(root, entry)).isFile(),
	)
}

// What a fresh `josh sync` would have written for one file: markdown gets the copy transform (the
// `prompts/…` rewrite and the rest), everything else is copied byte for byte. Comparing against this
// is how an unmodified copy is told from one the consumer edited, with no marker to rely on.
function expected_copy(source_file: string, destination_file: string): string {
	const raw = readFileSync(source_file, 'utf8')

	return is_transformable(source_file) ? transform_copied_content(destination_file, raw) : raw
}

function file_matches(source_root: string, destination_root: string, relative: string): boolean {
	const destination_file = path.join(destination_root, relative)

	if (!existsSync(destination_file)) return false

	const source_file = path.join(source_root, relative)

	return readFileSync(destination_file, 'utf8') === expected_copy(source_file, destination_file)
}

// Unmodified means the two trees hold the same set of files and every one matches. The count guard
// catches a file the consumer added or deleted; `every` catches a file whose content was edited.
function is_unmodified_copy(source_root: string, destination_root: string): boolean {
	const sources = relative_files(source_root)

	if (relative_files(destination_root).length !== sources.length) return false

	return sources.every((relative) => file_matches(source_root, destination_root, relative))
}

function decide_action(source_root: string, destination_root: string): MigrationAction {
	if (!existsSync(destination_root)) return 'absent'
	// A vanished source means this is no longer one of kit's skills: leave the consumer's directory be.
	if (!existsSync(source_root)) return 'kept'

	return is_unmodified_copy(source_root, destination_root) ? 'removed' : 'kept'
}

function migrate_directory(
	package_root: string,
	project_root: string,
	relative: string,
): MigrationResult {
	const source_root = path.join(package_root, relative)
	const destination_root = path.join(project_root, relative)
	const action = decide_action(source_root, destination_root)

	if (action === 'removed') rmSync(destination_root, { recursive: true, force: true })

	return { directory: relative, action }
}

function migrate_removed_skill_directories(
	package_root: string,
	project_root: string,
): Array<MigrationResult> {
	return PLUGIN_SKILL_DIRECTORIES.map((relative) =>
		migrate_directory(package_root, project_root, relative),
	)
}

const skill_migration = {
	is_unmodified_copy,
	migrate_removed_skill_directories,
}

export type { MigrationAction, MigrationResult }
export { skill_migration }
