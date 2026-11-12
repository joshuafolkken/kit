import {
	agent_worker_profile,
	type WorkerProfile,
	type WorkerSettings,
} from '#scripts/agent/agent-worker-profile'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { issue_cite } from '#scripts/issue/issue-cite'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { issue_park } from '#scripts/issue/issue-park'

// joshuafolkken/kit#7357: a worker's escalation park (joshuafolkken/kit#7356) resumes the same lane one
// `josh.worker` profile up. The Issue's `worker:<name>` label moves to the next profile, so the
// re-dispatch resolves it and records it in the lane's `.env`, and every later resume keeps it. At the
// top profile the Issue goes to a person. A repository without `josh.worker.escalate` is left as before.

interface EscalatePorts {
	labels: () => Promise<ReadonlyArray<string> | undefined>
	retry: (issue: number) => Promise<void>
}

interface Move {
	from: WorkerProfile
	to: WorkerProfile
}

function label_of(worker: WorkerProfile): string {
	return `${agent_worker_profile.LABEL_PREFIX}${worker.name}`
}

function enabled_settings(directory: string): WorkerSettings | undefined {
	const result = agent_worker_profile.read(directory)
	if (result.kind !== 'settings') return undefined

	return result.settings.escalate ? result.settings : undefined
}

async function current_worker(
	settings: WorkerSettings,
	read_labels: EscalatePorts['labels'],
): Promise<WorkerProfile | undefined> {
	const labels = await read_labels()
	if (labels === undefined) return undefined
	const result = agent_worker_profile.for_labels(settings, labels)

	return result.kind === 'worker' ? result.worker : undefined
}

// The new label goes on before the old one comes off: a failure in between leaves two `worker:` labels,
// which the dispatch refuses, never a lane resumed on the old profile.
async function relabel(issue: string, move: Move): Promise<boolean> {
	if (!(await git_gh_issue_write.issue_add_label(issue, label_of(move.to)))) return false

	return await git_gh_issue_write.issue_clear_label(issue, label_of(move.from))
}

function agent_of(worker: WorkerProfile): string {
	return `${worker.agent.model} / ${worker.agent.effort}`
}

function step_note(move: Move, reason: string): string {
	return [
		`Escalated the worker from \`${label_of(move.from)}\` (${agent_of(move.from)}) to \`${label_of(move.to)}\` (${agent_of(move.to)}); the lane resumes in the same worktree.`,
		`- Reason: ${reason}`,
	].join('\n')
}

async function step_up(
	issue: number,
	move: Move,
	reason: string,
	retry: EscalatePorts['retry'],
): Promise<void> {
	if (!(await relabel(String(issue), move))) {
		console.error(
			`Could not move ${issue_cite.plain_for('program', issue)} to ${label_of(move.to)}. Left for a person.`,
		)

		return
	}

	await git_gh_issue_write.issue_try_comment(String(issue), step_note(move, reason))
	await retry(issue)
}

function top_note(top: WorkerProfile, reason: string): string {
	return [
		`Parked with \`${NEEDS_DECISION_LABEL}\`: the worker asked for a stronger profile, but \`${label_of(top)}\` is the top of josh.worker.profiles.`,
		`- Reason: ${reason}`,
		'- Next: a person decides how to go on.',
	].join('\n')
}

async function hand_over(issue: number, top: WorkerProfile, reason: string): Promise<void> {
	await issue_park.apply(String(issue), NEEDS_DECISION_LABEL, top_note(top, reason))
}

// The settings are read before the labels, so a repository without escalation costs no GitHub read.
async function escalate(
	issue: number,
	reason: string,
	ports: EscalatePorts,
	directory = process.cwd(),
): Promise<void> {
	const settings = enabled_settings(directory)
	if (settings === undefined) return
	const from = await current_worker(settings, ports.labels)
	if (from === undefined) return
	const to = agent_worker_profile.next(settings, from)

	await (to === undefined
		? hand_over(issue, from, reason)
		: step_up(issue, { from, to }, reason, ports.retry))
}

export const backlog_drive_escalate = { escalate }
