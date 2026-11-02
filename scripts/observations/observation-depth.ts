import path from 'node:path'

// The depth test's rows — their single source; `.claude/skills/workflow-commands/observation-filing.md`
// → "The depth test" points here through `josh observation:depth`. The deepest row whose prefix the
// path starts with wins, and a path no row claims is depth 0 — what a consumer of this package touches.

interface DepthRow {
	depth: number
	subject: string
	prefixes: ReadonlyArray<string>
}

interface DepthAnswer {
	depth: string
	subject: string
	matched: string | undefined
}

const CONSUMER_ROW: DepthRow = {
	depth: 0,
	subject: 'What a consumer of this package touches',
	prefixes: [],
}

const DEEPER_ROWS: ReadonlyArray<DepthRow> = [
	{
		depth: 2,
		subject: 'What measures a run',
		prefixes: [
			'scripts/cost-runtime/',
			'scripts/time-runtime/',
			'tools/cost/',
			'tools/cost-audit/',
			'tools/time/',
			'tools/metrics/',
		],
	},
	{
		depth: 1,
		subject: 'The run orchestration that executes an Issue',
		prefixes: [
			'.claude/skills/workflow-commands/',
			'scripts/backlog/',
			'scripts/delegation/',
			'scripts/epic/',
			'scripts/issue/issue-file',
			'scripts/lane/',
			'scripts/observations/',
			'scripts/run/',
			'scripts/split/',
		],
	},
]

// A path typed from anywhere — absolute, or relative to the caller's directory — read as the
// repository-relative POSIX path the rows are written in; `undefined` when it falls outside the root.
function repository_path(root: string, cwd: string, typed: string): string | undefined {
	const relative = path.relative(root, path.resolve(cwd, typed)).split(path.sep).join('/')

	if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return undefined

	return relative
}

function answer_of(row: DepthRow, matched: string | undefined): DepthAnswer {
	return { depth: `d${String(row.depth)}`, subject: row.subject, matched }
}

// `scripts/lane` names the directory `scripts/lane/` does, so a trailing slash is not required.
function of(subject_path: string): DepthAnswer {
	const subject = `${subject_path}/`

	for (const row of DEEPER_ROWS) {
		const matched = row.prefixes.find((prefix) => subject.startsWith(prefix))

		if (matched !== undefined) return answer_of(row, matched)
	}

	return answer_of(CONSUMER_ROW, undefined)
}

const observation_depth = { of, repository_path }

export { observation_depth }
export type { DepthAnswer }
