import { readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { claude_plugin_config } from './claude-plugin-config'

// `josh init` / `josh sync` declare the kit plugin in the consumer's `.claude/settings.json`, but the
// CLI does not install it from the declaration alone — a consumer runs `claude plugin install kit@kit`
// once (joshuafolkken/kit#1930). Nothing said so at the end of init or sync, so a consumer whose
// skills silently never loaded had no pointer to the one command that fixes it. This prints that
// command on completion, unless the plugin already appears installed.

const PLUGINS_SUBDIR = path.join('.claude', 'plugins')

// Best effort: Claude Code records installed marketplaces under `~/.claude/plugins`. The kit
// marketplace directory being present is the strongest signal available at the shell; the plugin's
// enabled state is not readable here, so an uncertain read (no directory, no permission) counts as
// "not installed". A hint shown once too often costs a line; one never shown costs a consumer its skills.
function is_plugin_installed(home_directory: string = os.homedir()): boolean {
	try {
		return readdirSync(path.join(home_directory, PLUGINS_SUBDIR)).some(
			(entry) =>
				entry === claude_plugin_config.MARKETPLACE_NAME ||
				entry.startsWith(`${claude_plugin_config.MARKETPLACE_NAME}@`),
		)
	} catch {
		return false
	}
}

function plugin_install_hint(is_installed: boolean): string | undefined {
	if (is_installed) return undefined

	return `  ℹ Skills load from the kit plugin. If they are missing, run: claude plugin install ${claude_plugin_config.PLUGIN_ID}`
}

function report_plugin_install_hint(home_directory?: string): void {
	const hint = plugin_install_hint(is_plugin_installed(home_directory))
	if (hint !== undefined) console.info(hint)
}

const plugin_install_hint_module = {
	is_plugin_installed,
	plugin_install_hint,
	report_plugin_install_hint,
}

export { plugin_install_hint_module }
