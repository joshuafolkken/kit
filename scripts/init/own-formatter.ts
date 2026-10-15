import { existsSync } from 'node:fs'
import path from 'node:path'

// The configuration files of a formatter other than Prettier. A `basic` project holding one already
// formats its own files, so `josh init` gives it no Prettier and `josh format` / `josh gate` skip it
// (joshuafolkken/kit#3832).
const OWN_FORMATTER_CONFIGS = [
	'biome.json',
	'biome.jsonc',
	'dprint.json',
	'dprint.jsonc',
	'.dprint.json',
	'.dprint.jsonc',
]

function find_config(root: string): string | undefined {
	return OWN_FORMATTER_CONFIGS.find((name) => existsSync(path.join(root, name)))
}

const own_formatter = { find_config }
export { own_formatter }
