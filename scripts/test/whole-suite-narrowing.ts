import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { file_reader } from '#scripts/lib/read-file'
import { direct_importers } from './direct-importers'
import { lockfile_changed_packages } from './lockfile-changed-packages'
import { package_version_only } from './package-version-only'
import { pure_files_entries } from './pure-files-entries'
import { related_scope, type ScopeRequest } from './test-related-scope'
import { whole_suite_files } from './whole-suite-files'

// The readings that let a moved whole-suite file narrow — each compares the file at the change base
// with the working tree — kept out of `test-related-scope.ts`, which stays pure.

interface Sides {
	before: string
	after: string
}

type Narrowing = Pick<ScopeRequest, 'lockfile_importers' | 'pure_entries' | 'version_only'>

const { WHOLE_SUITE_FILES } = whole_suite_files

async function base_text(file: string): Promise<string | undefined> {
	try {
		return await git_command.show_file(`${await git_command.change_base()}:${file}`)
	} catch {
		return undefined
	}
}

// The file at the change base and in the working tree, or `undefined` when the change did not move it
// or either side cannot be read.
async function sides_of(
	root: string,
	changed: ReadonlyArray<string> | undefined,
	file: string,
): Promise<Sides | undefined> {
	if (changed?.includes(file) !== true) return undefined

	const before = await base_text(file)
	const after = file_reader.read_if_readable(path.join(root, file))

	if (before === undefined || after === undefined) return undefined

	return { before, after }
}

// The entries this branch moved in the pure-files list, or `undefined` when the list did not change,
// changed beyond its entries, or either side cannot be read.
async function read_pure_entries(
	root: string,
	changed: ReadonlyArray<string> | undefined,
): Promise<ReadonlyArray<string> | undefined> {
	const sides = await sides_of(root, changed, pure_files_entries.PURE_FILES_PATH)

	return sides === undefined
		? undefined
		: pure_files_entries.moved_entries(sides.before, sides.after)
}

// `package.json` when this branch moved its `version` alone; nothing otherwise.
async function read_version_only(
	root: string,
	changed: ReadonlyArray<string> | undefined,
): Promise<ReadonlySet<string>> {
	const { PACKAGE_PATH, is_version_only } = package_version_only
	const sides = await sides_of(root, changed, PACKAGE_PATH)
	const is_only = sides !== undefined && is_version_only(sides.before, sides.after)

	return new Set(is_only ? [PACKAGE_PATH] : [])
}

// The modules importing a package this branch's `pnpm-lock.yaml` change moved, or `undefined` when the
// lockfile did not change, the change reaches every test (`lockfile-changed-packages.ts`), or a file
// every test depends on imports one of them.
async function read_lockfile_importers(
	root: string,
	changed: ReadonlyArray<string> | undefined,
): Promise<ReadonlyArray<string> | undefined> {
	const { LOCKFILE_PATH, affected_packages } = lockfile_changed_packages
	const sides = await sides_of(root, changed, LOCKFILE_PATH)
	const packages = sides === undefined ? undefined : affected_packages(sides.before, sides.after)

	if (packages === undefined) return undefined

	const importers = await direct_importers.package_importers(root, packages, (file) =>
		related_scope.is_relatable(file),
	)

	return importers.some((file) => WHOLE_SUITE_FILES.has(file)) ? undefined : importers
}

async function read(root: string, changed: ReadonlyArray<string> | undefined): Promise<Narrowing> {
	return {
		pure_entries: await read_pure_entries(root, changed),
		version_only: await read_version_only(root, changed),
		lockfile_importers: await read_lockfile_importers(root, changed),
	}
}

const whole_suite_narrowing = {
	read,
	read_lockfile_importers,
	read_pure_entries,
	read_version_only,
}

export { whole_suite_narrowing }
