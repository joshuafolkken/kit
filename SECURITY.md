# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please do not report it publicly.

- **Preferred**: Open a [draft security advisory](https://github.com/joshuafolkken/kit/security/advisories/new) on GitHub.
- **Alternative**: Email [joshuafolkken@gmail.com](mailto:joshuafolkken@gmail.com) directly.

We aim to acknowledge reports within **48 hours** and provide a resolution or mitigation plan within **7 days** for confirmed vulnerabilities.

## Published Package Contents

The following files are intentionally included in the published npm package and distributed to consuming projects via `josh sync`:

- `.mcp.json` — MCP server configuration for the Svelte documentation server. Contains only the public endpoint `https://mcp.svelte.dev/mcp`. No credentials or private URLs.
- `.coderabbit.yaml`, `.cursorrules` — AI tool configurations with no sensitive data.
- `templates/`, `prompts/` — Markdown and config templates. No credentials.

Sensitive runtime secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) are stored only in a local `.env` file which is gitignored and never committed to the repository.
