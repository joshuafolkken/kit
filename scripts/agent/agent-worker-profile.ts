import { json_value } from '#scripts/lib/json-value'
import {
	package_manifest,
	type WorkerConfig,
	type WorkerProfileDefinition,
} from '#scripts/lib/package-manifest'
import { file_reader } from '#scripts/lib/read-file'
import type { z } from 'zod'
import { agent_profile_schema, type AgentProfile } from './agent-profile-schema'
import type { Rejected } from './agent-provider'
import { agent_role_profile } from './agent-role-profile'

// The per-Issue worker profile a repository opts into with `josh.worker` in its `package.json`: the
// Issue's `worker:<name>` label picks a profile, else the configured default. A repository without the
// setting answers `unset` before any label is fetched, so it keeps today's launch unchanged.
const { EFFORT_SCHEMA, PROFILE_SCHEMA, WORKER } = agent_profile_schema
const CONFIG_KEY = 'josh.worker'
const LABEL_PREFIX = 'worker:'

interface WorkerProfile {
	name: string
	when: string
	agent: AgentProfile
}

interface WorkerSettings {
	default: string
	escalate: boolean
	profiles: ReadonlyArray<WorkerProfile>
}

interface Unset {
	kind: 'unset'
}

type SettingsResult = Rejected | Unset | { kind: 'settings'; settings: WorkerSettings }
type WorkerResult =
	Rejected | Unset | { kind: 'worker'; worker: WorkerProfile; settings: WorkerSettings }
type ProfileCheck = Rejected | { kind: 'profile'; worker: WorkerProfile }

const UNSET: Unset = { kind: 'unset' }

function rejected(note: string): Rejected {
	return { kind: 'rejected', note: `${CONFIG_KEY} ${note}` }
}

// A schema rejection: its issue path already starts at `josh.worker`, so it is not prefixed again.
function schema_rejection(error: z.ZodError): Rejected {
	const [issue] = error.issues
	if (issue === undefined) return rejected('is invalid')

	return { kind: 'rejected', note: `${issue.path.join('.')}: ${issue.message}` }
}

function checked_profile(definition: WorkerProfileDefinition): ProfileCheck {
	const { name, model, effort, when } = definition
	const parsed = PROFILE_SCHEMA.safeParse({ role: WORKER, model, effort })

	if (!parsed.success) {
		return rejected(
			`profile ${name}: effort ${effort} is not one of ${EFFORT_SCHEMA.options.join(', ')}`,
		)
	}

	const checked = agent_role_profile.validate(parsed.data, `${CONFIG_KEY} profile ${name} model`)

	return checked.kind === 'rejected'
		? checked
		: { kind: 'profile', worker: { name, when, agent: checked.profile } }
}

function checked_settings(config: WorkerConfig): SettingsResult {
	const profiles: Array<WorkerProfile> = []

	for (const definition of config.profiles) {
		const checked = checked_profile(definition)
		if (checked.kind === 'rejected') return checked
		profiles.push(checked.worker)
	}

	return {
		kind: 'settings',
		settings: { default: config.default, escalate: config.escalate, profiles },
	}
}

// A manifest that cannot be read or parsed names no setting, so it reads as an empty object.
function manifest_value(directory: string): unknown {
	const text = file_reader.read_if_readable(package_manifest.manifest_path(directory))
	if (text === undefined) return {}

	return json_value.parse_or_undefined(text) ?? {}
}

// The repository's `josh.worker`: `unset` when the manifest names none (or cannot be read), a rejection
// with its reason when the setting breaks a rule, otherwise the checked profiles.
function read(directory: string): SettingsResult {
	const parsed = package_manifest.josh_schemas.worker.safeParse(manifest_value(directory))
	if (!parsed.success) return schema_rejection(parsed.error)

	const config = parsed.data.josh?.worker

	return config === undefined ? UNSET : checked_settings(config)
}

function profile_named(settings: WorkerSettings, name: string): WorkerProfile | undefined {
	return settings.profiles.find((profile) => profile.name === name)
}

function for_labels(settings: WorkerSettings, labels: ReadonlyArray<string>): WorkerResult {
	const names = labels
		.filter((label) => label.startsWith(LABEL_PREFIX))
		.map((label) => label.slice(LABEL_PREFIX.length))

	if (names.length > 1) {
		return rejected(`allows one ${LABEL_PREFIX}<name> label, got ${names.join(', ')}`)
	}

	const [name = settings.default] = names
	const worker = profile_named(settings, name)
	if (worker === undefined) return rejected(`has no profile for the label ${LABEL_PREFIX}${name}`)

	return { kind: 'worker', worker, settings }
}

// The profile an Issue's worker runs on. `fetch_labels` is called only once a setting exists, so a
// repository without one never asks GitHub for the Issue's labels. A label read that fails answers
// `undefined` and is refused: falling back to the default could run a `worker:<name>` Issue on the
// wrong model.
async function resolve(
	directory: string,
	fetch_labels: () => Promise<ReadonlyArray<string> | undefined>,
): Promise<WorkerResult> {
	const result = read(directory)
	if (result.kind !== 'settings') return result

	const labels = await fetch_labels()
	if (labels === undefined) return rejected('could not read the Issue labels')

	return for_labels(result.settings, labels)
}

// The profile one step above `worker` in the escalation order, or `undefined` at the top.
function next(settings: WorkerSettings, worker: WorkerProfile): WorkerProfile | undefined {
	const index = settings.profiles.findIndex((profile) => profile.name === worker.name)
	if (index === -1) return undefined

	return settings.profiles[index + 1]
}

const agent_worker_profile = { LABEL_PREFIX, for_labels, next, read, resolve }

export type { SettingsResult, WorkerProfile, WorkerResult, WorkerSettings }
export { agent_worker_profile }
