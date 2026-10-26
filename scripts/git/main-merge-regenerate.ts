import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SUITE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execa } from 'execa'
import { git_command } from './git-command'
import { git_spawn } from './git-spawn'
import { main_merge_budget_conflict } from './main-merge-budget-conflict'

// A merge of the default branch that stops only on the files below is finished here rather than by a
// resumed session, with no conflict marker for anyone to read. A generated file is the output of a
// command, so running that command on the merged tree writes the one correct resolution. A rewritten
// file is resolved by a rule that keeps both sides of the merge, and throws on any hunk it cannot.
//
// **This table is the single list of what is resolved that way** — a file a person writes belongs in
// it only with a rewrite rule, because regenerating would discard that person's side of the merge. A
// conflict on any path not listed here still stops as `conflict`. A file is regenerated only once its
// committed content is exactly what its command writes: `tools/test/pure-files.ts` is not, so
// regenerating it would rewrite far more than the conflict.

interface RegeneratedFile {
	path: string
	command: ReadonlyArray<string>
}

interface RewrittenFile {
	path: string
	rewrite: (content: string) => string
}

type ResolvedFile = RegeneratedFile | RewrittenFile

const RESOLVED_FILES: ReadonlyArray<ResolvedFile> = [
	{
		path: 'docs/josh-command-catalog.md',
		command: ['pnpm', 'exec', 'tsx', 'tools/document/generate-catalog-main.ts'],
	},
	{
		path: main_merge_budget_conflict.BUDGET_TABLE_PATH,
		rewrite: main_merge_budget_conflict.resolve,
	},
]

function resolved_for(
	files: ReadonlyArray<string>,
	table: ReadonlyArray<ResolvedFile>,
): ReadonlyArray<ResolvedFile> {
	const entries = files.map((file) => table.find((entry) => entry.path === file))

	return entries.every((entry) => entry !== undefined) ? entries : []
}

async function rewrite_file(entry: RewrittenFile, cwd: string): Promise<void> {
	const file = path.join(cwd, entry.path)

	await writeFile(file, entry.rewrite(await readFile(file, 'utf8')))
}

async function regenerate_file(entry: RegeneratedFile, cwd: string): Promise<void> {
	const [binary = '', ...command_arguments] = entry.command

	await execa(binary, command_arguments, { cwd })
}

// Each entry writes only its own file, so they run side by side.
async function regenerate(entries: ReadonlyArray<ResolvedFile>, cwd: string): Promise<void> {
	await Promise.all(
		entries.map(async (entry) => {
			await ('rewrite' in entry ? rewrite_file(entry, cwd) : regenerate_file(entry, cwd))
		}),
	)
}

// `--no-edit` keeps the message the merge was started with — the one carrying the issue number the
// `commit-msg` hook asks for.
async function conclude_merge(entries: ReadonlyArray<ResolvedFile>): Promise<void> {
	await git_spawn.with_output('add', ['--', ...entries.map((entry) => entry.path)])
	await git_spawn.with_output('commit', ['--no-edit'], { timeout_ms: SUITE_TIMEOUT_MS })
}

// Whether the merge that stopped on `files` was finished. A command that fails, or a rewrite that
// refuses a hunk, leaves the merge in progress and answers `false`, so the stop is the `conflict` it would have been without this table.
async function resolve(
	files: ReadonlyArray<string>,
	table: ReadonlyArray<ResolvedFile> = RESOLVED_FILES,
): Promise<boolean> {
	const entries = resolved_for(files, table)

	if (entries.length === 0) return false

	try {
		await regenerate(entries, await git_command.repository_root())
		await conclude_merge(entries)
	} catch {
		return false
	}

	return true
}

const main_merge_regenerate = { RESOLVED_FILES, resolve }

export type { RegeneratedFile, ResolvedFile, RewrittenFile }
export { main_merge_regenerate }
