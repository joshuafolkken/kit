import {
	chmodSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { atomic_write } from '#scripts/lib/atomic-write'

const FILES = ['.npmrc', 'pnpm-lock.yaml']
const EXCLUDED = new Set(['node_modules', '.git', '.josh'])
const PRIVATE_MODE = 0o700

type ReplaceFile = (source: string, target: string) => void

interface MigrationFile {
	name: string
	content: string | undefined
	mode: number | undefined
}

interface PreparedChange {
	original: MigrationFile
	before: string
	after: string
}

function read(root: string, name: string): MigrationFile {
	const file = path.join(root, name)
	if (!existsSync(file)) return { name, content: undefined, mode: undefined }
	const stat = lstatSync(file)
	if (!stat.isFile()) throw new Error(`${name} must be a regular file`)

	return { name, content: readFileSync(file, 'utf8'), mode: stat.mode }
}

function snapshot(root: string): Array<MigrationFile> {
	return FILES.map((name) => read(root, name))
}

function stage(root: string): string {
	const directory = mkdtempSync(path.join(os.tmpdir(), 'kit-npm-migration-'))

	try {
		cpSync(root, directory, {
			recursive: true,
			dereference: true,
			filter: (file) => !EXCLUDED.has(path.basename(file)),
		})
		chmodSync(directory, PRIVATE_MODE)

		return directory
	} catch (error) {
		rmSync(directory, { recursive: true, force: true })
		throw error
	}
}

function write(root: string, file: MigrationFile): void {
	const target = path.join(root, file.name)

	if (file.content === undefined) {
		rmSync(target, { force: true })

		return
	}

	atomic_write.replace_file(target, file.content, {
		...(file.mode !== undefined && { mode: file.mode }),
	})
}

function assert_unchanged(root: string, originals: ReadonlyArray<MigrationFile>): void {
	for (const original of originals) {
		if (read(root, original.name).content !== original.content) {
			throw new Error(`${original.name} changed concurrently; migration refused`)
		}
	}
}

// Prepare both backups and replacements before touching the project. Rollback only renames
// already-written backups, so a full disk during preparation cannot leave a half migration.
function prepare_change(
	directory: string,
	original: MigrationFile,
	staged: string,
): PreparedChange {
	const before = `before-${original.name}`
	const after = `after-${original.name}`

	write(directory, { ...original, name: before })
	write(directory, { ...read(staged, original.name), name: after, mode: original.mode })

	return { original, before: path.join(directory, before), after: path.join(directory, after) }
}

function restore(root: string, change: PreparedChange): void {
	const target = path.join(root, change.original.name)

	if (change.original.content === undefined) {
		rmSync(target, { force: true })

		return
	}

	renameSync(change.before, target)
}

function apply_changes(
	root: string,
	changes: ReadonlyArray<PreparedChange>,
	replace: ReplaceFile,
): void {
	const applied: Array<PreparedChange> = []

	try {
		for (const change of changes) {
			replace(change.after, path.join(root, change.original.name))
			applied.push(change)
		}
	} catch (error) {
		for (const change of applied.toReversed()) restore(root, change)
		throw error
	}
}

function commit(
	root: string,
	originals: ReadonlyArray<MigrationFile>,
	staged: string,
	replace: ReplaceFile = renameSync,
): Array<string> {
	const changes = originals.filter((file) => read(staged, file.name).content !== file.content)
	const directory = mkdtempSync(path.join(root, '.kit-npm-transaction-'))

	try {
		const prepared = changes.map((file) => prepare_change(directory, file, staged))

		assert_unchanged(root, originals)
		apply_changes(root, prepared, replace)

		return changes.map((file) => file.name)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

const migrate_files = { read, snapshot, stage, commit }
export { migrate_files }
