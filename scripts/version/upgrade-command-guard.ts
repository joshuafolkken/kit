// A package-name → currently-installed-version lookup, used to decide whether an upgrade command can
// still change anything. `undefined` means the package is not installed at the scope being checked.
type InstalledVersions = ReadonlyMap<string, string | undefined>

// One `<package>@<version>` specifier found inside a shell command.
interface VersionPin {
	name: string
	version: string
}

// One whole `<package>@<version>` shell token, e.g. `@joshuafolkken/app-kit@2.0.0` (scoped) or
// `tsx@4.20.0` (unscoped). Applied to one token at a time and anchored at both ends, so the match is
// linear — scanning the full command string would instead re-backtrack from every start position.
// The version must begin with a digit so a dist-tag (`pkg@latest`) never matches: a dist-tag can
// always resolve to something newer, so a command carrying one is never provably a no-op.
const VERSION_PIN_PATTERN = /^(?<name>@[\w.-]+\/[\w.-]+|[\w.-]+)@(?<version>\d[\w.+-]*)$/u
const WHITESPACE_PATTERN = /\s+/u

// One shell token read as a version pin, or undefined when it is not one (a flag, a sub-command, a
// path, or a dist-tag specifier).
function parse_version_pin(token: string): VersionPin | undefined {
	const { name, version } = VERSION_PIN_PATTERN.exec(token)?.groups ?? {}
	if (name === undefined || version === undefined) return undefined

	return { name, version }
}

// Every exact version pin the command carries, in the order they appear.
function extract_version_pins(command: string): Array<VersionPin> {
	return command.split(WHITESPACE_PATTERN).flatMap((token) => parse_version_pin(token) ?? [])
}

// An upgrade command provably cannot change anything when it pins at least one exact version and
// every version it pins is already installed — running it would leave the staleness it was meant to
// fix untouched (see #697, where `vu` → `v` looped forever on such a command).
//
// Only commands the consumer declared as pin-only reach this check. A command that forces a fresh
// resolve (e.g. `pnpm remove -g <pkg> && pnpm add -g <pkg>@<latest>`) genuinely changes the resolved
// dependency graph even though its pin is already installed, so consumers leave
// `is_global_upgrade_command_pinned` unset for those and the hint is never suppressed.
function is_no_op_upgrade_command(command: string, installed: InstalledVersions): boolean {
	const pins = extract_version_pins(command)
	if (pins.length === 0) return false

	return pins.every((pin) => installed.get(pin.name) === pin.version)
}

export type { InstalledVersions }
export { is_no_op_upgrade_command }
