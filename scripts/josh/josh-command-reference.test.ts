import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'

// The argument synopsis is the half of the reference metadata nothing else can check. A description
// is prose nobody can contradict, but a synopsis is a claim about a parser, and the parser is in the
// repository — so the claim is checked against it (joshuafolkken/kit#2106). Without this the
// metadata is authored from each command's description, which is how `latest:update` came to
// advertise a per-package argument it discards and `overrides` a positional it throws on.
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FLAG_PATTERN = /--[a-z\d][a-z\d-]*/gu
const FLAG_VALUE_PATTERN = /--[a-z\d][a-z\d-]*(?:[ =]<[^>]*>)?/gu
// A positional opens with `<` or `[` followed by a letter. `[--fix]` opens with `[-`, and a flag's
// own value — `<1|2>` in `[--round <1|2>]` — opens with a digit, so neither is read as one.
const POSITIONAL_PATTERN = /[<[][a-z]/iu
// `process.argv[1]` is the module-main guard every script carries; any other index is a real read.
const ARGV_INDEX_PATTERN = /process\.argv\[(?!1\])/u
// What else a script that genuinely consumes positionals looks like.
const POSITIONAL_MARKERS: ReadonlyArray<string> = [
	'argv.slice',
	'argv.at(',
	'allowPositionals',
	'positionals',
	'process.argv.includes',
]

function source_of(script: string): string {
	return readFileSync(path.join(REPOSITORY_ROOT, script), 'utf8')
}

// A flag reaches its script under one of two spellings: written out in a usage string or compared
// literally, or as a bare `parseArgs` option key, which carries no dashes. Both count — checking
// only the dashed form reports every `parseArgs` command as undocumented.
function mentions_flag(source: string, flag: string): boolean {
	const key = flag.replace('--', '')

	return source.includes(flag) || source.includes(`'${key}'`) || source.includes(`${key}:`)
}

// A `<value>` that follows a flag belongs to that flag, so flags and their values come out together
// before what is left is read for positionals. Without this, `--task-type <type>` reads as one.
function positional_part(synopsis: string): string {
	return synopsis.replaceAll(FLAG_VALUE_PATTERN, '')
}

function script_commands(): ReadonlyArray<readonly [string, string, string]> {
	return Object.entries(COMMAND_MAP).flatMap(([name, entry]) =>
		entry.script === undefined ? [] : [[name, entry.script, entry.reference[0]] as const],
	)
}

function flags_of(synopsis: string): ReadonlyArray<string> {
	return synopsis.match(FLAG_PATTERN) ?? []
}

function does_read_positional(source: string): boolean {
	return (
		ARGV_INDEX_PATTERN.test(source) || POSITIONAL_MARKERS.some((marker) => source.includes(marker))
	)
}

describe('command reference — the synopsis matches the script it describes', () => {
	it('never advertises a flag the script does not mention', () => {
		for (const [name, script, synopsis] of script_commands()) {
			const source = source_of(script)

			for (const flag of flags_of(synopsis)) {
				const is_mentioned = mentions_flag(source, flag)

				expect(is_mentioned, `${name} advertises ${flag}, absent from ${script}`).toBe(true)
			}
		}
	})

	it('never advertises a positional the script never reads', () => {
		for (const [name, script, synopsis] of script_commands()) {
			if (!POSITIONAL_PATTERN.test(positional_part(synopsis))) continue

			const is_read = does_read_positional(source_of(script))

			expect(is_read, `${name} advertises a positional ${script} discards`).toBe(true)
		}
	})
})
