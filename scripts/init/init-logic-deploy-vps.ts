const PNPM_INSTALL_PATTERN = /npm install -g pnpm@\d[\d.]{0,19}/gu
const PNPM11_INSTALL = 'npm install -g pnpm@11.0.6'
const OLD_PNPM_CHECK_PATTERN = /^([ \t]*)(if ! command -v pnpm &> \/dev\/null; then)$/mu
const VERSION_CHECK_MARKER = '[ "$PNPM_MAJOR" -lt 11 ]'

function build_version_check(indent: string, if_line: string): string {
	const updated_if = if_line.replaceAll('; then', ' || [ "$PNPM_MAJOR" -lt 11 ]; then')

	return `${indent}PNPM_MAJOR=$(pnpm --version 2>/dev/null | cut -d. -f1 || echo "0")\n${indent}${updated_if}`
}

function patch_deploy_vps_pnpm(content: string): string {
	const with_pnpm11 = content.replaceAll(PNPM_INSTALL_PATTERN, PNPM11_INSTALL)
	if (with_pnpm11.includes(VERSION_CHECK_MARKER)) return with_pnpm11

	return with_pnpm11.replace(OLD_PNPM_CHECK_PATTERN, (_, indent: string, if_line: string) =>
		build_version_check(indent, if_line),
	)
}

const init_logic_deploy_vps = { patch_deploy_vps_pnpm }

export { init_logic_deploy_vps }
