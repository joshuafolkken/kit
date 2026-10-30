import { agent_provider } from '#scripts/agent/agent-provider'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { own_session } from '#scripts/cost-runtime/own-session'
import type { RunCut } from './run-cut'

// A session id survives separate CLI calls; the CLI's own pid does not.
function session(): string | undefined {
	const selected = agent_provider.resolve_provider()
	if (selected.kind !== 'provider') return undefined
	const id = agent_provider.trimmed(
		selected.provider === agent_provider.OPENAI_PROVIDER
			? process.env[agent_provider.CODEX_SESSION_KEY]
			: own_session.session_id_of(process.env),
	)

	return id === undefined ? undefined : `${selected.provider}:${id}`
}

function is_own_adoption(cut: RunCut): boolean {
	return (
		cut.is_handed_off === false &&
		cut.adopted_session !== undefined &&
		cut.adopted_session === session()
	)
}

function matches_run(previous: RunCut, next: RunCut): boolean {
	return (
		previous.issue === next.issue &&
		previous.branch === next.branch &&
		previous.invocation === next.invocation
	)
}

function can_replace(previous: RunCut, next: RunCut): boolean {
	return (
		previous.phase === agent_role_profile.PRE_GATE_PHASE &&
		next.phase === agent_role_profile.IMPLEMENTATION_PHASE &&
		is_own_adoption(previous) &&
		matches_run(previous, next)
	)
}

const run_cut_adoption = { can_replace, session }

export { run_cut_adoption }
