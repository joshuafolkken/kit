import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { is_workflow_destination } from '#scripts/claude/workflow-destination'
import { gh_spawn } from '#scripts/gh/gh-spawn'
import { managed_marker_logic } from '#scripts/managed-marker/managed-marker-logic'
import {
	classify_path,
	copy_directory_failure,
	directory_copy_blocker,
} from '#scripts/sync/directory-copy-guard'
import { transform_copied_content } from './init-copy-content'
import { init_logic } from './init-logic'
import { package_path, PROJECT_ROOT } from './init-paths'
import { init_sonar } from './init-sonar'
import type { ProjectShape } from './project-profile'

const WORKSPACE_YAML = 'pnpm-workspace.yaml'
const CLAUDE_MD_FILENAME = 'CLAUDE.md'
const STATIC_CLAUDE_IMPORT = '@node_modules/@joshuafolkken/kit/dist/CLAUDE.static.md'
const PRETTIER_IGNORE = '.prettierignore'
const GIT_ATTRIBUTES = '.gitattributes'
const CODE_OF_CONDUCT = 'CODE_OF_CONDUCT.md'
const SECURITY_MD = 'SECURITY.md'
const STATIC_AI_FILES = [
	'AGENTS.md',
	'GEMINI.md',
	PRETTIER_IGNORE,
	GIT_ATTRIBUTES,
	CODE_OF_CONDUCT,
	SECURITY_MD,
	WORKSPACE_YAML,
]
// A static project gets its own template for these, not kit's development copy (joshuafolkken/kit#2693).
const STATIC_SOURCES: Readonly<Record<string, string>> = {
	[PRETTIER_IGNORE]: 'templates/prettierignore.static',
	[WORKSPACE_YAML]: 'templates/pnpm-workspace.static.yaml',
}
const GITHUB_FILES = new Set([CODE_OF_CONDUCT, SECURITY_MD])
const STATIC_POINTER_MAPPING = { src: 'templates/cursorrules.static', dest: '.cursorrules' }
const PULL_REQUEST_TEMPLATE = '.github/pull_request_template.md'
const RELEASE_CONFIG = '.github/release.yml'
const STATIC_GITHUB_MAPPINGS = [
	{ src: PULL_REQUEST_TEMPLATE, dest: PULL_REQUEST_TEMPLATE },
	{ src: RELEASE_CONFIG, dest: RELEASE_CONFIG },
]

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
	if (!is_workflow_destination(destination_path) || !did_read_unstamped(destination_path)) {
		return false
	}

	console.warn(`  ⚠ ${label} has no managed-workflow header — run josh sync before merging bumps`)

	return true
}

function did_skip_copy_if_absent(
	source_path: string,
	destination_path: string,
	label: string,
): boolean {
	if (existsSync(destination_path)) {
		console.info(`  ⏭ skipped   ${label} (already exists)`)
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

function did_skip_ai_file_copy(filename: string, shape?: ProjectShape): boolean {
	const static_source = shape?.profile === 'static' ? STATIC_SOURCES[filename] : undefined
	const source_path = package_path(static_source ?? filename)
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

interface DirectorySkip {
	reason: string
	is_blocked: boolean
}

// Two different skips, and telling them apart is what keeps the advice honest. A destination that is
// already a directory is `josh init` declining to overwrite, and `josh sync` is the answer. Anything
// the shared guard blocks — a source the package does not carry, a destination that is a file or a
// symlink — is a condition `josh sync` refuses in exactly the same way, so it is reported as a
// warning and not with a hint that would send the user around the same loop. The blocker runs first
// for that reason: it is the more specific reading of the same destination.
function directory_copy_skip(
	source_path: string,
	destination_path: string,
): DirectorySkip | undefined {
	const blocker = directory_copy_blocker(source_path, destination_path)

	if (blocker !== undefined) return { reason: blocker, is_blocked: true }

	if (classify_path(destination_path) !== 'absent') {
		return { reason: 'already exists — run josh sync to update', is_blocked: false }
	}

	return undefined
}

function report_directory_skip(directory_name: string, skip: DirectorySkip): void {
	const line = `${directory_name}/ (${skip.reason})`

	if (skip.is_blocked) console.warn(`  ⚠ skipped   ${line}`)
	else console.info(`  ⏭ skipped   ${line}`)
}

// The boolean answers "would `josh sync` overwrite this?", which is what the hint at the end of the
// run offers — not "did anything happen?". A blocked copy, and one whose walk failed part way, are
// both refused by `sync` for the same reason they were refused here, so raising the hint on either
// would send the user around the loop rather than at the cause.
function did_copy_directory(directory_name: string): boolean {
	const failure = copy_directory_failure(
		package_path(directory_name),
		path.join(PROJECT_ROOT, directory_name),
	)

	if (failure !== undefined) {
		console.warn(`  ⚠ skipped   ${directory_name}/ (${failure})`)

		return false
	}

	console.info(`  ✔ created   ${directory_name}/`)

	return true
}

function did_skip_ai_directory_copy(directory_name: string): boolean {
	const skip = directory_copy_skip(
		package_path(directory_name),
		path.join(PROJECT_ROOT, directory_name),
	)

	if (skip === undefined) {
		did_copy_directory(directory_name)

		return false
	}

	report_directory_skip(directory_name, skip)

	return !skip.is_blocked
}

// `josh init` writes the one-line CLAUDE.md import when the consumer has none, and — like every other
// AI file — leaves an existing one untouched so a consumer's additions are never disturbed. `josh sync`
// is what ensures the import line on an existing file (sync.ts). CLAUDE.md is no longer byte-copied
// (joshuafolkken/kit#1878), so it is handled here rather than through AI_COPY_FILES.
function did_skip_claude_md_import(shape?: ProjectShape): boolean {
	const destination_path = path.join(PROJECT_ROOT, CLAUDE_MD_FILENAME)

	if (existsSync(destination_path)) {
		console.info(`  ⏭ skipped   ${CLAUDE_MD_FILENAME} (already exists)`)

		return true
	}

	const content =
		shape?.profile === 'static'
			? `> If kit is not installed, run \`pnpm install\` first.\n\n${STATIC_CLAUDE_IMPORT}\n`
			: init_logic.ensure_claude_md_import(undefined)

	writeFileSync(destination_path, content)
	console.info(`  ✔ created   ${CLAUDE_MD_FILENAME}`)

	return false
}

// Returns the repository name resolved for the Sonar config, so `josh init` can reuse it for the
// security-updates report instead of spawning a second `gh repo view` (joshuafolkken/kit#805).
// Resolving it here rather than in the caller keeps every AI-file write ahead of the network call.
function should_copy_git_file(filename: string, shape?: ProjectShape): boolean {
	if (shape?.has_git !== false) return true

	return (
		filename !== GIT_ATTRIBUTES &&
		!filename.startsWith('.claude/') &&
		!filename.startsWith('.codex/')
	)
}

function should_copy_github_file(filename: string, shape?: ProjectShape): boolean {
	if (shape?.has_github !== false) return true

	return !GITHUB_FILES.has(filename) && !filename.startsWith('.github/')
}

function should_copy_static_file(filename: string, shape?: ProjectShape): boolean {
	if (filename !== PRETTIER_IGNORE || shape?.profile !== 'static') return true

	return shape.has_web
}

function should_copy_ai_file(filename: string, shape?: ProjectShape): boolean {
	return (
		should_copy_git_file(filename, shape) &&
		should_copy_github_file(filename, shape) &&
		should_copy_static_file(filename, shape)
	)
}

function ai_files(shape?: ProjectShape): ReadonlyArray<string> {
	const files = shape?.profile === 'static' ? STATIC_AI_FILES : init_logic.get_ai_copy_files()

	return files.filter((filename) => should_copy_ai_file(filename, shape))
}

function ai_mapping_skips(shape?: ProjectShape): ReadonlyArray<boolean> {
	const mappings =
		shape?.profile === 'static'
			? [STATIC_POINTER_MAPPING, ...(shape.has_github ? STATIC_GITHUB_MAPPINGS : [])]
			: init_logic.get_ai_copy_file_mappings()

	return mappings
		.filter(({ dest }) => shape?.has_github !== false || !dest.startsWith('.github/'))
		.map(({ src, dest }) => did_skip_ai_file_mapping(src, dest))
}

function repository_name(shape?: ProjectShape): string | undefined {
	if (shape?.has_github === false || shape?.profile === 'static') return undefined

	return gh_spawn.get_repo_name_with_owner()
}

function report_sync_hint(has_skips: boolean, shape?: ProjectShape): void {
	if (!has_skips || shape?.profile === 'static') return

	console.info('\n  💡 Run `josh sync` to overwrite skipped AI files with the latest version.')
}

function run_ai_copies(shape?: ProjectShape): string | undefined {
	const did_skip_claude_md = did_skip_claude_md_import(shape)
	const file_skips = ai_files(shape).map((filename) => did_skip_ai_file_copy(filename, shape))
	const mapping_skips = ai_mapping_skips(shape)
	const directory_skips = init_logic
		.get_ai_copy_directories()
		.map((directory_name) => did_skip_ai_directory_copy(directory_name))
	const has_skips = [did_skip_claude_md, ...file_skips, ...mapping_skips, ...directory_skips].some(
		Boolean,
	)

	const name_with_owner = repository_name(shape)

	if (shape?.profile !== 'static') init_sonar.copy_sonar_with_template(name_with_owner)

	report_sync_hint(has_skips, shape)

	return name_with_owner
}

const init_ai_copy = {
	copy_ai_file,
	run_ai_copies,
	ai_files,
}

export { init_ai_copy }
