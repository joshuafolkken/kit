import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gh_spawn } from '#scripts/gh-spawn'
import { managed_marker_logic } from '#scripts/managed-marker/managed-marker-logic'
import { is_workflow_destination } from '#scripts/workflow-destination'
import { transform_copied_content } from './init-copy-content'
import { init_logic } from './init-logic'
import { package_path, PROJECT_ROOT } from './init-paths'
import { init_sonar } from './init-sonar'

const WORKSPACE_YAML = 'pnpm-workspace.yaml'

// Whether the existing file is a workflow that carries no header. A read failure answers "no": the
// point is to warn, and a warning is not worth failing a command that used to open nothing.
function did_read_unstamped(destination_path: string): boolean {
	try {
		return !managed_marker_logic.is_marked(readFileSync(destination_path, 'utf8'))
	} catch {
		return false
	}
}

function copy_ai_file(source_path: string, destination_path: string): void {
	const content = readFileSync(source_path, 'utf8')

	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, transform_copied_content(destination_path, content))
}

// `init` declines to modify a file that already exists, and that includes not stamping it: the
// destination may hold a workflow the consumer wrote themselves, and a header claiming this package
// owns it would hold every bump to it back on a false premise. But an unstamped workflow is not
// merely out of date either — the consumer's auto-merge workflow reads the stamp, so until `sync`
// writes one, a bump to a workflow this package does overwrite merges and the next sync reverts it
// (joshuafolkken/kit#844). A warning is the honest middle: `sync` resolves it either way, and this
// names the consequence rather than leaving it to be discovered from a revert.
//
// The destination is checked before the file is opened, and a read failure is stepped over, so
// nothing here can turn a skipped file into a failed `init` the way it never was before.
function did_warn_unstamped_workflow(destination_path: string, label: string): boolean {
	if (!is_workflow_destination(destination_path)) return false

	if (!did_read_unstamped(destination_path)) return false

	console.warn(`  ⚠ ${label} has no managed-workflow header — run josh sync before merging bumps`)

	return true
}

function did_skip_copy_if_absent(
	source_path: string,
	destination_path: string,
	label: string,
): boolean {
	if (existsSync(destination_path)) {
		console.info(`  ⏭ skipped   ${label} (already exists — run josh sync to update)`)
		did_warn_unstamped_workflow(destination_path, label)

		return true
	}

	copy_ai_file(source_path, destination_path)
	console.info(`  ✔ created   ${label}`)

	return false
}

function did_skip_workspace_yaml_copy(source_path: string, destination_path: string): boolean {
	if (!existsSync(destination_path)) {
		copy_ai_file(source_path, destination_path)
		console.info(`  ✔ created   ${WORKSPACE_YAML}`)

		return false
	}

	const template = readFileSync(source_path, 'utf8')
	const existing = readFileSync(destination_path, 'utf8')
	const merged = init_logic.merge_workspace_yaml(existing, template)

	if (merged !== existing) writeFileSync(destination_path, merged)
	console.info(`  ✔ updated   ${WORKSPACE_YAML}`)

	return false
}

function did_skip_ai_file_copy(filename: string): boolean {
	const source_path = package_path(filename)
	const destination_path = path.join(PROJECT_ROOT, filename)

	if (filename === WORKSPACE_YAML) {
		return did_skip_workspace_yaml_copy(source_path, destination_path)
	}

	return did_skip_copy_if_absent(source_path, destination_path, filename)
}

function did_skip_ai_file_mapping(source: string, destination: string): boolean {
	return did_skip_copy_if_absent(
		package_path(source),
		path.join(PROJECT_ROOT, destination),
		destination,
	)
}

function did_skip_ai_directory_copy(directory_name: string): boolean {
	const destination_path = path.join(PROJECT_ROOT, directory_name)

	if (existsSync(destination_path)) {
		console.info(`  ⏭ skipped   ${directory_name}/ (already exists — run josh sync to update)`)

		return true
	}

	cpSync(package_path(directory_name), destination_path, { recursive: true })
	console.info(`  ✔ created   ${directory_name}/`)

	return false
}

// Returns the repository name resolved for the Sonar config, so `josh init` can reuse it for the
// security-updates report instead of spawning a second `gh repo view` (joshuafolkken/kit#805).
// Resolving it here rather than in the caller keeps every AI-file write ahead of the network call.
function run_ai_copies(): string | undefined {
	const file_skips = init_logic
		.get_ai_copy_files()
		.map((filename) => did_skip_ai_file_copy(filename))
	const mapping_skips = init_logic
		.get_ai_copy_file_mappings()
		.map(({ src: source, dest: destination }) => did_skip_ai_file_mapping(source, destination))
	const directory_skips = init_logic
		.get_ai_copy_directories()
		.map((directory_name) => did_skip_ai_directory_copy(directory_name))
	const has_skips = [...file_skips, ...mapping_skips, ...directory_skips].some(Boolean)

	const name_with_owner = gh_spawn.get_repo_name_with_owner()

	init_sonar.copy_sonar_with_template(name_with_owner)

	if (has_skips) {
		console.info('\n  💡 Run `josh sync` to overwrite skipped AI files with the latest version.')
	}

	return name_with_owner
}

const init_ai_copy = {
	copy_ai_file,
	run_ai_copies,
}

export { init_ai_copy }
