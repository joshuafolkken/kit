import { agent_worker_profile } from '#scripts/agent/agent-worker-profile'
import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_stalled } from './run-stalled'
import { run_stalled_park } from './run-stalled-park'

// `josh run:park <N> --escalate "<reason>"` (joshuafolkken/kit#7356): a worker declares that its Issue
// needs a stronger `josh.worker` profile and stops. Only a repository with `josh.worker.escalate: true`
// accepts it. The park is a `run:stalled` one whose cause has no retry check, so the drive never
// re-offers it on the same profile: it resumes the lane one profile up (joshuafolkken/kit#7357).

const ESCALATE_FLAG = '--escalate'
const OPTIONS = { escalate: { type: 'string' } } as const
const DISABLED_NOTE = `run:park ${ESCALATE_FLAG}: refused — this repository's package.json does not set josh.worker.escalate to true.`

interface Escalation {
	issue: string
	reason: string
}

function is_requested(argv: ReadonlyArray<string>): boolean {
	return argv.some((token) => token === ESCALATE_FLAG || token.startsWith(`${ESCALATE_FLAG}=`))
}

// Whether the repository lets a worker declare an escalation at all.
function is_enabled(directory: string): boolean {
	const result = agent_worker_profile.read(directory)

	return result.kind === 'settings' && result.settings.escalate
}

function reason_of(value: string | undefined): string {
	return value?.trim() ?? ''
}

// The Issue and a non-blank reason, or `undefined` when either is missing.
function escalation_of(argv: ReadonlyArray<string>): Escalation | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)
	if (parsed === undefined) return undefined

	const issue = issue_number_shape.single_of(parsed.positionals)
	const reason = reason_of(parsed.values.escalate)

	return issue === undefined || reason === '' ? undefined : { issue, reason }
}

// The note a declaration is refused with, or `undefined` once it is accepted.
function refusal_of(
	escalation: Escalation | undefined,
	directory: string,
	usage: string,
): string | undefined {
	if (escalation === undefined) return usage

	return is_enabled(directory) ? undefined : DISABLED_NOTE
}

function accepted(
	argv: ReadonlyArray<string>,
	directory: string,
	usage: string,
): Escalation | undefined {
	const escalation = escalation_of(argv)
	const refusal = refusal_of(escalation, directory, usage)

	if (refusal !== undefined) console.error(refusal)

	return refusal === undefined ? escalation : undefined
}

function comment_of(escalation: Escalation): string {
	const { issue, reason } = escalation

	return [
		`Parked with \`${RUN_STALLED_LABEL}\`: ${run_stalled.ESCALATION_REQUESTED.why}`,
		`- Reason: ${reason}`,
		`- Next: the backlogrun drive resumes it one \`worker:<name>\` profile up, or hands it to a person at the top profile; without a drive, give it a stronger profile, ${run_stalled.next_step(issue)}.`,
	].join('\n')
}

// The parked Issue, or `undefined` when the declaration is refused or the park could not be written.
async function park(
	argv: ReadonlyArray<string>,
	directory: string,
	usage: string,
): Promise<string | undefined> {
	const escalation = accepted(argv, directory, usage)
	if (escalation === undefined) return undefined

	const { short } = run_stalled.escalation_requested(escalation.reason)
	const is_parked = await run_stalled_park.apply(escalation.issue, comment_of(escalation), short)

	console.info(`escalate ${session_cite.issue(escalation.issue)} — parked: ${String(is_parked)}`)

	return is_parked ? escalation.issue : undefined
}

const run_park_escalate = { ESCALATE_FLAG, is_enabled, is_requested, park }

export { run_park_escalate }
