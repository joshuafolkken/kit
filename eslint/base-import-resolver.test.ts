import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ESLint } from 'eslint'
import ts from 'typescript-eslint'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
const RULE_SEVERITY_OFF = 0
const EXPORT_READING_RULES = [
	'import-x/named',
	'import-x/namespace',
	'import-x/default',
	'import-x/export',
]
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

describe('create_base_config — the import resolver follows TypeScript (issue #3599)', () => {
	let root: string
	let linter: ESLint

	async function cycle_messages(entry: string, source: string): Promise<Array<string>> {
		const [result] = await linter.lintText(source, { filePath: path.join(root, entry) })
		const messages = result?.messages ?? []

		expect(messages.filter((message) => message.fatal)).toEqual([])

		return messages
			.filter((message) => message.ruleId === NO_CYCLE_RULE)
			.map((message) => message.message)
	}

	beforeAll(() => {
		// `realpathSync`: macOS hands back `/var/…`, a symlink to `/private/var/…`, and the resolver
		// answers with the real path — the two have to agree for a cycle to close.
		const created = mkdtempSync(path.join(tmpdir(), 'kit-import-resolver-'))

		root = realpathSync(created)
		write_fixture(root)
		linter = create_linter(root)
	})

	afterAll(() => {
		rmSync(root, { recursive: true, force: true })
	})

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
})

// These read the exports of the imported file, so a per-file content cache keeps a stale
// "no problem" after that file changes. The TypeScript compiler runs the same checks.
describe('create_base_config — the export-reading import rules are off (issue #3599)', () => {
	it.each(EXPORT_READING_RULES)('switches %s off', async (rule) => {
		const root = tmpdir()
		const config: unknown = await create_linter(root).calculateConfigForFile(
			path.join(root, RELATIVE_ENTRY),
		)

		expect(config).toHaveProperty(['rules', rule, 0], RULE_SEVERITY_OFF)
	})
})
