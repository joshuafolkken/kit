import semver from 'semver'

const PNPM_INSTALL_PATTERN = /npm install -g pnpm@\d[\d.]{0,19}/gu
const PNPM12_INSTALL = 'npm install -g pnpm@12.6.0'
const MINIMUM_PNPM_VERSION = '12.1.0'
const OLD_PNPM_CHECK_PATTERN =
	/^([ \t]*)if ! command -v pnpm &> \/dev\/null(?: \|\| \[ "\$PNPM_MAJOR" -lt \d+ \])?; then$/mu
const OLD_MAJOR_LINE_PATTERN =
	/^[ \t]*PNPM_MAJOR=\$\(pnpm --version 2>\/dev\/null \| cut -d\. -f1 \|\| echo "0"\)\n/mu
const VERSION_CHECK_MARKER = '[ "$PNPM_MINOR" -lt 1 ]'

function replace_outdated_install(command: string): string {
	const version = command.slice('npm install -g pnpm@'.length)
	const valid_version = semver.valid(version)
	if (valid_version === null) return command

	return semver.lt(valid_version, MINIMUM_PNPM_VERSION) ? PNPM12_INSTALL : command
}

function build_version_check(indent: string): string {
	return [
		`${indent}PNPM_VERSION=$(pnpm --version 2>/dev/null || echo "0.0.0")`,
		`${indent}PNPM_MAJOR=$(echo "$PNPM_VERSION" | cut -d. -f1)`,
		`${indent}PNPM_MINOR=$(echo "$PNPM_VERSION" | cut -d. -f2)`,
		`${indent}if [ "$PNPM_MAJOR" -lt 12 ] || { [ "$PNPM_MAJOR" -eq 12 ] && [ "$PNPM_MINOR" -lt 1 ]; }; then`,
	].join('\n')
}

function patch_deploy_vps_pnpm(content: string): string {
	const with_pnpm12 = content.replaceAll(PNPM_INSTALL_PATTERN, (command) =>
		replace_outdated_install(command),
	)
	if (with_pnpm12.includes(VERSION_CHECK_MARKER)) return with_pnpm12
	if (!OLD_PNPM_CHECK_PATTERN.test(with_pnpm12)) return with_pnpm12

	return with_pnpm12
		.replace(OLD_MAJOR_LINE_PATTERN, '')
		.replace(OLD_PNPM_CHECK_PATTERN, (_, indent: string) => build_version_check(indent))
}

const init_logic_deploy_vps = { patch_deploy_vps_pnpm }

export { init_logic_deploy_vps }
