import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// joshuafolkken/kit#6401. A detached child that runs a `.ts` entry needs a TypeScript loader on its
// own command line. The parent's `execArgv` cannot be trusted to carry one: `josh-ready.ts` runs the
// `dist/josh.js` bundle under plain node, or registers tsx in-process, and neither leaves a flag behind.
// Native type stripping then reads the entry but fails on its extensionless imports.
//
// tsx is resolved from this package, not the working directory, so a consumer's checkout finds the
// copy kit itself depends on.
const IMPORT_FLAG = '--import'
const TSX_PACKAGE = 'tsx'
// `--import tsx`, or a resolved path through the package directory — not any flag that merely mentions it.
const TSX_LOADER_PATTERN = /(?:^|\/node_modules\/)tsx(?:$|\/)/u

function loader_url(): string {
	const loader_path = createRequire(import.meta.url).resolve(TSX_PACKAGE)

	return pathToFileURL(loader_path).href
}

function has_loader(exec_argv: ReadonlyArray<string>): boolean {
	return exec_argv.some((flag) => TSX_LOADER_PATTERN.test(flag))
}

function loader_argv(exec_argv: ReadonlyArray<string>): Array<string> {
	if (has_loader(exec_argv)) return [...exec_argv]

	return [...exec_argv, IMPORT_FLAG, loader_url()]
}

const ts_entry_loader = { IMPORT_FLAG, loader_argv, loader_url }

export { ts_entry_loader }
