import { SUITE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execa } from 'execa'
import { git_command } from './git-command'
import { git_spawn } from './git-spawn'

// A merge of the default branch that stops only on generated files is finished here rather than by a
// resumed session: each such file is the output of a command, so running that command on the merged
// tree writes the one correct resolution, with no conflict marker for anyone to read.
//
// **This table is the single list of what is resolved that way** — a file a person writes never
// belongs in it, because regenerating would discard that person's side of the merge. A conflict on any
// path not listed here still stops as `conflict`. A file belongs here only once its committed content
// is exactly what its command writes: `tools/test/pure-files.ts` is not, so regenerating it would
// rewrite far more than the conflict.

interface RegeneratedFile {
	path: string
	command: ReadonlyArray<string>
}

const REGENERATED_FILES: ReadonlyArray<RegeneratedFile> = [
	{
		path: 'docs/josh-command-catalog.md',
		command: ['pnpm', 'exec', 'tsx', 'tools/document/generate-catalog.ts'],
	},
]

function regenerated_for(
	files: ReadonlyArray<string>,
	table: ReadonlyArray<RegeneratedFile>,
): ReadonlyArray<RegeneratedFile> {
	const entries = files.map((file) => table.find((entry) => entry.path === file))

	return entries.every((entry) => entry !== undefined) ? entries : []
}

// Each generator writes only its own file, so they run side by side.
async function regenerate(entries: ReadonlyArray<RegeneratedFile>, cwd: string): Promise<void> {
	await Promise.all(
		entries.map(async (entry) => {
			const [binary = '', ...command_arguments] = entry.command

			await execa(binary, command_arguments, { cwd })
		}),
	)
}

// `--no-edit` keeps the message the merge was started with — the one carrying the issue number the
// `commit-msg` hook asks for.
async function conclude_merge(entries: ReadonlyArray<RegeneratedFile>): Promise<void> {
	await git_spawn.with_output('add', ['--', ...entries.map((entry) => entry.path)])
	await git_spawn.with_output('commit', ['--no-edit'], { timeout_ms: SUITE_TIMEOUT_MS })
}

// Whether the merge that stopped on `files` was finished. A command that fails leaves the merge in
// progress and answers `false`, so the stop is the `conflict` it would have been without this table.
async function resolve(
	files: ReadonlyArray<string>,
	table: ReadonlyArray<RegeneratedFile> = REGENERATED_FILES,
): Promise<boolean> {
	const entries = regenerated_for(files, table)

	if (entries.length === 0) return false

	try {
		await regenerate(entries, await git_command.repository_root())
		await conclude_merge(entries)
	} catch {
		return false
	}

	return true
}

const main_merge_regenerate = { REGENERATED_FILES, resolve }

export type { RegeneratedFile }
export { main_merge_regenerate }
