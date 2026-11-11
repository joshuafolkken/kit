import { issue_body_keys } from './issue-body-keys'
import {
	ALREADY_DONE_LABEL,
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_MERGE_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	RUN_STALLED_LABEL,
} from './issue-labels'

// The single list of the stops an unattended run leaves to a person (joshuafolkken/kit#7080), each
// with why it is a person's. Every one sets that one issue or action aside and never stops the
// batch. A park label not listed here needs an automatic way out (`AUTO_RESOLVED_PARK_LABELS`).

interface HumanStop {
	key: string
	reason: string
	// The label that carries the stop, when one does.
	label?: string
	// The idle notification's heading for the issues waiting on it, when it lists them.
	idle_heading?: string
}

const UNTRUSTED_AUTHOR_KEY = 'untrusted-author'

const HUMAN_STOPS: ReadonlyArray<HumanStop> = [
	{
		key: NEEDS_DECISION_LABEL,
		label: NEEDS_DECISION_LABEL,
		reason: 'A judgement only a person can make; the run parks that issue and continues.',
		idle_heading: `Waiting on a decision (${NEEDS_DECISION_LABEL}):`,
	},
	{
		key: NEEDS_HUMAN_REVIEW_LABEL,
		label: NEEDS_HUMAN_REVIEW_LABEL,
		reason: "A person's explicit instruction on the issue; only a person removes it.",
	},
	{
		key: NEEDS_HUMAN_MERGE_LABEL,
		label: NEEDS_HUMAN_MERGE_LABEL,
		reason:
			'A PR changing `.github/workflows/**` rewrites its own CI gate; merging it unattended would weaken the gate.',
		idle_heading: `Waiting on a person to merge (${NEEDS_HUMAN_MERGE_LABEL}):`,
	},
	{
		key: ALREADY_DONE_LABEL,
		label: ALREADY_DONE_LABEL,
		reason: 'The work is already merged and closing an issue is Tier C.',
		idle_heading: `Waiting on a person to close (${ALREADY_DONE_LABEL}):`,
	},
	{
		key: UNTRUSTED_AUTHOR_KEY,
		reason: 'An author without write access is untrusted input, never run unattended.',
		idle_heading: 'Waiting on a person to vouch for the body (author without write access):',
	},
	{
		key: 'third-party-write',
		reason:
			'A tracker we do not own is never written unattended; the lane drafts it under `## Upstream candidate` and continues.',
	},
	{
		key: 'dev-engines-edit',
		reason: 'A `devEngines` / overrides edit is Tier C; only that issue parks.',
	},
	{
		key: 'irreversible-op',
		reason:
			'Force push, branch delete and destructive ops are never done; the run takes the reversible way instead.',
	},
	{
		key: 'unauthenticated',
		reason: 'Only a person can run `/login`; the batch waits without stopping.',
	},
	{
		key: 'filing-exclusion',
		reason: `\`release\`, \`breaking-change\`, \`deferred\`, \`epic\` and \`${issue_body_keys.line('judgement', 'needed')}\` keep an issue out of the pool by a person's choice (\`issue-auto-ok.ts\`).`,
	},
]

// The park labels a run lifts by itself, with the path that lifts them.
const AUTO_RESOLVED_PARK_LABELS: ReadonlyMap<string, string> = new Map([
	[RUN_STALLED_LABEL, 'backlog-drive-stalled-retry.ts'],
])

function labels(): ReadonlySet<string> {
	return new Set(HUMAN_STOPS.flatMap((stop) => stop.label ?? []))
}

function idle_stops(): ReadonlyArray<HumanStop> {
	return HUMAN_STOPS.filter((stop) => stop.idle_heading !== undefined)
}

const issue_human_stops = {
	AUTO_RESOLVED_PARK_LABELS,
	HUMAN_STOPS,
	UNTRUSTED_AUTHOR_KEY,
	idle_stops,
	labels,
}

export { issue_human_stops }
export type { HumanStop }
