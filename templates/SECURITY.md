# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| Older   | :x:                |

Fixes ship in a new release rather than as patches to older versions; upgrade to the latest release to receive them. Each release's changes are listed on the [Releases](https://github.com/{{REPOSITORY}}/releases) page.

## Reporting a Vulnerability

If you discover a security vulnerability, please do not report it publicly.

- **Preferred**: Open a [draft security advisory](https://github.com/{{REPOSITORY}}/security/advisories/new) on GitHub.
- **Alternative**: If private reporting is not enabled there, contact a maintainer privately rather than opening a public issue.

We aim to acknowledge reports within **48 hours** and provide a resolution or mitigation plan within **7 days** for confirmed vulnerabilities.

## Development Tooling

This repository takes development tooling from the [`@joshuafolkken/kit`](https://github.com/joshuafolkken/kit) package — depending on the profile it was set up with, the `josh` command, GitHub Actions workflows, Git hooks, AI agent instructions and hooks, and configuration presets. What that package ships and runs on your machine and in CI, the secrets its tooling reads, how to install safe-chain and the external MCP endpoints it configures are described in [kit's security policy](https://github.com/joshuafolkken/kit/blob/main/SECURITY.md). Report a vulnerability in that tooling to kit rather than here.
