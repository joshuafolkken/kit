import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ENV_FILE_NAME } from './index.js'

const PACKAGE_FILE_NAME = 'package.json'

// Both `.env` suites — the loader's own and `playwright.config.ts`'s — need the same throwaway
// project whose `.env` they control, so neither passes or fails according to whether the developer
// running them happens to have a seed set. Sharing the setup is also what keeps the two suites
// exercising the same filename the loader reads.

// The marker that makes a directory a project root for `.env` resolution (#826).
function write_package_file(directory: string): void {
	writeFileSync(path.join(directory, PACKAGE_FILE_NAME), '{}\n')
}

// #826: the loader resolves `.env` at the project root — the nearest ancestor holding a
// `package.json` — so a throwaway project needs that marker to stand in for a real one. Without it
// the resolution would climb out of the temp directory and land wherever the machine's `TMPDIR`
// happens to sit, which is exactly the machine-dependence these directories exist to remove.
function make_project_directory(prefix: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), prefix))

	write_package_file(directory)

	return directory
}

// A directory deliberately left without the marker, for the tests that pin what happens above and
// below a project root.
function make_unmarked_directory(prefix: string): string {
	return mkdtempSync(path.join(tmpdir(), prefix))
}

function write_environment_file(directory: string, contents: string): void {
	writeFileSync(path.join(directory, ENV_FILE_NAME), contents)
}

// A directory under a project root is what running `pnpm exec playwright test` from a subdirectory
// looks like.
function make_subdirectory(directory: string, name: string): string {
	const nested = path.join(directory, name)

	mkdirSync(nested, { recursive: true })

	return nested
}

function remove_subdirectory(directory: string, name: string): void {
	rmSync(path.join(directory, name), { force: true, recursive: true })
}

function clear_environment_file(directory: string): void {
	rmSync(path.join(directory, ENV_FILE_NAME), { force: true })
}

function remove_project_directory(directory: string): void {
	rmSync(directory, { force: true, recursive: true })
}

const environment_file_fixture = {
	make_project_directory,
	make_unmarked_directory,
	write_environment_file,
	write_package_file,
	make_subdirectory,
	remove_subdirectory,
	clear_environment_file,
	remove_project_directory,
}

export { environment_file_fixture }
