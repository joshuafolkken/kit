import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import ts from 'typescript-eslint'
import { describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3294: `function` syntax and the early-return one-liner, asserted by running this
// repository's real config over virtual files — the claim is that the rules reach every file and that
// only the SvelteKit convention files keep the typed-const arrow idiom, which a block-shape assertion
// cannot show. Type-aware linting is off because a virtual file is in no tsconfig, and both rules are
// syntactic; the cold flat-config budget is `base-resolution.test.ts`'s (joshuafolkken/kit#1755).
const LINT_PROBE_TIMEOUT_MS = 60_000

vi.setConfig({ testTimeout: LINT_PROBE_TIMEOUT_MS })

const linter = new ESLint({
	cwd: fileURLToPath(new URL('..', import.meta.url)),
	overrideConfig: ts.configs.disableTypeChecked,
})

const FUNC_STYLE_RULE = 'func-style'
const ONE_LINER_RULE = 'local/early-return-one-liner'
const SCRIPT_PROBE_FILE = 'scripts/probe.ts'
const ARROW_CONST_SOURCE = 'const helper = (): number => 1\n\nexport { helper }\n'
const TYPED_HANDLER_SOURCE =
	'type RequestHandler = () => Response\n\nexport const GET: RequestHandler = () => new Response()\n'
const TYPED_HOOK_SOURCE =
	'type Handle = () => Response\n\nexport const handle: Handle = () => new Response()\n'
const BLOCK_RETURN_SOURCE =
	'function probe(x: number): number {\n\tif (x > 1) {\n\t\treturn 1\n\t}\n\n\treturn 0\n}\n\nexport { probe }\n'

async function rule_hits(file_path: string, source: string, rule_id: string): Promise<number> {
	const [result] = await linter.lintText(source, { filePath: file_path })
	const messages = result?.messages ?? []

	expect(messages.filter((message) => message.fatal)).toEqual([])

	return messages.filter((message) => message.ruleId === rule_id).length
}

async function function_style_hits(file_path: string, source: string): Promise<number> {
	return await rule_hits(file_path, source, FUNC_STYLE_RULE)
}

describe('create_base_config — func-style (issue #3294)', () => {
	it('flags an arrow const outside the SvelteKit convention files', async () => {
		await expect(function_style_hits(SCRIPT_PROBE_FILE, ARROW_CONST_SOURCE)).resolves.toBe(1)
	})

	it('flags a typed arrow const outside the SvelteKit convention files', async () => {
		await expect(function_style_hits('src/lib/probe.ts', TYPED_HANDLER_SOURCE)).resolves.toBe(1)
	})

	it('allows a typed route handler const', async () => {
		await expect(
			function_style_hits('src/routes/api/+server.ts', TYPED_HANDLER_SOURCE),
		).resolves.toBe(0)
	})

	it('allows a typed server hook const', async () => {
		await expect(function_style_hits('src/hooks.server.ts', TYPED_HOOK_SOURCE)).resolves.toBe(0)
	})

	it('still flags an untyped arrow const in a route file', async () => {
		await expect(
			function_style_hits('src/routes/+page.server.ts', ARROW_CONST_SOURCE),
		).resolves.toBe(1)
	})
})

describe('create_base_config — early-return one-liner (issue #3294)', () => {
	it('flags a block around a single short return', async () => {
		const hits = await rule_hits(SCRIPT_PROBE_FILE, BLOCK_RETURN_SOURCE, ONE_LINER_RULE)

		expect(hits).toBe(1)
	})
})
