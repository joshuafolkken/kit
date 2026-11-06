import { package_path } from '#scripts/init/init-paths'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('type-checks the distributed classifier with the consumer base preset', () => {
	const config = ts.parseJsonConfigFileContent(
		{
			extends: package_path('tsconfig/base.json'),
			compilerOptions: { target: 'ES2023', noEmit: true, types: ['node'] },
		},
		ts.sys,
		package_path('.'),
	)
	const program = ts.createProgram({
		rootNames: [package_path('scripts/gate/change-scope-action.ts')],
		options: config.options,
	})

	expect(ts.getPreEmitDiagnostics(program).map((diagnostic) => diagnostic.code)).toEqual([])
})
