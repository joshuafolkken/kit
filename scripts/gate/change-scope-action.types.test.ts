import { tmpdir } from 'node:os'
import { package_path } from '#scripts/init/init-paths'
import ts from 'typescript'
import { afterEach, expect, it } from 'vitest'

const START_CWD = process.cwd()

afterEach(() => {
	process.chdir(START_CWD)
})

function classifier_diagnostics(): Array<number> {
	const config = ts.parseJsonConfigFileContent(
		{
			extends: package_path('tsconfig/base.json'),
			compilerOptions: { target: 'ES2023', noEmit: true, types: ['node'] },
		},
		ts.sys,
		package_path('.'),
	)
	// `types: ['node']` resolves from the host's current directory, so it is pinned to the package:
	// a sibling in the isolate:false pure project can leave `process.cwd()` in a temp directory.
	const host = ts.createCompilerHost(config.options)

	host.getCurrentDirectory = (): string => package_path('.')
	const program = ts.createProgram({
		rootNames: [package_path('scripts/gate/change-scope-action.ts')],
		options: config.options,
		host,
	})

	return ts.getPreEmitDiagnostics(program).map((diagnostic) => diagnostic.code)
}

// joshuafolkken/kit#6982: the ship's gate failed it when an earlier pure file left the cwd elsewhere.
// It runs first: a program built from the package directory leaves a resolution TypeScript reuses.
it('type-checks the distributed classifier from a working directory outside the package', () => {
	process.chdir(tmpdir())

	expect(classifier_diagnostics()).toEqual([])
})

it('type-checks the distributed classifier with the consumer base preset', () => {
	expect(classifier_diagnostics()).toEqual([])
})
