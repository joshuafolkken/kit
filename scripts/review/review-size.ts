import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { git_path_quoting } from '#scripts/git/git-path-quoting'
import { git_spawn } from '#scripts/git/git-spawn'
import { split_assess } from '#scripts/split/split-assess'
import { split_measure } from '#scripts/split/split-measure'

function tracked_counts(raw: string): Map<string, number> {
	const rows = raw.split('\n').filter((row) => row !== '')

	if (rows.some((row) => !/^\d+\t\d+\t.+$/u.test(row))) throw new Error('Unknown diff size')

	const changes = split_assess.parse_numstat(raw)

	return new Map(
		changes.map((change) => [git_path_quoting.unquote(change.path), change.changed_lines]),
	)
}

async function tracked_numstat(is_staged: boolean): Promise<string> {
	if (is_staged) {
		return await git_spawn.read([
			'-c',
			'core.quotePath=false',
			'diff',
			'--cached',
			'--numstat',
			'--no-relative',
			'--no-renames',
			'--',
		])
	}

	const base = await change_base.resolved_through_merge()

	if (base === undefined) throw new Error('Unresolved change base')

	return await git_command.diff_numstat_since(base)
}

async function untracked_count(root: string, file: string): Promise<number> {
	const content = await readFile(path.join(root, file))

	if (content.includes(0)) throw new Error('Binary diff size')

	return split_measure.line_count(content)
}

async function counts_here(is_staged: boolean): Promise<Map<string, number>> {
	const counts = tracked_counts(await tracked_numstat(is_staged))

	if (is_staged) return counts
	const files = changed_paths.to_paths(await git_command.untracked_names())
	const root = await git_spawn.read(['rev-parse', '--show-toplevel'])
	const additions = await Promise.all(
		files.map(async (file) => {
			const unquoted = git_path_quoting.unquote(file)

			return [unquoted, await untracked_count(root, unquoted)] as const
		}),
	)

	return new Map([...counts, ...additions])
}

function total_of(counts: Map<string, number>): number {
	let total = 0

	for (const lines of counts.values()) total += lines

	return total
}

// Count the entire selected scope, including tests. Any failed measurement stays unknown.
async function read(paths: ReadonlyArray<string>, is_staged = false): Promise<number | undefined> {
	try {
		const counts = await counts_here(is_staged)

		if (paths.some((file) => !counts.has(git_path_quoting.unquote(file)))) return undefined

		return total_of(counts)
	} catch {
		return undefined
	}
}

const review_size = { read }

export { review_size }
