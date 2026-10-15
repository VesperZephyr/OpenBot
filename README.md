# OpenBot

OpenBot is an open-source, local-first app for personal AI Bots. You keep a roster of named Bots, each with a role, instructions, memory, skills, and routines, and hand them tasks by message. Every Bot works on your own Mac: authorized files, the terminal, a managed browser with shared logins, desktop applications, and connectors. There is no cloud control plane and no cloud computer.

The desktop UI, Host Runtime, Pi-based agent loop, local executor, and managed browser all run on your computer. Consequential actions stop for your approval under rules you control, and you can take over the browser or desktop at any time. The architecture treats `targetId` as a first-class seam so additional execution targets can attach later without hosting conversations or Pi.

Model inference uses a configurable API endpoint. Application state is stored locally.

The project is between milestones M0 and M1. It has a pnpm workspace with vendored [Pi](https://github.com/earendil-works/pi), a Host Runtime that keeps Bots and their conversations in local SQLite, and an Electron desktop shell where you can create Bots, chat with them through a configured model, and manage them. API keys are stored in the macOS Keychain. Bots cannot use tools yet: file and command execution arrive in M1.

## Development

Requires macOS, Node.js 22.19 or later, and pnpm 9.

```sh
pnpm install
pnpm run build:pi                        # build vendored Pi packages
pnpm run check                           # package boundaries, type check, tests
pnpm --filter @openbot/desktop run dev   # run the desktop app with a live-reloading renderer
```

Electron downloads its binary on first use. The desktop app starts the Host Runtime itself; `pnpm --filter @openbot/local-server run start` runs a standalone Host for development. Both use `~/Library/Application Support/OpenBot` unless `OPENBOT_DATA_DIR` is set, and the Keychain service `ai.openbot.desktop.credentials` unless `OPENBOT_KEYCHAIN_SERVICE` is set. Point both at throwaway values when testing.

## Your own model providers

Add OpenAI- or Anthropic-compatible endpoints in `~/.openbot/config.json` (set `OPENBOT_HOME` to use another directory). The format follows Pi's `models.json`; models whose IDs OpenBot already knows inherit their limits and capabilities.

```jsonc
{
  "providers": {
    "my-gateway": {
      "baseUrl": "https://gateway.example.com/v1",
      "api": "openai-responses", // or "openai-completions", "anthropic-messages"
      // "$VAR" reads the environment OpenBot was launched with; "!command" uses a command's output.
      "apiKey": "!security find-generic-password -s my-gateway -w",
      "models": [
        { "id": "gpt-5.5" },
        { "id": "claude-sonnet-5-5", "api": "anthropic-messages", "baseUrl": "https://gateway.example.com" }
      ]
    }
  }
}
```

Apps opened from the Dock do not see variables exported in your shell profile, so prefer `!command` or a key saved in Settings, which takes precedence over `apiKey`. Settings lists configuration problems with their location in the file.

## Documentation

- [Architecture and first-release development sequence](docs/architecture.md)
- [Technical plan: current state, milestone breakdown, open decisions](docs/technical-plan.md)
- [Vendored Pi provenance and local changes](third_party/pi/OPENBOT_CHANGES.md)
