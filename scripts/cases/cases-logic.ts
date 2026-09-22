import { readFileSync } from 'node:fs'

// `josh cases <path...>` (joshuafolkken/kit#2246): read the changed paths and answer which I/O
// boundaries the code crosses — network, process start, filesystem — then name the abnormal cases
// that boundary always owes. The unit suite blocks network by construction
// (`scripts/test/test-network-guard.ts`), so a boundary's abnormal cases never run there; this makes
// the declaration side name them instead, read off the diff rather than off judgement.
// `prompts/collaboration-workflow/report-format.md` is the single source of where the answer goes —
// the second tier of the case-based test declaration ("if it breaks").

type Boundary = 'network' | 'process' | 'fs' | 'time'
const NONE = 'none'

interface BoundaryDefinition {
	boundary: Boundary
	// A source pattern that marks the boundary being crossed — an import of, or a call into, it.
	pattern: RegExp
	// The abnormal cases this boundary always owes, so they land in the second tier.
	cases: ReadonlyArray<string>
}

const BOUNDARIES: ReadonlyArray<BoundaryDefinition> = [
	{
		boundary: 'network',
		// Keyed on a networking API, never a bare URL: a URL in a comment, a doc link or a
		// string constant crosses no boundary at test time, so matching `https://` text alone
		// would fire `network` on every markdown edit and defeat the oracle.
		pattern: /\b(?:fetch|axios|undici|node:https?|XMLHttpRequest)\b/u,
		cases: ['非200', 'タイムアウト', '空レスポンス', '不正JSON', 'レート制限'],
	},
	{
		boundary: 'process',
		// The module name and the `*Sync` forms are unambiguous; the short verbs (`exec`, `spawn`,
		// `execFile`) require a call paren, so prose like "exec the plan" or a local named `exec`
		// no longer fires the boundary.
		pattern:
			/\b(?:child_process|execSync|execFileSync|spawnSync)\b|\b(?:exec|execFile|spawn)\s*\(/u,
		cases: ['非ゼロ終了', 'タイムアウト', '標準エラー出力', '実行ファイル不在'],
	},
	{
		boundary: 'fs',
		// Same rule as process: the module names and `*Sync` forms are unambiguous, and the short
		// verbs (`readFile`, `writeFile`, `mkdir`, `unlink`, `readdir`, `rm`) require a call paren,
		// so prose like "rm the old files" no longer fires the boundary.
		pattern:
			/\b(?:node:fs|fs\/promises|readFileSync|writeFileSync)\b|\b(?:readFile|writeFile|mkdir|unlink|readdir|rm)\s*\(/u,
		cases: ['ファイル不在', '権限エラー', '空ファイル', '不正な内容', '並行書き込み'],
	},
	{
		boundary: 'time',
		// The absence boundary: a change that coordinates over time — timers, schedules, retries,
		// heartbeats — owes the cases where the awaited thing never happens, which no diff of an I/O
		// call can surface (joshuafolkken/kit#2356). Same over-firing discipline as process and fs: the
		// verbs (`setInterval`, `schedule`, `retry`) require a call paren so prose like "schedule the
		// release" no longer fires, while the domain nouns (`cron`, `heartbeat`, `watchdog`, `liveness`)
		// are unambiguous enough in source to match bare.
		pattern:
			/\b(?:setInterval|setTimeout|setImmediate|schedule|reschedule|retry)\s*\(|\b(?:cron|crontab|heartbeat|watchdog|liveness)\b/u,
		cases: ['期待した事象が到来しない', '期限超過', '重複発火', '再試行が尽きる'],
	},
]

// A path that cannot be read counts as no boundary rather than an error: a deleted or renamed path in
// a diff is still passed in, and the answer for it is simply "nothing crossed here".
function read_file(path: string): string {
	try {
		return readFileSync(path, 'utf8')
	} catch {
		return ''
	}
}

// The distinct boundaries any of the paths cross. The content is joined and each boundary is tested
// once, so the same boundary is never reported twice however many paths cross it.
function boundaries_in(paths: ReadonlyArray<string>): ReadonlyArray<Boundary> {
	const content = paths.map((path) => read_file(path)).join('\n')

	return BOUNDARIES.filter((definition) => definition.pattern.test(content)).map(
		(definition) => definition.boundary,
	)
}

// The abnormal cases owed by the given boundaries, in the fixed boundary order.
function cases_for(boundaries: ReadonlyArray<Boundary>): ReadonlyArray<string> {
	return BOUNDARIES.filter((definition) => boundaries.includes(definition.boundary)).flatMap(
		(definition) => definition.cases,
	)
}

// The fixed verdict vocabulary the command can print — the three boundary tokens and `none`. The
// decision-oracle test asserts its registered vocabulary equals this.
const VOCABULARY: ReadonlyArray<string> = [
	...BOUNDARIES.map((definition) => definition.boundary),
	NONE,
]

const cases = { BOUNDARIES, NONE, VOCABULARY, boundaries_in, cases_for }

export type { Boundary }
export { cases }
