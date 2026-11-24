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
import { agent_worker_route } from './agent-worker-route'

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
	route: boolean
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

	const settings = {
		default: config.default,
		escalate: config.escalate,
		route: config.route,
		profiles,
	}

	return { kind: 'settings', settings }
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

function label_names(labels: ReadonlyArray<string>): ReadonlyArray<string> {
	return labels
		.filter((label) => label.startsWith(LABEL_PREFIX))
		.map((label) => label.slice(LABEL_PREFIX.length))
}

function for_labels(settings: WorkerSettings, labels: ReadonlyArray<string>): WorkerResult {
	const names = label_names(labels)

	if (names.length > 1) {
		return rejected(`allows one ${LABEL_PREFIX}<name> label, got ${names.join(', ')}`)
	}

	const [name = settings.default] = names
	const worker = profile_named(settings, name)
	if (worker === undefined) return rejected(`has no profile for the label ${LABEL_PREFIX}${name}`)

	return { kind: 'worker', worker, settings }
}

// joshuafolkken/kit#8760: with `route` on, an Issue no `worker:` label names runs on the weakest
// profile when its body declares light work (`agent-worker-route.ts`), else on the default. A body
// that cannot be read keeps the default. `route: false` is the one-step revert to the default for all.
function routed(settings: WorkerSettings, body: string | undefined): WorkerResult {
	const [weakest] = settings.profiles
	const is_light = body !== undefined && agent_worker_route.route(body).is_light

	if (!is_light || weakest === undefined) return for_labels(settings, [])

	return { kind: 'worker', worker: weakest, settings }
}

async function for_issue(
	settings: WorkerSettings,
	labels: ReadonlyArray<string>,
	fetch_body: (() => Promise<string | undefined>) | undefined,
): Promise<WorkerResult> {
	const is_routed = settings.route && label_names(labels).length === 0

	return is_routed ? routed(settings, await fetch_body?.()) : for_labels(settings, labels)
}

// The profile an Issue's worker runs on. `fetch_labels` is called only once a setting exists, so a
// repository without one never asks GitHub for the Issue's labels. A label read that fails answers
// `undefined` and is refused: falling back to the default could run a `worker:<name>` Issue on the
// wrong model. `fetch_body` is called only when `route` decides, and a person's label wins over it;
// a caller without one (a cut relaunch's cap, `agent-argv.ts`) caps at the default, never below the
// stored profile the dispatch already routed.
async function resolve(
	directory: string,
	fetch_labels: () => Promise<ReadonlyArray<string> | undefined>,
	fetch_body?: () => Promise<string | undefined>,
): Promise<WorkerResult> {
	const result = read(directory)
	if (result.kind !== 'settings') return result

	const labels = await fetch_labels()
	if (labels === undefined) return rejected('could not read the Issue labels')

	return await for_issue(result.settings, labels, fetch_body)
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
