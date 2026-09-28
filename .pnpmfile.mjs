// Strips the install-time lifecycle scripts from the packed manifest only (joshuafolkken/kit#2693).
// kit's own `preinstall` runs Safe Chain for kit's development installs; shipped, it becomes a build
// script every consumer's pnpm refuses to run unapproved, and it could not protect them anyway —
// their install has already started by the time a dependency's `preinstall` runs. The repository's
// package.json keeps it; `pnpm pack` and `pnpm publish` call this hook on the copy they write.
const install_lifecycle_scripts = new Set(['preinstall', 'install', 'postinstall'])

function strip_install_lifecycle(manifest) {
	const scripts = Object.fromEntries(
		Object.entries(manifest.scripts ?? {}).filter(([name]) => !install_lifecycle_scripts.has(name)),
	)

	return { ...manifest, scripts }
}

const hooks = { beforePacking: strip_install_lifecycle }

export { hooks, install_lifecycle_scripts }
