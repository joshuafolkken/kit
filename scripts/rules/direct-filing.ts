import { bash_triggers } from './bash-triggers'

// The `direct-filing` row of `delivered-rules.ts`. Filing an Issue owes a
// duplicate scout, a body lint, the classification / depth / `route:` labels, a `## Origin` on a
// cross-repository filing and an `epic:bundle` afterwards — steps spread over as many documents, each
// with its own guard, so a run can take some and skip the rest. `josh issue:file` runs them all in one
// command, so a hand-built `gh api …/issues` / `gh issue create` filing is refused outright and
// pointed there.

const DIRECT_FILING_REASON =
	'⛔ direct filing: an Issue is filed with `pnpm josh issue:file "<title>" --body-file <path> ' +
	'--depth <0|1|2> [--route <route>] [--label <name>] [--repo <owner/repo>]`, never with `gh api …/issues` ' +
	'or `gh issue create`. The command runs every filing step in order — the duplicate scout, the body ' +
	'lint and its classification labels, the depth and `route:` labels, the `## Origin` check when filing ' +
	'into another repository, and `epic:bundle` after the create — so none of them is a step to remember. ' +
	'When the scout prints candidates it holds the filing: read each, then reissue with `--distinct <N,…>` ' +
	'for the ones that are separate deliverables. Reference: `docs/josh-commands-backlog.md` → "`josh issue:file`". ' +
	'**This rule fires on every occurrence, not once per run.**'

function is_any_filing(command: string): boolean {
	return bash_triggers.is_direct_filing(command) || bash_triggers.is_issue_filing(command)
}

// `decide` returns true so it refuses every occurrence. Keeping the rule is filing through the command;
// the trigger is the violation itself, so the occasion it governs is a filing in either spelling
// (`reaches`, the `run-tail` shape).
const ROW = {
	id: 'direct-filing',
	is_trigger: bash_triggers.on_bash_command(bash_triggers.is_direct_filing),
	reason: DIRECT_FILING_REASON,
	decide: (): boolean => true,
	keeps: bash_triggers.on_bash_command(bash_triggers.is_issue_filing),
	reaches: bash_triggers.on_bash_command(is_any_filing),
}

const direct_filing = { DIRECT_FILING_REASON, ROW }

export { direct_filing }
