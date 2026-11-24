import { realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { ESLint } from 'eslint'
import ts from 'typescript-eslint'
import { describe, expect, it, vi } from 'vitest'
import { create_base_config } from './base.js'

// joshuafolkken/kit#3599: the TypeScript resolver sat under `import/resolver`, a key
// eslint-plugin-import-x never reads, so every import fell back to the plugin's default node
// resolver. A rule that cannot follow an import reports nothing about it.
//
// Asserted by linting a real import on disk through `create_base_config`, because the claim is that
// the import is *followed*: a settings-shape assertion passes just as well for a resolver the
// plugin never loads, which is exactly the defect. The cycles the resolver once fed `import/no-cycle`
// are read by `josh import-cycles` over the TypeScript import graph since joshuafolkken/kit#8887
// (`scripts/lint/import-cycles.test.ts`).
const LINT_PROBE_TIMEOUT_MS = 60_000

vi.setConfig({ testTimeout: LINT_PROBE_TIMEOUT_MS })

const NO_CYCLE_RULE = 'import/no-cycle'
const NAMED_RULE = 'import-x/named'
const RULE_SEVERITY_OFF = 0
const RULE_SEVERITY_WARN = 1
const RULE_SEVERITY_ERROR = 2
// Each with the severity the plugin's recommended preset gives it — what hand-authored JavaScript
// keeps.
const EXPORT_READING_RULES: Array<[string, number]> = [
	[NAMED_RULE, RULE_SEVERITY_ERROR],
	['import-x/namespace', RULE_SEVERITY_ERROR],
	['import-x/default', RULE_SEVERITY_ERROR],
	['import-x/export', RULE_SEVERITY_ERROR],
	['import-x/no-named-as-default', RULE_SEVERITY_WARN],
	['import-x/no-named-as-default-member', RULE_SEVERITY_WARN],
]
const JAVASCRIPT_ENTRY = 'j.js'
const JAVASCRIPT_ENTRY_SOURCE = "import { missing } from './k.js'\n\nexport const j = missing\n"
const TYPESCRIPT_ENTRY = 'a.ts'

const FIXTURE_FILES: Record<string, string> = {
	'package.json': JSON.stringify({ type: 'module' }),
	'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext' } }),
	[TYPESCRIPT_ENTRY]: 'export const a = 1\n',
	[JAVASCRIPT_ENTRY]: JAVASCRIPT_ENTRY_SOURCE,
	'k.js': 'export const k = 1\n',
}

function write_fixture(root: string): void {
	for (const [name, source] of Object.entries(FIXTURE_FILES)) {
		writeFileSync(path.join(root, name), source)
	}
}

// The probes are syntactic — the import rules read the import graph, not types — so the typed parser
// is switched off rather than handed a tsconfig project to build for three-line files.
function create_linter(root: string): ESLint {
	return new ESLint({
		cwd: root,
		overrideConfigFile: true,
		overrideConfig: [
			...create_base_config({
				gitignore_path: new URL('../.gitignore', import.meta.url),
				tsconfig_root_dir: root,
			}),
			ts.configs.disableTypeChecked,
		],
	})
}

// `realpathSync`: macOS hands back `/var/…`, a symlink to `/private/var/…`, and the resolver
// answers with the real path — the two have to agree for a cycle to close.
const make_directory = temporary_directory('suite')
const created_root = make_directory('kit-import-resolver-')
const root = realpathSync(created_root)

// Written before the linter exists: the resolver reads the fixture's tsconfig when it is created.
write_fixture(root)

const linter = create_linter(root)

async function rule_messages(rule: string, entry: string, source: string): Promise<Array<string>> {
	const [result] = await linter.lintText(source, { filePath: path.join(root, entry) })
	const messages = result?.messages ?? []

	expect(messages.filter((message) => message.fatal)).toEqual([])

	return messages.filter((message) => message.ruleId === rule).map((message) => message.message)
}

async function rule_config(entry: string): Promise<unknown> {
	const config: unknown = await linter.calculateConfigForFile(path.join(root, entry))

	return config
}

describe('create_base_config — the import resolver (issue #3599)', () => {
	// joshuafolkken/kit#8887: walked again from every linted file, the rule was a fifth of the lint.
	it('leaves import cycles to josh import-cycles', async () => {
		const config = await rule_config(TYPESCRIPT_ENTRY)

		expect(config).not.toHaveProperty(['rules', NO_CYCLE_RULE])
	})

	// The compiler does not check a hand-authored module, so the lint is the only thing between a
	// misspelled import there and a green gate.
	it('reports a named import a hand-authored .js module does not export', async () => {
		await expect(
			rule_messages(NAMED_RULE, JAVASCRIPT_ENTRY, JAVASCRIPT_ENTRY_SOURCE),
		).resolves.toHaveLength(1)
	})
})

// These read the exports of the imported file, so a per-file content cache keeps a stale
// "no problem" after that file changes. They are off where the TypeScript compiler runs the same
// checks, and only there.
describe('create_base_config — the export-reading import rules (issue #3599)', () => {
	it.each(EXPORT_READING_RULES)('switches %s off for a TypeScript file', async (rule) => {
		const config = await rule_config(TYPESCRIPT_ENTRY)

		expect(config).toHaveProperty(['rules', rule, 0], RULE_SEVERITY_OFF)
	})

	it.each(EXPORT_READING_RULES)('keeps %s for hand-authored JavaScript', async (rule, severity) => {
		const config = await rule_config(JAVASCRIPT_ENTRY)

		expect(config).toHaveProperty(['rules', rule, 0], severity)
	})
})
