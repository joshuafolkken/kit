import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { is_workflow_destination } from '#scripts/claude/workflow-destination'
import { gh_spawn } from '#scripts/gh/gh-spawn'
import { file_reader } from '#scripts/lib/read-file'
import { managed_marker_logic } from '#scripts/managed-marker/managed-marker-logic'
import {
	classify_path,
	copy_directory_failure,
	directory_copy_blocker,
} from '#scripts/sync/directory-copy-guard'
import { file_content } from '#scripts/sync/file-content'
import { distributed_paths } from './distributed-paths'
import { transform_copied_content } from './init-copy-content'
import { init_logic } from './init-logic'
import { package_path, PROJECT_ROOT } from './init-paths'
import { init_sonar } from './init-sonar'
import type { ProjectShape } from './project-profile'
import { security_policy } from './security-policy'

const WORKSPACE_YAML = 'pnpm-workspace.yaml'
const CLAUDE_MD_FILENAME = 'CLAUDE.md'
const BASIC_CLAUDE_IMPORT = '@node_modules/@joshuafolkken/kit/dist/CLAUDE.basic.md'
const PRETTIER_IGNORE = '.prettierignore'
const GIT_ATTRIBUTES = '.gitattributes'
const CODE_OF_CONDUCT = 'CODE_OF_CONDUCT.md'
const { SECURITY_MD } = security_policy
const AGENTS_MD = 'AGENTS.md'
const GEMINI_MD = 'GEMINI.md'
const BASIC_AI_FILES = [
	AGENTS_MD,
	GEMINI_MD,
	PRETTIER_IGNORE,
	GIT_ATTRIBUTES,
	CODE_OF_CONDUCT,
	SECURITY_MD,
	WORKSPACE_YAML,
]
// A basic project gets its own template for these, not kit's development copy.
const BASIC_SOURCES: Readonly<Record<string, string>> = {
	[AGENTS_MD]: 'templates/AGENTS.basic.md',
	[GEMINI_MD]: 'templates/GEMINI.basic.md',
	[PRETTIER_IGNORE]: 'templates/prettierignore.basic',
	[WORKSPACE_YAML]: 'templates/pnpm-workspace.basic.yaml',
}
// Written from a template of the consumer's own on every profile, not from kit's same-named file.
const CONSUMER_SOURCES: Readonly<Record<string, string>> = {
	[SECURITY_MD]: security_policy.SECURITY_TEMPLATE,
}
// A basic project `josh start` set up for the GitHub Issue workflow runs its agents unattended, on the
// permissions, hooks and plugin this file declares (#3796).
const BASIC_WORKFLOW_AI_FILES = [...BASIC_AI_FILES, '.claude/settings.json']
const GITHUB_FILES = new Set([CODE_OF_CONDUCT, SECURITY_MD])
const BASIC_POINTER_MAPPING = { src: 'templates/cursorrules.basic', dest: '.cursorrules' }
const PULL_REQUEST_TEMPLATE = '.github/pull_request_template.md'
const RELEASE_CONFIG = '.github/release.yml'
const BASIC_GITHUB_MAPPINGS = [
	{ src: PULL_REQUEST_TEMPLATE, dest: PULL_REQUEST_TEMPLATE },
	{ src: RELEASE_CONFIG, dest: RELEASE_CONFIG },
]

// Whether the existing file is a workflow that carries no header. A read failure answers "no": a
// diagnostic warning must not fail the command it accompanies.
function did_read_unstamped(destination_path: string): boolean {
	try {
		return !managed_marker_logic.is_marked(readFileSync(destination_path, 'utf8'))
	} catch {
		return false
	}
}

// What kit writes at a destination it copies to — the content `josh uninstall` compares a project's
// file against, so it is read from the one place the copy itself reads it.
function copied_content(source_path: string, destination_path: string): string {
	return transform_copied_content(destination_path, readFileSync(source_path, 'utf8'))
}

function copy_ai_file(source_path: string, destination_path: string): void {
	file_content.write_contained(destination_path, copied_content(source_path, destination_path))
}

// `init` declines to modify a file that already exists, and that includes not stamping it: the
// destination may hold a workflow the consumer wrote themselves, and a header claiming this package
// owns it would hold every bump to it back on a false premise. But an unstamped workflow is not
// merely out of date either — the consumer's auto-merge workflow reads the stamp, so until `sync`
// writes one, a bump to a workflow this package does overwrite merges and the next sync reverts it.
// A warning is the honest middle: `sync` resolves it either way, and this
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

// The merged file is written back, and reported as `updated`, only when the merge changed it — a
// second `josh init` over an already-merged file reports `unchanged`.
// The workspace template with the project's own `.npmrc` values carried over: once the file holds a
// key, the merge keeps it, so this is the one chance to move the value.
function read_workspace_template(source_path: string, destination_path: string): string {
	const npmrc = file_reader.read_file_or_empty(path.join(path.dirname(destination_path), '.npmrc'))

	return init_logic.carry_npmrc_settings(readFileSync(source_path, 'utf8'), npmrc)
}

function merge_existing_workspace_yaml(source_path: string, destination_path: string): void {
	const template = read_workspace_template(source_path, destination_path)
	const existing = readFileSync(destination_path, 'utf8')
	const merged = init_logic.merge_workspace_yaml(existing, template)

	if (merged === existing) {
		console.info(`  ✔ unchanged ${WORKSPACE_YAML}`)

		return
	}

	file_content.write_contained(destination_path, merged)
	console.info(`  ✔ updated   ${WORKSPACE_YAML}`)
}

// The workspace file kit writes where the project has none.
function workspace_content(source_path: string, destination_path: string): string {
	return transform_copied_content(
		destination_path,
		read_workspace_template(source_path, destination_path),
	)
}

function did_skip_workspace_yaml_copy(source_path: string, destination_path: string): boolean {
	if (existsSync(destination_path)) {
		merge_existing_workspace_yaml(source_path, destination_path)

		return false
	}

	file_content.write_contained(destination_path, workspace_content(source_path, destination_path))
	console.info(`  ✔ created   ${WORKSPACE_YAML}`)

	return false
}

// The package file an AI file is copied from: a basic project gets its own template for a few of
// them, a few are a consumer template on every profile, and every other file is copied from the
// path it is written to.
function ai_file_source(filename: string, shape?: ProjectShape): string {
	const basic_source = shape?.profile === 'basic' ? BASIC_SOURCES[filename] : undefined

	return basic_source ?? CONSUMER_SOURCES[filename] ?? filename
}

function did_skip_ai_file_copy(filename: string, shape?: ProjectShape): boolean {
	if (security_policy.did_skip_unresolved(filename, PROJECT_ROOT)) return false
	const source_path = package_path(ai_file_source(filename, shape))
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
// is what ensures the import line on an existing file (sync.ts). CLAUDE.md is no longer byte-copied,
// so it is handled here rather than through AI_COPY_FILES.
function basic_claude_md(): string {
	return `> If kit is not installed, run \`pnpm install\` first.\n\n${BASIC_CLAUDE_IMPORT}\n`
}

// A basic CLAUDE.md imports the basic rules alone: the full bootstrap and import are removed, and the
// basic header is restored when no basic import is left. The project's own lines stay as they are.
function ensure_basic_claude_md(existing: string | undefined): string {
	if (existing === undefined) return basic_claude_md()
	const kept = distributed_paths.remove_claude_md_import(existing)

	if (kept.includes(BASIC_CLAUDE_IMPORT)) return kept

	return kept === '' ? basic_claude_md() : `${basic_claude_md()}\n${kept}`
}

function did_skip_claude_md_import(shape?: ProjectShape): boolean {
	const destination_path = path.join(PROJECT_ROOT, CLAUDE_MD_FILENAME)

	if (existsSync(destination_path)) {
		console.info(`  ⏭ skipped   ${CLAUDE_MD_FILENAME} (already exists)`)

		return true
	}

	const content =
		shape?.profile === 'basic' ? basic_claude_md() : init_logic.ensure_claude_md_import(undefined)

	file_content.write_contained(destination_path, content)
	console.info(`  ✔ created   ${CLAUDE_MD_FILENAME}`)

	return false
}

// Returns the repository name resolved for the Sonar config, so `josh init` can reuse it for the
// security-updates report instead of spawning a second `gh repo view`.
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

function should_copy_basic_file(filename: string, shape?: ProjectShape): boolean {
	if (filename !== PRETTIER_IGNORE || shape?.profile !== 'basic') return true

	return shape.should_use_prettier
}

function should_copy_ai_file(filename: string, shape?: ProjectShape): boolean {
	return (
		should_copy_git_file(filename, shape) &&
		should_copy_github_file(filename, shape) &&
		should_copy_basic_file(filename, shape)
	)
}

function basic_ai_files(shape: ProjectShape): ReadonlyArray<string> {
	return shape.has_workflow ? BASIC_WORKFLOW_AI_FILES : BASIC_AI_FILES
}

function ai_files(shape?: ProjectShape): ReadonlyArray<string> {
	const files = shape?.profile === 'basic' ? basic_ai_files(shape) : init_logic.get_ai_copy_files()

	return files.filter((filename) => should_copy_ai_file(filename, shape))
}

type FileMappings = ReturnType<typeof init_logic.get_ai_copy_file_mappings>

function ai_file_mappings(shape?: ProjectShape): FileMappings {
	const mappings =
		shape?.profile === 'basic'
			? [BASIC_POINTER_MAPPING, ...(shape.has_github ? BASIC_GITHUB_MAPPINGS : [])]
			: init_logic.get_ai_copy_file_mappings()

	return mappings.filter(({ dest }) => shape?.has_github !== false || !dest.startsWith('.github/'))
}

function ai_mapping_skips(shape?: ProjectShape): ReadonlyArray<boolean> {
	return ai_file_mappings(shape).map(({ src, dest }) => did_skip_ai_file_mapping(src, dest))
}

function repository_name(shape?: ProjectShape): string | undefined {
	if (shape?.has_github === false || shape?.profile === 'basic') return undefined

	return gh_spawn.get_repo_name_with_owner()
}

function report_sync_hint(has_skips: boolean, shape?: ProjectShape): void {
	if (!has_skips || shape?.profile === 'basic') return

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

	if (shape?.profile !== 'basic') init_sonar.copy_sonar_with_template(name_with_owner)

	report_sync_hint(has_skips, shape)

	return name_with_owner
}

const init_ai_copy = {
	copy_ai_file,
	copied_content,
	workspace_content,
	run_ai_copies,
	ai_files,
	ai_file_source,
	ai_file_mappings,
	ensure_basic_claude_md,
	read_workspace_template,
}

export { init_ai_copy, CLAUDE_MD_FILENAME, WORKSPACE_YAML }
