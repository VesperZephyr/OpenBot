# OpenBot

OpenBot is an open-source, local-first app for personal AI Bots. You keep a roster of named Bots, each with a role, instructions, memory, skills, and routines, and hand them tasks by message. Every Bot works on your own Mac: authorized files, the terminal, a managed browser with shared logins, desktop applications, and connectors. There is no cloud control plane and no cloud computer.

The desktop UI, Host Runtime, Pi-based agent loop, local executor, and managed browser all run on your computer. Consequential actions stop for your approval under rules you control, and you can take over the browser or desktop at any time. The architecture treats `targetId` as a first-class seam so additional execution targets can attach later without hosting conversations or Pi.

Model inference uses a configurable API endpoint. Application state is stored locally.

**Status: Phase 1 (MVP) is implemented and awaiting acceptance.** A first-launch setup picks a model (API keys go to the macOS Keychain) and creates your first Bot. Bots work in the shared workspace `~/OpenBot` with file tools and shell commands, search the web, and remember your preferences. Read-only commands such as `rg`, `grep`, or `ls` inside folders Bots may use run without asking. Other commands stop for **Allow once**, **Always allow**, or **Deny**, and those decisions survive restarts. Long commands move to the background. Up to three Bots work at once, and you can stop or redirect a Bot while it works. Commands run in a separate executor process with credentials removed from their environment.

Phase 2 adds connectors, skills, routines, and Bots working together; Phase 3 adds the managed browser and desktop computer use. See [the backlog](docs/backlog.md).

## Development

Requires macOS, Node.js 22.19 or later, and pnpm 9.

```sh
pnpm install
pnpm run build:pi    # build vendored Pi packages
pnpm run dev         # run the app
pnpm run check       # package boundaries, type check, unit tests
pnpm run e2e         # drive the built app end to end against a scripted model
pnpm run package     # build an arm64 DMG (ad-hoc signed without a Developer ID)
```

The desktop app starts the Host Runtime, which starts the local executor. Data lives in `~/Library/Application Support/OpenBot`, the shared workspace is `~/OpenBot`, and model providers come from `~/.openbot/models.json`. The e2e suite keeps its own state under `e2e/.run/`. How agents work on this repository, including driving the app with agent-browser, is in [AGENTS.md](AGENTS.md).

## Your own model providers

Configure endpoints in `~/.openbot/models.json` (set `OPENBOT_HOME` to use another directory). It uses [Pi's `models.json` format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md) for the `openai-completions`, `openai-responses`, and `anthropic-messages` APIs. Models whose IDs OpenBot already knows inherit their limits and capabilities, so a bare ID is enough.

```jsonc
{
  "providers": {
    // A new provider: one gateway can serve both protocols.
    "my-gateway": {
      "baseUrl": "https://gateway.example.com/v1",
      "api": "openai-responses",
      // "$VAR" reads the environment OpenBot was launched with; "!command" uses a command's output.
      "apiKey": "!security find-generic-password -s my-gateway -w",
      "models": [
        { "id": "gpt-5.5" },
        { "id": "claude-sonnet-5-5", "api": "anthropic-messages", "baseUrl": "https://gateway.example.com" }
      ]
    },
    // A built-in ID overlays that provider, for example to route it through a proxy.
    "anthropic": { "baseUrl": "https://proxy.example.com" }
  }
}
```

Apps opened from the Dock do not see variables exported in your shell profile, so prefer `!command` or a key saved in Settings, which takes precedence over `apiKey`. Settings lists configuration problems with their location in the file.

## Documentation

- [Architecture and first-release development sequence](docs/architecture.md)
- [Technical plan: current state, milestone breakdown, open decisions](docs/technical-plan.md)
- [Vendored Pi provenance and local changes](third_party/pi/OPENBOT_CHANGES.md)
