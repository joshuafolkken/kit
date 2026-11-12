import { verified_download } from './verified-download'

// Source: https://downloads.claude.ai/claude-code-releases/2.1.318/manifest.json
// Pins live here, never in a manifest fetched by the fresh machine.
const VERSION = '2.1.318'
const URL = `https://downloads.claude.ai/claude-code-releases/${VERSION}/$platform/claude`
const X64_SHA256 = '708c77b204db30086ff6f1ed34577bda03e1be74ced80557cbf7b54249ebf0bd'
const ARM64_SHA256 = '53a0d7e219d7b0804ecba5dbc002745e89f786cc946d2de85a6470d5b2d1fb06'
const PLATFORM = [
	'case "$(uname -m)" in',
	`x86_64|amd64) platform=linux-x64; checksum=${X64_SHA256} ;;`,
	`aarch64|arm64) platform=linux-arm64; checksum=${ARM64_SHA256} ;;`,
	'*) echo "Unsupported Claude architecture" >&2; exit 1 ;; esac',
].join(' ')

// Install the verified executable directly so no mutable bootstrap runs first.
function command(): string {
	const download = verified_download.command(
		`"${URL}"`,
		'$checksum',
		'install -m 755 "$installer" "$claude_bin/claude"',
	)

	return `claude_bin=$(mktemp -d) && (${PLATFORM} && ${download}) && export PATH="$claude_bin:$PATH" DISABLE_AUTOUPDATER=1 && claude --version`
}

const claude_installer = { command }

export { claude_installer }
