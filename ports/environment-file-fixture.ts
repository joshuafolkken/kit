import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ENV_FILE_NAME } from './index.js'

// Both `.env` suites — the loader's own and `playwright.config.ts`'s — need the same throwaway
// project whose `.env` they control, so neither passes or fails according to whether the developer
// running them happens to have a seed set. Sharing the setup is also what keeps the two suites
// exercising the same filename the loader reads.

function make_project_directory(prefix: string): string {
	return mkdtempSync(path.join(tmpdir(), prefix))
}

function write_environment_file(directory: string, contents: string): void {
	writeFileSync(path.join(directory, ENV_FILE_NAME), contents)
}

function clear_environment_file(directory: string): void {
	rmSync(path.join(directory, ENV_FILE_NAME), { force: true })
}

function remove_project_directory(directory: string): void {
	rmSync(directory, { force: true, recursive: true })
}

const environment_file_fixture = {
	make_project_directory,
	write_environment_file,
	clear_environment_file,
	remove_project_directory,
}

export { environment_file_fixture }
