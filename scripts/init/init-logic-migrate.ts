import { safe_chain_preinstall } from '#scripts/safe-chain/preinstall-command'

// The one `scripts` migration `josh init` still makes: a safe-chain `preinstall` an earlier kit
// wrote. The `jf-` values, the pre-josh values and the retired managed scripts were dropped once no
// consumer carried them (joshuafolkken/kit#4187); this one is removable from kit 2.0.0.
function migrate_scripts(scripts: Record<string, string>): Record<string, string> {
	const current = scripts['preinstall']

	if (current === undefined) return scripts

	return { ...scripts, preinstall: safe_chain_preinstall.migrate_preinstall(current) }
}

const init_logic_migrate = { migrate_scripts }

export { init_logic_migrate }
