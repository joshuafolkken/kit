import { bash_triggers } from './bash-triggers'

// The `direct-filing` row of `delivered-rules.ts`. Filing an Issue owes a
// duplicate scout, a body lint, the classification / depth / `route:` labels, a `## Origin` on a
// cross-repository filing and an `epic:bundle` afterwards — steps spread over as many documents, each
// with its own guard, so a run can take some and skip the rest. `josh issue:file` runs them all in one
// command, so a hand-built `gh api …/issues` / `gh issue create` filing is refused outright and
// pointed there.

const DIRECT_FILING_REASON =
	'⛔ direct filing: an Issue is filed with `pnpm josh issue:file "<title>" --body-file <path>`, ' +
	'never with `gh api …/issues` or `gh issue create` — it runs the scout, the lint, ' +
	'the labels and `epic:bundle` itself. It fires on every occurrence (`docs/josh-commands-backlog.md` ' +
	'→ "`josh issue:file`").'

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
	about: {
		title: 'Direct filing',
		topic: '`docs/josh-commands-backlog.md` → `josh issue:file`',
		fires:
			'a `Bash` that creates an Issue outside `josh issue:file` (`gh issue create`, or a POST with `title` to `…/issues`); the refusal hands over the `pnpm josh issue:file` form. Every occurrence',
		quiet:
			'filing through `pnpm josh issue:file` — the duplicate scan, the body check and `epic:bundle` all run',
	},
}

const direct_filing = { DIRECT_FILING_REASON, ROW }

export { direct_filing }
