import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ESLint } from 'eslint'
import ts from 'typescript-eslint'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { create_base_config } from './base.js'

// joshuafolkken/kit#3599: the TypeScript resolver sat under `import/resolver`, a key
// eslint-plugin-import-x never reads, so every import fell back to the plugin's default node
// resolver, which does not follow an extensionless `.ts` specifier. And `import-x/extensions` was
// never set, so a `.ts` file that did resolve — through a package `imports` alias, say — was still
// skipped as not being a module the plugin reads. A rule that cannot follow an import reports
// nothing about it: `import/no-cycle` was green over cycles it never saw.
//
// The first two cycle cases below pin one half each — the relative one goes red without the
// resolver, the alias one without the extension list. The third pins where the resolver reads its
// tsconfig: this suite runs with the repository as `process.cwd()`, whose tsconfig declares no
// `$lib`, so the `paths` cycle is only followed when the fixture's own tsconfig is the one read.
//
// Asserted by linting a real cycle on disk through `create_base_config`, because the claim is that
// the import is *followed*: a settings-shape assertion passes just as well for a resolver the
// plugin never loads, which is exactly the defect.
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
const RELATIVE_ENTRY = 'a.ts'
const ALIAS_ENTRY = 'lib/c.ts'
const ACYCLIC_ENTRY = 'lib/e.ts'
const PATHS_ENTRY = 'lib/g.ts'
const RELATIVE_ENTRY_SOURCE = "import { b } from './b'\n\nexport const a = b\n"
const ALIAS_ENTRY_SOURCE = "import { d } from '#lib/d'\n\nexport const c = d\n"
const ACYCLIC_ENTRY_SOURCE = "import { f } from '#lib/f'\n\nexport const e = f\n"
const PATHS_ENTRY_SOURCE = "import { h } from '$lib/h'\n\nexport const g = h\n"

const FIXTURE_FILES: Record<string, string> = {
	'package.json': JSON.stringify({ type: 'module', imports: { '#lib/*': './lib/*.ts' } }),
	'tsconfig.json': JSON.stringify({
		compilerOptions: { module: 'nodenext', paths: { '$lib/*': ['./lib/*'] } },
	}),
	[RELATIVE_ENTRY]: RELATIVE_ENTRY_SOURCE,
	'b.ts': "import { a } from './a'\n\nexport const b = a\n",
	[ALIAS_ENTRY]: ALIAS_ENTRY_SOURCE,
	'lib/d.ts': "import { c } from '#lib/c'\n\nexport const d = c\n",
	[ACYCLIC_ENTRY]: ACYCLIC_ENTRY_SOURCE,
	'lib/f.ts': 'export const f = 1\n',
	[PATHS_ENTRY]: PATHS_ENTRY_SOURCE,
	'lib/h.ts': "import { g } from '$lib/g'\n\nexport const h = g\n",
	[JAVASCRIPT_ENTRY]: JAVASCRIPT_ENTRY_SOURCE,
	'k.js': 'export const k = 1\n',
}

function write_fixture(root: string): void {
	mkdirSync(path.join(root, 'lib'))

	for (const [name, source] of Object.entries(FIXTURE_FILES)) {
		writeFileSync(path.join(root, name), source)
	}
}

// The probes are syntactic — `no-cycle` reads the import graph, not types — so the typed parser is
// switched off rather than handed a tsconfig project to build for three-line files.
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
const created_root = mkdtempSync(path.join(tmpdir(), 'kit-import-resolver-'))
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

async function cycle_messages(entry: string, source: string): Promise<Array<string>> {
	return await rule_messages(NO_CYCLE_RULE, entry, source)
}

async function rule_config(entry: string): Promise<unknown> {
	const config: unknown = await linter.calculateConfigForFile(path.join(root, entry))

	return config
}

afterAll(() => {
	rmSync(root, { recursive: true, force: true })
})

describe('create_base_config — the import resolver follows TypeScript (issue #3599)', () => {
	it('reports a cycle through an extensionless .ts import', async () => {
		await expect(cycle_messages(RELATIVE_ENTRY, RELATIVE_ENTRY_SOURCE)).resolves.toHaveLength(1)
	})

	it('reports a cycle through a package imports alias', async () => {
		await expect(cycle_messages(ALIAS_ENTRY, ALIAS_ENTRY_SOURCE)).resolves.toHaveLength(1)
	})

	it('reports a cycle through a tsconfig paths alias of tsconfig_root_dir', async () => {
		await expect(cycle_messages(PATHS_ENTRY, PATHS_ENTRY_SOURCE)).resolves.toHaveLength(1)
	})

	it('stays quiet on an alias import that closes no cycle', async () => {
		await expect(cycle_messages(ACYCLIC_ENTRY, ACYCLIC_ENTRY_SOURCE)).resolves.toEqual([])
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
		const config = await rule_config(RELATIVE_ENTRY)

		expect(config).toHaveProperty(['rules', rule, 0], RULE_SEVERITY_OFF)
	})

	it.each(EXPORT_READING_RULES)('keeps %s for hand-authored JavaScript', async (rule, severity) => {
		const config = await rule_config(JAVASCRIPT_ENTRY)

		expect(config).toHaveProperty(['rules', rule, 0], severity)
	})
})
