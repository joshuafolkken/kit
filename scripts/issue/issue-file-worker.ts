import {
	agent_worker_profile,
	type SettingsResult,
	type WorkerSettings,
} from '#scripts/agent/agent-worker-profile'
import { issue_file } from './issue-file'
import type { LabelDefinition } from './issue-labels'

// `issue:file`'s side of `josh.worker`: a filing into a repository that sets it prints the profiles to
// choose from, refuses a `worker:<name>` label naming none of them, and provisions the chosen label
// beside kit's own. kit never picks a profile from the Issue's content. Without the setting — or for a
// filing into another repository, whose setting this checkout does not hold — nothing here prints or
// asks GitHub anything.
const { LABEL_PREFIX } = agent_worker_profile
const LABEL_COLOR = 'bfd4f2'
const LABEL_DESCRIPTION = 'Lane worker profile (josh.worker)'

interface Target {
	target: string
	current: string
}

function settings_of(place: Target): SettingsResult | undefined {
	if (!issue_file.is_same_repository(place.target, place.current)) return undefined

	return agent_worker_profile.read(process.cwd())
}

function worker_labels(labels: ReadonlyArray<string>): ReadonlyArray<string> {
	return labels.filter((label) => label.startsWith(LABEL_PREFIX))
}

// The profiles weakest first, as `josh.worker` lists them, and the one an unlabelled Issue runs on.
function guide_of(settings: WorkerSettings): string {
	const rows = settings.profiles.map(
		(profile) => `  ${LABEL_PREFIX}${profile.name} — ${profile.when}`,
	)

	return [
		`worker profiles (josh.worker, weakest first) — choose one with --label ${LABEL_PREFIX}<name>; none → ${settings.default}:`,
		...rows,
	].join('\n')
}

// A broken setting refuses only a filing that chose a profile it cannot check; any other filing goes on.
function is_unchecked_clear(note: string, labels: ReadonlyArray<string>): boolean {
	if (worker_labels(labels).length === 0) {
		console.warn(`⚠ ${note}`)

		return true
	}

	console.error(`✖ ${note}`)

	return false
}

function is_choice_clear(settings: WorkerSettings, labels: ReadonlyArray<string>): boolean {
	console.info(guide_of(settings))
	const chosen = agent_worker_profile.for_labels(settings, labels)

	if (chosen.kind === 'worker') return true
	console.error(`✖ ${chosen.kind === 'rejected' ? chosen.note : chosen.kind}`)

	return false
}

// A one-pass step (`issue-file-pass.ts`): false once it printed its refusal.
function is_worker_clear(place: Target, labels: ReadonlyArray<string>): boolean {
	const result = settings_of(place)

	if (result === undefined || result.kind === 'unset') return true
	if (result.kind === 'rejected') return is_unchecked_clear(result.note, labels)

	return is_choice_clear(result.settings, labels)
}

// The `worker:<name>` labels `ensure_labels` creates beside kit's own — none without the setting.
function label_definitions(
	place: Target,
	labels: ReadonlyArray<string>,
): ReadonlyArray<LabelDefinition> {
	if (settings_of(place)?.kind !== 'settings') return []

	return worker_labels(labels).map((name) => ({
		name,
		color: LABEL_COLOR,
		description: LABEL_DESCRIPTION,
	}))
}

const issue_file_worker = { is_worker_clear, label_definitions }

export { issue_file_worker }
