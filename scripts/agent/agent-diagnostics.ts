import { spawnSync } from 'node:child_process'
import semver from 'semver'
import type { AgentProfile, AgentProvider } from './agent-role-profile'

const DIAGNOSTIC_TIMEOUT_MS = 10_000
const AUTH_ARGS: ReadonlyArray<string> = ['login', 'status']
const VERSION_ARGS: ReadonlyArray<string> = ['--version']

interface ProcessOutcome {
	status: number | undefined
	stdout?: string | undefined
	stderr?: string | undefined
	error?: Error | undefined
}

interface DiagnosticPorts {
	run: (command: string, args: ReadonlyArray<string>) => ProcessOutcome
}

type DiagnosticResult = { kind: 'ready' } | { kind: 'rejected'; note: string }

interface ProviderCli {
	command: string
	name: string
	update: string
}

const PROVIDER_CLI_TABLE: Readonly<Record<AgentProvider, ProviderCli>> = {
	anthropic: { command: 'claude', name: 'Claude Code', update: 'claude update' },
	openai: { command: 'codex', name: 'Codex CLI', update: 'npm install -g @openai/codex@latest' },
}

// **The oldest CLI that can run each pinned model** (joshuafolkken/kit#2415). An older CLI either
// rejects the id after the lane has started or quietly runs something else, so the launch is refused
// here instead. A model with no entry — a lane's recorded pre-migration model, or a person's override —
// is not version-checked, so an existing lane resumes on the CLI it already ran on.
const MODEL_CLI_FLOORS: ReadonlyMap<string, string> = new Map([
	['claude-opus-5-5', '2.1.280'],
	['gpt-6-sol', '0.155.0'],
])

const default_ports: DiagnosticPorts = {
	run(command, args) {
		const outcome = spawnSync(command, [...args], {
			encoding: 'utf8',
			timeout: DIAGNOSTIC_TIMEOUT_MS,
		})

		return { ...outcome, status: outcome.status ?? undefined }
	},
}

function nonempty(value: string | undefined): string | undefined {
	const trimmed = value?.trim()

	return trimmed === '' ? undefined : trimmed
}

function note_of(outcome: ProcessOutcome): string {
	if (outcome.error !== undefined) return outcome.error.message

	return nonempty(outcome.stderr) ?? nonempty(outcome.stdout) ?? 'unknown error'
}

function rejected(note: string): DiagnosticResult {
	return { kind: 'rejected', note }
}

// A prerelease stays a prerelease, so `0.155.0-alpha.1` does not pass a `0.155.0` floor.
function version_of(outcome: ProcessOutcome): string | undefined {
	if (outcome.error !== undefined || outcome.status !== 0) return undefined

	return semver.coerce(outcome.stdout ?? '', { includePrerelease: true })?.version
}

function version_note(cli: ProviderCli, model: string, floor: string, found: string): string {
	return `${cli.name} ${found} cannot run ${model}; it needs ${floor} or later — run \`${cli.update}\`, then retry`
}

function check_version(model: string, cli: ProviderCli, ports: DiagnosticPorts): DiagnosticResult {
	const floor = MODEL_CLI_FLOORS.get(model)
	if (floor === undefined) return { kind: 'ready' }
	const outcome = ports.run(cli.command, VERSION_ARGS)
	const found = version_of(outcome)

	if (found === undefined) {
		return rejected(`${cli.name} version could not be read: ${note_of(outcome)}`)
	}

	return semver.gte(found, floor)
		? { kind: 'ready' }
		: rejected(version_note(cli, model, floor, found))
}

function check_auth(cli: ProviderCli, ports: DiagnosticPorts): DiagnosticResult {
	const outcome = ports.run(cli.command, AUTH_ARGS)

	if (outcome.error !== undefined) {
		return rejected(`${cli.name} is unavailable: ${note_of(outcome)}`)
	}

	return outcome.status === 0
		? { kind: 'ready' }
		: rejected(`Codex authentication is unavailable: ${note_of(outcome)}`)
}

// The model is checked as it was resolved: a refusal names the update and stops, and nothing here
// retries or swaps in another model (joshuafolkken/kit#2415).
function check(profile: AgentProfile, ports: DiagnosticPorts = default_ports): DiagnosticResult {
	const cli = PROVIDER_CLI_TABLE[profile.provider]
	const version = check_version(profile.model, cli, ports)
	if (version.kind === 'rejected' || profile.provider === 'anthropic') return version

	return check_auth(cli, ports)
}

const agent_diagnostics = { AUTH_ARGS, MODEL_CLI_FLOORS, PROVIDER_CLI_TABLE, VERSION_ARGS, check }

export type { DiagnosticPorts, DiagnosticResult, ProcessOutcome }
export { agent_diagnostics }
