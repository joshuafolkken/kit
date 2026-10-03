import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import { read_script } from './josh-script-reader'

// The argument synopsis is the half of the reference metadata nothing else can check. A description
// is prose nobody can contradict, but a synopsis is a claim about a parser, and the parser is in the
// repository — so the claim is checked against it (joshuafolkken/kit#2106). Without this the
// metadata is authored from each command's description, which is how `latest:update` came to
// advertise a per-package argument it discards and `overrides` a positional it throws on.
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

// The other direction of the check (joshuafolkken/kit#2992): a flag the script's own usage line
// lists must also be in the synopsis, or the reference silently drops it — as `cost` lost `--path`.
// `[options]` declares the abbreviation openly, and `--help` is every script's, so neither is a claim.
const ABBREVIATED_SYNOPSIS = '[options]'
const UNIVERSAL_FLAGS: ReadonlySet<string> = new Set(['--help'])
// A usage line ends at the quote that opened its string — `ship`'s holds `"<title> #<N>"`, so any
// other quote is part of the line — or at an escaped newline that starts the prose.
const ESCAPED_NEWLINE = String.raw`\n`
// The opening quote is the line's terminator, so a marker that does not open a string — one after
// `\n` mid-literal — has none to read; guessing one would split on a letter and drop flags silently.
const STRING_QUOTES: ReadonlySet<string> = new Set(["'", '"', '`'])
// One usage line can name a sibling command (`run:hold`'s names `run:release`); only this one's count.
const USAGE_ALTERNATIVE = ' | josh '

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

function opening_quote(source: string, start: number, name: string): string {
	const quote = source.charAt(start - 1)
	if (!STRING_QUOTES.has(quote)) throw new Error(`josh ${name}: usage line opens with ${quote}`)

	return quote
}

function usage_flags(source: string, name: string): ReadonlyArray<string> {
	const marker = `Usage: josh ${name} `
	const start = source.indexOf(marker)
	if (start === -1) return []

	const quote = opening_quote(source, start, name)
	const [literal = ''] = source.slice(start + marker.length).split(quote)
	const [line = ''] = literal.split(ESCAPED_NEWLINE)
	const [own = '', ...alternatives] = line.split(USAGE_ALTERNATIVE)
	const owned = alternatives.filter((alternative) => alternative.startsWith(`${name} `))

	return [own, ...owned].flatMap((part) => flags_of(part))
}

function does_read_positional(source: string): boolean {
	return (
		ARGV_INDEX_PATTERN.test(source) || POSITIONAL_MARKERS.some((marker) => source.includes(marker))
	)
}

describe('command reference — the synopsis matches the script it describes', () => {
	it('never advertises a flag the script does not mention', () => {
		for (const [name, script, synopsis] of script_commands()) {
			const source = read_script(script)

			for (const flag of flags_of(synopsis)) {
				const is_mentioned = mentions_flag(source, flag)

				expect(is_mentioned, `${name} advertises ${flag}, absent from ${script}`).toBe(true)
			}
		}
	})

	it('lists every flag the script usage line names', () => {
		const omissions = script_commands().flatMap(([name, script, synopsis]) => {
			if (synopsis.includes(ABBREVIATED_SYNOPSIS)) return []

			const listed = new Set(flags_of(synopsis))
			const flags = usage_flags(read_script(script), name)
			const missing = flags.filter((flag) => !listed.has(flag) && !UNIVERSAL_FLAGS.has(flag))

			return missing.length === 0 ? [] : [`${name} (${script}): ${missing.join(' ')}`]
		})

		expect(omissions, 'synopses that omit flags their usage line names').toEqual([])
	})

	it('never advertises a positional the script never reads', () => {
		for (const [name, script, synopsis] of script_commands()) {
			if (!POSITIONAL_PATTERN.test(positional_part(synopsis))) continue

			const is_read = does_read_positional(read_script(script))

			expect(is_read, `${name} advertises a positional ${script} discards`).toBe(true)
		}
	})
})

describe('command reference — reading a script usage line', () => {
	it('reads the usage flags of a cost-shaped usage line', () => {
		const source = "const USAGE = 'Usage: josh cost (--cut | --over <n>) [--path <dir>]'"

		expect(usage_flags(source, 'cost')).toEqual(['--cut', '--over', '--path'])
	})

	it('reads only its own alternatives from a shared usage line', () => {
		const source = String.raw`'Usage: josh run:hold [<n> [--fullrun]] | josh run:release [--force] | josh run:hold --x\nprose --y'`

		expect(usage_flags(source, 'run:hold')).toEqual(['--fullrun', '--x'])
	})

	it('reads past a double quote inside a single-quoted usage line', () => {
		const source = `'Usage: josh ship "<title> #<N>" [--detach] [--body-file <path>]'`

		expect(usage_flags(source, 'ship')).toEqual(['--detach', '--body-file'])
	})

	it('refuses a usage line that does not open a string', () => {
		const source = String.raw`'Unknown argument\nUsage: josh adopt [--dry-run] [--only <name>]'`

		expect(() => usage_flags(source, 'adopt')).toThrow('josh adopt: usage line opens with n')
	})
})
