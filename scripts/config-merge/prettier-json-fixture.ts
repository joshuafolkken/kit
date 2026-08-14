import prettier from 'prettier'

// Several suites assert the same contract from different angles: a JSON config kit writes into a
// consumer must come back unchanged from that consumer's own `prettier --check`, or the project
// fails formatting on a file nobody touched (#660). They all need prettier configured the same way,
// so the options live here rather than in three drifting copies — a stale copy would keep passing
// while silently checking against a layout the preset no longer produces.
//
// The values mirror the kit prettier preset's JSON-relevant options rather than importing it:
// `prettier/index.js` sits outside `scripts/`, so reaching it would need the banned
// parent-directory specifier, and its `plugins` entries have no bearing on the json parser.
//
// Scope: `parser: 'json'` only. Prettier infers `json-stringify` from the FILENAME `package.json`,
// and that printer breaks every array one entry per line regardless of width — so this helper does
// not describe how a `package.json` must be formatted, and asserting it against one would report a
// green that prettier disagrees with. Use it for tsconfig-shaped files.
const PRETTIER_JSON_OPTIONS = { parser: 'json', printWidth: 100, useTabs: true } as const

// Run real prettier over `content`. Call sites assert `toBe(content)` — a fixed point means the file
// is already formatted. Asserting that rather than a specific layout keeps the guard honest as
// arrays grow past printWidth and prettier switches from inline to one entry per line; returning the
// formatted text rather than a boolean keeps the failure a character diff instead of `false`.
async function prettier_format_json(content: string): Promise<string> {
	return await prettier.format(content, PRETTIER_JSON_OPTIONS)
}

export { prettier_format_json }
