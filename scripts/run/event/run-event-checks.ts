import { issue_cite } from '#scripts/issue/issue-cite'

// The words of a `pr-checks` event (joshuafolkken/kit#3770): `josh followup` writes them and `run:board`
// reads them back, so the one spelling lives here. A line reads
// `#3754 PR 3765 pass 6 pending 2 fail 0 coderabbit running` — the issue first, as every event names
// it, so the stream's readers key it to the child as they key any other.

const CODERABBIT_STATES = ['running', 'done', 'rate-limited', 'failed', 'none'] as const

type CodeRabbitState = (typeof CODERABBIT_STATES)[number]

interface PrChecks {
	pr: number
	pass: number
	pending: number
	fail: number
	coderabbit: CodeRabbitState
}

const CHECKS_PATTERN =
	/^#\d+ PR (?<pr>\d+) pass (?<pass>\d+) pending (?<pending>\d+) fail (?<fail>\d+) coderabbit (?<coderabbit>\S+)$/u

function text_of(issue: string, checks: PrChecks): string {
	const { pr, pass, pending, fail, coderabbit } = checks

	return `${issue_cite.plain(issue)} PR ${String(pr)} pass ${String(pass)} pending ${String(pending)} fail ${String(fail)} coderabbit ${coderabbit}`
}

const STATE_NAMES: ReadonlySet<string> = new Set(CODERABBIT_STATES)

function is_coderabbit_state(value = ''): value is CodeRabbitState {
	return STATE_NAMES.has(value)
}

// The checks a line carries, `undefined` for a line written in some other shape.
function checks_of(text: string): PrChecks | undefined {
	const groups = CHECKS_PATTERN.exec(text)?.groups
	const coderabbit = groups?.['coderabbit']

	if (groups === undefined || !is_coderabbit_state(coderabbit)) return undefined

	return {
		pr: Number(groups['pr']),
		pass: Number(groups['pass']),
		pending: Number(groups['pending']),
		fail: Number(groups['fail']),
		coderabbit,
	}
}

const run_event_checks = { checks_of, text_of }

export { run_event_checks }
export type { CodeRabbitState, PrChecks }
