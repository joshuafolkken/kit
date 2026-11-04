// Save and check repository-pinned bytes before the caller can install or execute them.
// The subshell scopes cleanup; && fails closed even inside a shell fallback.
// url is a shell argument: callers quote it when it contains shell expansions.
function command(url: string, checksum: string, execute: string): string {
	return [
		'(installer=$(mktemp) &&',
		`trap 'rm -f "$installer"' EXIT &&`,
		`curl --proto '=https' -fsSL ${url} -o "$installer" &&`,
		`(echo "${checksum}  $installer" |`,
		'(if command -v sha256sum >/dev/null 2>&1; then sha256sum -c -; else shasum -a 256 -c -; fi)) &&',
		`${execute})`,
	].join(' ')
}

const verified_download = { command }

export { verified_download }
