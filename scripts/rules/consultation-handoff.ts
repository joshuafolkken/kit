import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import type { GuardRun } from '#scripts/josh/hook-decision'
import { bash_triggers } from './bash-triggers'
import type { DeliveredRule } from './delivered-rules'
import { main_model_reader } from './main-model'
import { shell_segments } from './shell-segments'

// A consultation main line hands a workflow keyword to a child session (joshuafolkken/kit#5616).
//
// **The entry is the boundary.** A main line on the consultation model (Fable, Codex Astra) files and
// operates, but a run it entered itself would implement at that model's rate, so the claim of the tree
// — `run:entry`, `run:hold` — is refused and `run:handoff` starts the run on the role profile's model.
// Filing and operating (`issue:file`, `issue:plan`, `epic`) are never refused.
//
// **It fires on every occurrence**: the remedy is one command, so a refusal never wedges the run. The
// handed child runs on the role profile's model, so it enters through `run:entry` untouched.

const HANDOFF_DOC = '`docs/josh-commands-run.md` → "josh run:handoff"'

const REASON =
	'⛔ consultation handoff: a consultation-model main line does not enter a run itself. Run ' +
	'`pnpm josh run:handoff <keyword> … --brief-file <brief>` instead of `run:entry` / `run:hold`; ' +
	`filing and operating (\`issue:file\`, \`issue:plan\`, \`epic\`) stay here. Fires on every occurrence (${HANDOFF_DOC}).`

function josh_call_of(names: ReadonlyArray<string>): (command: string) => boolean {
	const name_set: ReadonlySet<string> = new Set(names)

	return function is_josh_call(command: string): boolean {
		return shell_segments
			.segments_of(command)
			.some((segment) => shell_segments.is_josh_command(segment, name_set))
	}
}

const is_entry_call = josh_call_of(['run:entry', 'run:hold'])
const is_handoff_call = josh_call_of(['run:handoff'])

// An unnamed model stays silent rather than guessing. The `session-lang` prompt hook asks it too.
function is_consultation_main(tail: string, payload_model: string | undefined): boolean {
	const model = main_model_reader.main_model(tail, payload_model)

	return model !== undefined && agent_role_profile.consultation_provider(model) !== undefined
}

// A delegated unit enters no run.
function is_not_consultation_main(tail: string, _call: unknown, run: GuardRun): boolean {
	return run.is_unit === true || !is_consultation_main(tail, run.model)
}

const ROW: DeliveredRule = {
	id: 'consultation-handoff',
	is_trigger: bash_triggers.on_bash_command(is_entry_call),
	reason: REASON,
	already_satisfied: is_not_consultation_main,
	decide: (): boolean => true,
	keeps: bash_triggers.on_bash_command(is_handoff_call),
	about: {
		title: 'Consultation main line hands a run to run:handoff',
		topic: HANDOFF_DOC,
		fires: '`pnpm josh run:entry` / `run:hold` on Fable or Codex Astra. Every occurrence',
		quiet:
			'a main line on any other model, an unnamed model, a delegated unit, or filing and operating (`issue:file`, `issue:plan`, `epic`)',
	},
}

const consultation_handoff = {
	HANDOFF_DOC,
	ROW,
	is_consultation_main,
	is_entry_call,
	is_handoff_call,
}

export { consultation_handoff }
