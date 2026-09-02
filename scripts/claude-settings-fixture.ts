import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The distributed settings file, read by both suites that assert against it. joshuafolkken/kit#1062
// grew the deny half past the file limit, so the permission suite and the hook suite became two
// files; the loader and its types live here rather than being written twice or reached for across a
// test boundary.
const SETTINGS_PATH = fileURLToPath(new URL('../.claude/settings.json', import.meta.url))

interface PermissionsBlock {
	defaultMode: string
	allow: ReadonlyArray<string>
	deny: ReadonlyArray<string>
}

interface HookHandler {
	type: string
	command: string
	timeout?: number
}

interface HookMatcher {
	matcher: string
	hooks: ReadonlyArray<HookHandler>
}

// The hook events are named as declared fields rather than through an index signature so a
// misspelled event here fails to compile instead of reading as an absent hook.
interface HooksBlock {
	// eslint-disable-next-line @typescript-eslint/naming-convention -- Claude Code hook event name
	PostToolUse?: ReadonlyArray<HookMatcher>
}

// The harness environment the settings file declares. Values are strings because Claude Code reads
// them as environment variables; `bash-output-cap.test.ts` is what turns a string back into the
// number the cap is compared against, so a value that is not a number fails there rather than
// silently reading as an absent cap.
interface EnvironmentBlock {
	// eslint-disable-next-line @typescript-eslint/naming-convention -- Claude Code environment variable name
	BASH_MAX_OUTPUT_LENGTH?: string
}

interface SettingsShape {
	permissions: PermissionsBlock
	env: EnvironmentBlock
	hooks: HooksBlock
}

function read_settings_text(): string {
	return readFileSync(SETTINGS_PATH, 'utf8')
}

function load_settings(): SettingsShape {
	return JSON.parse(read_settings_text()) as SettingsShape
}

const claude_settings_fixture = { load_settings, read_settings_text }

export { claude_settings_fixture, SETTINGS_PATH }
export type {
	EnvironmentBlock,
	HookHandler,
	HookMatcher,
	HooksBlock,
	PermissionsBlock,
	SettingsShape,
}
