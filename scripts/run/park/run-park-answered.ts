import { answer_judge } from '#scripts/agent/answer-judge'
import type { AnswerVerdict, Evidence } from '#scripts/agent/answer-verdict'
import { issue_sources, type SourcesRead } from '#scripts/issue/issue-sources'
import { session_cite } from '#scripts/issue/session-cite'
import { session_language } from '#scripts/josh/session-language'

// **A park asks a person only what the Issue has not already decided** (joshuafolkken/kit#6531).
// Before any write, `answer_judge` reads the question against the Issue's trusted sources: an answered
// question is refused with the quotes that answer it, an unanswered one parks as before, and a read or
// judgment that failed refuses too — a park is never written on a verdict nobody could read.
// A confirmed usage limit alone permits parking: skipping the check can only ask a person twice.

const FAILURE_EXIT_CODE = 1
const NO_WRITE = 'Nothing was labelled, commented, recorded or released.'

type Answered = Extract<AnswerVerdict, { kind: 'answered' }>
type ParkCheck = { exit_code: number } | { note: string } | undefined

function park_command(issue_number: string): string {
	return `pnpm josh run:park ${issue_number} --body-file <path> --outcome "<next action>"`
}

function refused(lines: ReadonlyArray<string>): number {
	console.error(lines.join('\n'))

	return FAILURE_EXIT_CODE
}

function evidence_line(evidence: Evidence): string {
	const { source, quote } = evidence
	const origin = source.author === undefined ? '' : ` (${source.author} ${source.created_at ?? ''})`

	return `- ${source.id}${origin}: "${quote}"`
}

function answered(issue_number: string, verdict: Answered): number {
	return refused([
		`Park refused: ${session_cite.issue(issue_number)} already answers this question — ${verdict.decision} (${verdict.decision_kind}).`,
		...verdict.evidence.map((evidence) => evidence_line(evidence)),
		`Follow that decision: record \`Auto-decided: <choice> over <alt> because <reason>\` on the Issue with \`pnpm josh issue:comment ${issue_number} --body-file <path>\`, then continue the run. ${NO_WRITE}`,
	])
}

function failed(issue_number: string, cause: string, retry: string): number {
	return refused([
		`Park failed: ${cause}. ${NO_WRITE}`,
		`Retry: ${retry} (\`${park_command(issue_number)}\`)`,
	])
}

function read_failure(
	issue_number: string,
	read: Exclude<SourcesRead, { kind: 'sources' }>,
): number {
	const hint = read.hint === undefined ? '' : ` — ${read.hint}`
	const retry = read.is_retryable
		? 're-run once the Issue reads again'
		: `check the number: ${session_cite.issue(issue_number)} does not exist`

	return failed(issue_number, `the Issue's sources could not be read (${read.kind}${hint})`, retry)
}

function unavailable_note(cause: string): string {
	const { lang } = session_language.resolve_session_lang()

	return session_language.is_japanese(lang)
		? `使用量上限で判断プロセスが動かず、答え済みかの判断を省きました。理由: ${cause}`
		: `The judgment hit a usage limit, so the existing-answer check was skipped. Cause: ${cause}`
}

function outcome(issue_number: string, verdict: AnswerVerdict): ParkCheck {
	if (verdict.kind === 'unanswered') return undefined
	if (verdict.kind === 'unavailable') return { note: unavailable_note(verdict.cause) }

	if (verdict.kind === 'failed') {
		return { exit_code: failed(issue_number, verdict.cause, verdict.retry) }
	}

	return { exit_code: answered(issue_number, verdict) }
}

// A note annotates a permitted park; an exit code stops it before any write.
async function refusal_of(
	issue_number: string,
	question: string,
	directory: string,
): Promise<ParkCheck> {
	const read = await issue_sources.read_sources(issue_number)

	if (read.kind !== 'sources') return { exit_code: read_failure(issue_number, read) }

	const verdict = await answer_judge.judge({ question, sources: read.sources, directory })

	return outcome(issue_number, verdict)
}

const run_park_answered = { refusal_of }

export { run_park_answered }
export type { ParkCheck }
