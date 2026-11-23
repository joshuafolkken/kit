import { git_spawn } from '#scripts/git/git-spawn'
import { defect_report } from './defect-report'

// The denominator of `defect:report --since`: how many pull requests merged in the period touched
// each area, read from the local first-parent merge history with its file names — no API call per
// pull request.

const RECORD = '\u{1E}'
const PULL_REQUEST_MERGE = /^Merge pull request #\d+ /u

function arguments_since(since: Date): Array<string> {
	return [
		'log',
		'--first-parent',
		'--merges',
		'--diff-merges=first-parent',
		'--name-only',
		`--since=${since.toISOString()}`,
		`--format=${RECORD}%s`,
	]
}

// One record per merge: its subject, then the file names it changed against its first parent.
function merge_paths(record: string): ReadonlyArray<string> | undefined {
	const [subject = '', ...paths] = record.split('\n').filter((line) => line.length > 0)

	return PULL_REQUEST_MERGE.test(subject) ? paths : undefined
}

function count_areas(log: string): ReadonlyMap<string, number> {
	const counts = new Map<string, number>()
	const merges = log
		.split(RECORD)
		.map((record) => merge_paths(record))
		.filter((paths) => paths !== undefined)
	const touched = merges.flatMap((paths) => defect_report.path_areas(paths))

	for (const area of touched) counts.set(area, (counts.get(area) ?? 0) + 1)

	return counts
}

async function read(since: Date): Promise<ReadonlyMap<string, number>> {
	return count_areas(await git_spawn.read(arguments_since(since)))
}

const defect_merge_areas = { count_areas, read }

export { defect_merge_areas }
