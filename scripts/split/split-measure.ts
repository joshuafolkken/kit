import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { change_base } from '#scripts/git/change-base'
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
// `git diff --numstat` counts it. An entry with no readable content — a dangling symlink, a nested
// repository's directory — still counts as a file, of zero lines, so one such entry cannot reject
// the whole measurement.
//
// joshuafolkken/kit#4696: **the tracked half is measured from the tree's base, through a merge in
// progress** (`change_base.resolved_through_merge`). A merge of the default branch stopped on a
// conflict has already put the default branch's files in the work tree while `HEAD` is still the
// commit before it, so measuring from `HEAD`'s merge-base counted everything the merge brought in as
// this branch's own — 53 files where the branch had 10. A base that cannot be resolved throws, so no
// caller reads it as under the guide: the notices report the diff as unmeasured and `split:assess`
// fails outright.

const UNRESOLVED_BASE = 'the change base could not be resolved'
const NUL_BYTE = 0
const NO_CONTENT = Buffer.alloc(0)
const NEWLINE = '\n'

function line_count(content: Buffer): number {
	if (content.includes(NUL_BYTE)) return 0

	const text = content.toString('utf8')
	const newlines = text.split(NEWLINE).length - 1

	return text === '' || text.endsWith(NEWLINE) ? newlines : newlines + 1
}

async function read_content(file_path: string): Promise<Buffer> {
	try {
		return await readFile(file_path)
	} catch {
		return NO_CONTENT
	}
}

async function untracked_row(root: string, file: string): Promise<string> {
	const lines = line_count(await read_content(path.join(root, file)))

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

async function tracked_numstat(): Promise<string> {
	const base = await change_base.resolved_through_merge()

	if (base === undefined) throw new Error(UNRESOLVED_BASE)

	return await git_command.diff_numstat_since(base)
}

async function read_branch(): Promise<ReturnType<typeof split_assess.assess>> {
	const tracked = await tracked_numstat()

	return split_assess.assess(`${tracked}${NEWLINE}${await untracked_numstat()}`)
}

const split_measure = { line_count, read_branch }

export { split_measure }
