// The depth test's table (`.claude/skills/workflow-commands/observation-filing.md` → "The depth test"),
// read off the subject's path instead of applied by the agent: the deepest row whose prefix the path
// starts with wins, and a path no row claims is depth 0 — what a consumer of this package touches.

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

const LEADING_DOT_SLASH = /^(?:\.\/)+/u

function answer_of(row: DepthRow, matched: string | undefined): DepthAnswer {
	return { depth: `d${String(row.depth)}`, subject: row.subject, matched }
}

function of(subject_path: string): DepthAnswer {
	const path = subject_path.replace(LEADING_DOT_SLASH, '')

	for (const row of DEEPER_ROWS) {
		const matched = row.prefixes.find((prefix) => path.startsWith(prefix))

		if (matched !== undefined) return answer_of(row, matched)
	}

	return answer_of(CONSUMER_ROW, undefined)
}

const observation_depth = { of }

export { observation_depth }
export type { DepthAnswer }
