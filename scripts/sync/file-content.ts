import { lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { file_reader } from '#scripts/lib/read-file'

const PATH_SEPARATORS = path.sep === '\\' ? /[/\\]/u : /\//u
const MAX_RESOLVE_STEPS = 4096

function is_read_denied(error: unknown): boolean {
	return (
		error instanceof Error && 'code' in error && ['EACCES', 'EPERM'].includes(String(error.code))
	)
}

function is_regular_existing_file(destination_path: string): boolean {
	try {
		return lstatSync(destination_path).isFile()
	} catch (error) {
		if (file_reader.is_absent(error)) return false
		throw error
	}
}

function does_read_match(destination_path: string, expected: Buffer): boolean {
	try {
		return readFileSync(destination_path).equals(expected)
	} catch (error) {
		if (is_read_denied(error)) return false
		throw error
	}
}

function is_same_file_content(destination_path: string, content: string | Buffer): boolean {
	if (!is_regular_existing_file(destination_path)) return false

	const expected = Buffer.isBuffer(content) ? content : Buffer.from(content)

	return does_read_match(destination_path, expected)
}

function read_symlink(target: string): string | undefined {
	if (!lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) return undefined

	return readlinkSync(target)
}

function split_components(target: string): Array<string> {
	return target.split(PATH_SEPARATORS).filter((part) => part !== '' && part !== '.')
}

// One component, as the kernel takes it: `..` steps up from the real directory reached so far, and
// a link — dangling or not — splices its own text in, from the root when it is absolute.
function enter_component(current: string, name: string, pending: Array<string>): string {
	if (name === '..') return path.dirname(current)

	const next = path.join(current, name)
	const link = read_symlink(next)
	if (link === undefined) return next
	const root = path.isAbsolute(link) ? path.parse(link).root : ''

	pending.unshift(...split_components(link.slice(root.length)))

	return root === '' ? current : root
}

// Where a write to `target` lands. The path is walked component by component rather than through
// `path.resolve` or `realpathSync`: the first folds `link/..` lexically while the kernel climbs
// out of where `link` points, and the second refuses the not-yet-created file a dangling link
// names. A link cycle the walk would never leave is cut off rather than spun on.
function resolve_write_path(target: string): string {
	const absolute = path.isAbsolute(target) ? target : `${process.cwd()}${path.sep}${target}`
	let current = path.parse(absolute).root
	const pending = split_components(absolute.slice(current.length))

	for (let steps = 0; steps <= MAX_RESOLVE_STEPS; steps += 1) {
		const name = pending.shift()
		if (name === undefined) return current
		current = enter_component(current, name, pending)
	}

	throw new Error(`Refusing to write ${target}: too many links`)
}

function is_within(root: string, target: string): boolean {
	const relative = path.relative(root, target)

	return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

// Only a path named inside the project is held to it: one the caller names elsewhere (a scratch
// directory) is that caller's choice, and the link the guard is for sits inside the project.
function does_escape_project(destination_path: string): boolean {
	if (!is_within(path.resolve(PROJECT_ROOT), path.resolve(destination_path))) return false

	return !is_within(resolve_write_path(PROJECT_ROOT), resolve_write_path(destination_path))
}

// A symlinked destination is written through, and one pointing outside the project (`~/.zshrc`)
// would let a sync overwrite a file the project does not own. A link that stays inside —
// `CLAUDE.md` → `AGENTS.md`, `.agents/skills` — is written through as before. The check runs before
// the parent directories are created, so a directory link to outside gets none created through it.
function write_contained(destination_path: string, content: string | Buffer): void {
	if (does_escape_project(destination_path)) {
		throw new Error(`Refusing to write ${destination_path}: it resolves outside the project`)
	}

	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, content)
}

function write_text_if_changed(destination_path: string, content: string): boolean {
	if (is_same_file_content(destination_path, content)) return false

	write_contained(destination_path, content)

	return true
}

export const file_content = { is_same_file_content, write_contained, write_text_if_changed }
