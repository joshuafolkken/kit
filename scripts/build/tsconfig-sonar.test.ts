import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { package_path } from '#scripts/init/init-paths'
import ts from 'typescript'
import { afterAll, describe, expect, it } from 'vitest'

// `tsconfig.sonar.json` is byte-copied into a consumer's root, where no `tsconfig/` directory
// exists, so the base is named by the package specifier — which also self-resolves inside kit.
const KIT_BASE_SPECIFIER = '@joshuafolkken/kit/tsconfig/base'
const SONAR_TSCONFIG_NAME = 'tsconfig.sonar.json'
const SONAR_TSCONFIG = package_path(SONAR_TSCONFIG_NAME)

function format_diagnostics(diagnostics: ReadonlyArray<ts.Diagnostic>): Array<string> {
	return diagnostics.map(
		(diagnostic) =>
			`TS${String(diagnostic.code)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
	)
}

function parse_tsconfig(config_path: string): ts.ParsedCommandLine {
	const read = ts.readConfigFile(config_path, (file) => ts.sys.readFile(file))

	return ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(config_path))
}

// Config-level diagnostics only: an empty root set keeps the check to option validation (where
// TypeScript 6 reports a deprecated `moduleResolution`) without type-checking the whole tree.
function collect_config_diagnostics(config_path: string): Array<string> {
	const parsed = parse_tsconfig(config_path)
	const program = ts.createProgram({ rootNames: [], options: parsed.options })

	return format_diagnostics([...parsed.errors, ...program.getOptionsDiagnostics()])
}

// A consumer root as `josh init` leaves it: the copied config, one source file for `include`, and
// kit installed under node_modules (linked to this checkout), with a package name of its own.
function create_consumer_root(): string {
	const root = mkdtempSync(path.join(os.tmpdir(), 'kit-sonar-tsconfig-'))
	const scope_directory = path.join(root, 'node_modules', '@joshuafolkken')

	mkdirSync(scope_directory, { recursive: true })
	symlinkSync(package_path('.'), path.join(scope_directory, 'kit'), 'dir')
	mkdirSync(path.join(root, 'src'))
	writeFileSync(path.join(root, 'src', 'index.ts'), 'export {}\n')
	writeFileSync(path.join(root, 'package.json'), '{ "name": "consumer" }\n')
	copyFileSync(SONAR_TSCONFIG, path.join(root, SONAR_TSCONFIG_NAME))

	return root
}

describe('tsconfig.sonar.json in kit', () => {
	it('extends the kit base config by its package specifier', () => {
		const content = JSON.parse(readFileSync(SONAR_TSCONFIG, 'utf8')) as { extends?: unknown }

		expect(content.extends).toBe(KIT_BASE_SPECIFIER)
	})

	it('inherits the base module resolution instead of a deprecated one', () => {
		expect(parse_tsconfig(SONAR_TSCONFIG).options.moduleResolution).toBe(
			ts.ModuleResolutionKind.Bundler,
		)
	})

	it('yields no config or compiler-option diagnostics', () => {
		expect(collect_config_diagnostics(SONAR_TSCONFIG)).toStrictEqual([])
	})
})

describe('tsconfig.sonar.json copied into a consumer', () => {
	const consumer_root = create_consumer_root()
	const consumer_config = path.join(consumer_root, SONAR_TSCONFIG_NAME)

	afterAll(() => {
		rmSync(consumer_root, { recursive: true, force: true })
	})

	it('resolves the kit base from node_modules with no diagnostics', () => {
		expect(collect_config_diagnostics(consumer_config)).toStrictEqual([])
		expect(parse_tsconfig(consumer_config).options.moduleResolution).toBe(
			ts.ModuleResolutionKind.Bundler,
		)
	})
})
