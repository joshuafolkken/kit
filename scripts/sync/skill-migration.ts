import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { transform_copied_content } from '#scripts/init/init-copy-content'
import { is_transformable } from './directory-copy-guard'
import { PLUGIN_SKILL_DIRECTORIES } from './plugin-skill-directories'

// `josh sync` removes a consumer's stale copy of one of the plugin-distributed skill directories —
// but only when the copy still matches what a fresh copy would have written. A copy the consumer
// edited, or a skill the consumer authored under a name not on the distributed list, is left alone
// and reported, because the managed marker the other migrations rely on is never written to a skill.

type MigrationAction = 'removed' | 'kept' | 'absent'
type MigrationSource = 'plugin' | 'retired'

interface RemovedSkillFile {
	readonly path: string
	readonly sha256: string
}

interface RemovedSkill {
	readonly directory: string
	readonly files: ReadonlyArray<RemovedSkillFile>
}

type RemovedSkillManifest = ReadonlyArray<RemovedSkill>

interface MigrationResult {
	directory: string
	action: MigrationAction
	source: MigrationSource
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

function apply_action(
	destination_root: string,
	relative: string,
	action: MigrationAction,
	source: MigrationSource,
): MigrationResult {
	if (action === 'removed') rmSync(destination_root, { recursive: true, force: true })

	return { directory: relative, action, source }
}

function migrate_directory(
	package_root: string,
	project_root: string,
	relative: string,
): MigrationResult {
	const source_root = path.join(package_root, relative)
	const destination_root = path.join(project_root, relative)
	const action = decide_action(source_root, destination_root)

	return apply_action(destination_root, relative, action, 'plugin')
}

function migrate_removed_skill_directories(
	package_root: string,
	project_root: string,
): Array<MigrationResult> {
	return PLUGIN_SKILL_DIRECTORIES.map((relative) =>
		migrate_directory(package_root, project_root, relative),
	)
}

function hash_content(content: string): string {
	return createHash('sha256').update(content).digest('hex')
}

// The hashes a fresh copy of a retired skill's files produce, in path order. Built from a source tree
// the same way `expected_copy` builds a comparison, then frozen into `removed-skill-manifest.ts`; the
// manifest test recomputes this and fails on drift.
function expected_manifest(source_root: string): Array<RemovedSkillFile> {
	return relative_files(source_root)
		.map((relative) => {
			const file = path.join(source_root, relative)

			return { path: relative, sha256: hash_content(expected_copy(file, file)) }
		})
		.toSorted((left, right) => left.path.localeCompare(right.path))
}

function manifest_file_matches(destination_root: string, file: RemovedSkillFile): boolean {
	const destination_file = path.join(destination_root, file.path)

	if (!existsSync(destination_file)) return false

	return hash_content(readFileSync(destination_file, 'utf8')) === file.sha256
}

// A retired skill's copy is unmodified when the consumer's directory holds exactly the manifest's set
// of files and every one hashes to its recorded value — the manifest counterpart of `is_unmodified_copy`.
function matches_manifest(
	destination_root: string,
	files: ReadonlyArray<RemovedSkillFile>,
): boolean {
	if (relative_files(destination_root).length !== files.length) return false

	return files.every((file) => manifest_file_matches(destination_root, file))
}

function decide_manifest_action(
	destination_root: string,
	files: ReadonlyArray<RemovedSkillFile>,
): MigrationAction {
	if (!existsSync(destination_root)) return 'absent'

	return matches_manifest(destination_root, files) ? 'removed' : 'kept'
}

// The retired-skill counterpart of `migrate_removed_skill_directories`: a retired skill no longer
// ships, so its copy is compared against the frozen manifest rather than a live package source.
function migrate_manifest_skills(
	project_root: string,
	manifest: RemovedSkillManifest,
): Array<MigrationResult> {
	return manifest.map((skill) => {
		const destination_root = path.join(project_root, skill.directory)
		const action = decide_manifest_action(destination_root, skill.files)

		return apply_action(destination_root, skill.directory, action, 'retired')
	})
}

function removed_note(source: MigrationSource): string {
	return source === 'retired' ? 'retired from distribution' : 'now provided by the kit plugin'
}

function kept_note(source: MigrationSource): string {
	return source === 'retired'
		? 'modified or consumer-authored — remove by hand'
		: 'modified or consumer-authored — remove by hand once on the kit plugin'
}

const skill_migration = {
	is_unmodified_copy,
	migrate_removed_skill_directories,
	migrate_manifest_skills,
	expected_manifest,
	removed_note,
	kept_note,
}

export type { MigrationResult, RemovedSkillManifest }
export { skill_migration }
