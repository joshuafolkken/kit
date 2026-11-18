import { direct_importers } from './direct-importers'
import type { Resolve } from './test-symbol-bindings'
import { test_symbol_facts, type FileFacts } from './test-symbol-facts'

// **A file the syntax reader cannot parse, read whole** (joshuafolkken/kit#7980) — a `.svelte`
// component: one declaration, its default export, spanning every line and using every export of each
// module it names. Any name imported from it binds that declaration.

const WHOLE_EXTENSIONS = ['.svelte']
const { DEFAULT_EXPORT, EVERY, empty_facts, key_of } = test_symbol_facts

function is_whole(file: string): boolean {
	return WHOLE_EXTENSIONS.some((extension) => file.endsWith(extension))
}

function read_whole(resolve: Resolve, file: string, text: string): FileFacts {
	const facts = empty_facts()
	const modules = direct_importers
		.specifiers_of(text)
		.map((specifier) => resolve(specifier, file))
		.filter((module) => module !== undefined)
	const references = new Set(modules.map((module) => key_of(module, EVERY)))

	facts.declarations.set(DEFAULT_EXPORT, { start: 1, end: text.split('\n').length, references })
	facts.exports.set(DEFAULT_EXPORT, DEFAULT_EXPORT)
	facts.exports.set(EVERY, DEFAULT_EXPORT)
	for (const module of modules) facts.modules.add(module)

	return facts
}

const test_symbol_whole = { is_whole, read_whole }

export { test_symbol_whole }
