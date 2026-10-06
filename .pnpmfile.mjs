// josh-managed-pnpmfile: @joshuafolkken/kit
// `josh init` / `josh sync` copy this file into every project that publishes (joshuafolkken/kit#3110)
// and overwrite it while this first line stays; edit it in kit, not here.
// Strips the Safe Chain `preinstall` from the packed manifest only (joshuafolkken/kit#2693).
// kit writes it to warn the repository's own development installs when Safe Chain is not active
// (joshuafolkken/kit#3269); shipped, it becomes a build script every consumer's pnpm refuses to run
// unapproved, and it could not protect them anyway — their install has already started by the time
// a dependency's `preinstall` runs. The
// repository's package.json keeps it; `pnpm pack` and `pnpm publish` call this hook on the copy they
// write. Any other lifecycle script — a native build, a binary download — is the package's own and
// ships untouched.
const SAFE_CHAIN_PACKAGE = '@aikidosec/safe-chain'

function is_safe_chain_preinstall(name, command) {
	return name === 'preinstall' && command.includes(SAFE_CHAIN_PACKAGE)
}

function strip_safe_chain_preinstall(manifest) {
	const scripts = Object.fromEntries(
		Object.entries(manifest.scripts ?? {}).filter(
			([name, command]) => !is_safe_chain_preinstall(name, command),
		),
	)

	return { ...manifest, scripts }
}

const hooks = { beforePacking: strip_safe_chain_preinstall }

export { hooks, is_safe_chain_preinstall }
