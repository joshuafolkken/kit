import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { split_assess } from './split-assess'

// The branch's size measurement — the one reading every `split_assess` caller takes.
//
// joshuafolkken/kit#4302: `git diff` never lists an untracked file, and a run has staged nothing
// when it measures, so the diff alone counted every new file a branch created as absent. Each
// untracked file is added as a numstat row of its line count, so a branch made of new modules
// measures as large as it is. A file holding a NUL byte is binary and counts zero lines, as
// `git diff --numstat` counts it.

const NUL_BYTE = 0
const NEWLINE = '\n'

function line_count(content: Buffer): number {
	if (content.includes(NUL_BYTE)) return 0

	const text = content.toString('utf8')
	const newlines = text.split(NEWLINE).length - 1

	return text === '' || text.endsWith(NEWLINE) ? newlines : newlines + 1
}

async function untracked_row(root: string, file: string): Promise<string> {
	const lines = line_count(await readFile(path.join(root, file)))

	return `${String(lines)}\t0\t${file}`
}

async function untracked_numstat(): Promise<string> {
	const files = changed_paths.to_paths(await git_command.untracked_names())

	if (files.length === 0) return ''

	const toplevel = await git_spawn.read(['rev-parse', '--show-toplevel'])
	const root = toplevel.trim()
	const rows = await Promise.all(files.map(async (file) => await untracked_row(root, file)))

	return rows.join(NEWLINE)
}

async function read_branch(): Promise<ReturnType<typeof split_assess.assess>> {
	const tracked = await git_command.diff_main_numstat()

	return split_assess.assess(`${tracked}${NEWLINE}${await untracked_numstat()}`)
}

const split_measure = { line_count, read_branch }

export { split_measure }
