import { spawnSync } from 'node:child_process'
import type { AgentProfile } from './agent-role-profile'

const DIAGNOSTIC_TIMEOUT_MS = 10_000
const AUTH_ARGS: ReadonlyArray<string> = ['login', 'status']

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

function check(profile: AgentProfile, ports: DiagnosticPorts = default_ports): DiagnosticResult {
	if (profile.provider === 'anthropic') return { kind: 'ready' }
	const outcome = ports.run('codex', AUTH_ARGS)

	if (outcome.error !== undefined) {
		return { kind: 'rejected', note: `Codex CLI is unavailable: ${note_of(outcome)}` }
	}

	return outcome.status === 0
		? { kind: 'ready' }
		: { kind: 'rejected', note: `Codex authentication is unavailable: ${note_of(outcome)}` }
}

const agent_diagnostics = { AUTH_ARGS, check }

export type { DiagnosticPorts, DiagnosticResult, ProcessOutcome }
export { agent_diagnostics }
