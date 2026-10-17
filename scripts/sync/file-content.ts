import {
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { PROJECT_ROOT } from '#scripts/init/init-paths'

function is_absent_error(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function is_read_denied(error: unknown): boolean {
	return (
		error instanceof Error && 'code' in error && ['EACCES', 'EPERM'].includes(String(error.code))
	)
}

function is_regular_existing_file(destination_path: string): boolean {
	try {
		return lstatSync(destination_path).isFile()
	} catch (error) {
		if (is_absent_error(error)) return false
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

function try_realpath(target: string): string | undefined {
	try {
		return realpathSync(target)
	} catch (error) {
		if (is_absent_error(error)) return undefined
		throw error
	}
}

// A dangling symlink is followed by hand: the write would create the file it names, not the link.
// A relative link is read from its directory's real path, as the kernel reads it — the lexical
// parent may itself be a link, and `..` from it lands somewhere else.
function follow_dangling_links(target: string): string {
	let current = target

	for (let link = read_symlink(current); link !== undefined; link = read_symlink(current)) {
		current = path.resolve(realpathSync(path.dirname(current)), link)
	}

	return current
}

// Where a write to `target` lands. `realpathSync` refuses a path that does not exist yet, so the
// not-yet-created tail is appended to the real path of its nearest existing ancestor.
function resolve_write_path(target: string): string {
	const real = try_realpath(target)
	if (real !== undefined) return real

	const unlinked = follow_dangling_links(target)
	const parent = path.dirname(unlinked)
	if (parent === unlinked) return unlinked

	return path.join(resolve_write_path(parent), path.basename(unlinked))
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
