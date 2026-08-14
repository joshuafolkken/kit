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
// Scope: `parser: 'json'` — tsconfig.json and .vscode/*.json. Prettier infers `json-stringify` from
// the FILENAME `package.json`, and that printer breaks every array one entry per line regardless of
// width, so a package.json must be checked with the other helper below (kit#797).
const PRETTIER_JSON_OPTIONS = { parser: 'json', printWidth: 100, useTabs: true } as const

// `filepath` rather than an explicit parser: it routes through the same inference a consumer's own
// `prettier --check` performs on the real file, so the guard cannot pass by naming a parser the
// consumer would never have selected. That inference IS the defect in kit#797.
const PRETTIER_PACKAGE_JSON_OPTIONS = {
	filepath: 'package.json',
	printWidth: 100,
	useTabs: true,
} as const

// Run real prettier over `content`. Call sites assert `toBe(content)` — a fixed point means the file
// is already formatted. Asserting that rather than a specific layout keeps the guard honest as
// arrays grow past printWidth and prettier switches from inline to one entry per line; returning the
// formatted text rather than a boolean keeps the failure a character diff instead of `false`.
async function prettier_format_json(content: string): Promise<string> {
	return await prettier.format(content, PRETTIER_JSON_OPTIONS)
}

// The same fixed-point guard for `package.json`, where prettier's chosen printer differs.
async function prettier_format_package_json(content: string): Promise<string> {
	return await prettier.format(content, PRETTIER_PACKAGE_JSON_OPTIONS)
}

export { prettier_format_json, prettier_format_package_json }
