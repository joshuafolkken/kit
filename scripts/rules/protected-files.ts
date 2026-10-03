import path from 'node:path'
import { doctor_consumer } from '#scripts/doctor/doctor-consumer'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'

// The trigger and the delivered text behind the `protected-file` row of `delivered-rules.ts`
// (joshuafolkken/kit#2983): the two files a run's own file tools must not touch.
//
// - **`.env` is never read.** It carries the Telegram bot token, and a Read lands it in the transcript.
//   The scripts that need it load it in their own process, so refusing the tool costs them nothing.
// - **`.claude/settings.json` is never edited in a consumer repository.** It is the deny list and the
//   hooks that enforce every other rule, so a run that rewrites it can switch the guards off; `josh
//   sync` owns it there. Only a kit consumer's file is refused — decided per file from the repository
//   the settings file sits in, not the session's directory — so kit's own edits (it is the file's
//   source) and the user-level `~/.claude/settings.json`, which belongs to no repository, both pass.
//
// It fires on every occurrence, for the reason `git-force.ts` does.

const READ_TOOL = 'Read'
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write'])
const ENVIRONMENT_FILE = '.env'
const SETTINGS_FILE = path.join('.claude', 'settings.json')

function file_path_of(call: GuardedCall): string {
	if (!json_value.is_record(call.input)) return ''

	const value = call.input['file_path']

	return typeof value === 'string' ? value : ''
}

function is_environment_read(call: GuardedCall): boolean {
	return call.name === READ_TOOL && path.basename(file_path_of(call)) === ENVIRONMENT_FILE
}

// The repository the settings file belongs to is two levels above it (`<root>/.claude/settings.json`).
function is_consumer_settings_edit(
	call: GuardedCall,
	is_kit_consumer: (root: string) => boolean,
): boolean {
	if (!EDIT_TOOLS.has(call.name)) return false

	const file_path = path.resolve(file_path_of(call))

	if (!file_path.endsWith(`${path.sep}${SETTINGS_FILE}`)) return false

	return is_kit_consumer(path.dirname(path.dirname(file_path)))
}

function is_protected_file_call(
	call: GuardedCall,
	is_kit_consumer: (root: string) => boolean = doctor_consumer.is_kit_consumer,
): boolean {
	return is_environment_read(call) || is_consumer_settings_edit(call, is_kit_consumer)
}

const PROTECTED_FILE_REASON =
	'⛔ protected file: `.env` holds the Telegram bot token, so reading it puts a secret in the ' +
	'transcript — the scripts that need it load it in their own process. `.claude/settings.json` in a ' +
	'consumer repository is the deny list and the hooks every other rule rests on, so a run must not ' +
	'rewrite it; `josh sync` owns it, and a change belongs upstream in kit (`CLAUDE.md` → "Route ' +
	'distributed-doc / config changes upstream to kit"). Leave both files alone, or ask the user. ' +
	'**This rule fires on every occurrence, not once per run.**'

const ROW = {
	id: 'protected-file',
	is_trigger: is_protected_file_call,
	reason: PROTECTED_FILE_REASON,
	decide: (): boolean => true,
}

const protected_files = { ROW, is_protected_file_call }

export { protected_files }
