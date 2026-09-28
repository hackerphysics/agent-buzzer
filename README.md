# AgentBuzzer

AgentBuzzer receives completion and approval events from Codex, GitHub Copilot, and Hermes. A local background service decides when to deliver them through Feishu, a generic HTTPS webhook, or Slack Incoming Webhooks. The desktop app has separate pages for overview, timing, channels, and adapter installation.

## Install

GitHub Actions builds an unsigned Windows NSIS `.exe`, macOS Intel and Apple Silicon `.dmg` files, and Linux `.deb` on every push to `master` and on manual runs. Download the artifact for your platform from the workflow run. Version tags `v*` also publish the installers to a GitHub Release. The desktop installers include their own Node runtime; the Codex, Copilot, and Hermes CLIs still need to be installed separately if you use those adapters.

On first launch the desktop app copies its service and runtime to `~/.agent-buzzer/app-<version>-<build-id>` and starts a local service at `http://127.0.0.1:38147`. Use the **Adapters** page to install or update each Agent's plugin. Installed hooks use the bundled runtime and start the service automatically if it is not running. Quit the desktop window without stopping the notification service.

Unsigned Windows and macOS installers can show operating-system trust warnings. Signing/notarization requires certificates that are not included in this repository.

To run from source with Node.js 20 or newer:

```sh
npm install
npm run ui
```

Open the printed local URL. CLI installation remains available:

```sh
npm run install:local
npm run install:local -- --force
```

The installer only manages the `agent-buzzer` plugins. Codex may ask you to trust the `Stop` and `PermissionRequest` hooks; restart Codex Desktop after installing. Copilot CLI uses `agentStop` and `notification` hooks. Copilot Desktop's plugin execution has not been verified. Hermes observes completion, failed/interrupted sessions, and approval requests.

## Settings

Set the device name and enable one or more channels on the **Channels** page. Feishu needs a bot-enabled app with `im:message` permission, an App ID, App Secret, and a recipient ID (`chat_id`, `open_id`, `user_id`, or `email`). Generic webhook accepts an HTTPS URL and receives JSON `{ "event": { "agent": "...", "status": "...", "summary": "..." }, "deviceName": "..." }`. Slack requires a Slack Incoming Webhook URL. Slack messages are sent as JSON with a `text` field. Endpoint URLs are not returned by the local settings API.

Settings and queued events are stored under `~/.agent-buzzer`, never in the repository. Existing Feishu settings are read automatically. Feishu App Secret uses Windows DPAPI; on macOS/Linux it is stored in a `0600` user-only file, not encrypted by the OS keychain. You can instead supply `AGENTBUZZER_FEISHU_APP_SECRET` in the service environment. Webhook URLs in the per-user `config.json` are sensitive bearer credentials; restrict access to that file and do not commit it. `AGENTBUZZER_WEBHOOK_URL` and `AGENTBUZZER_SLACK_WEBHOOK_URL` are also supported. The service listens on loopback only and rejects cross-origin browser requests.

Useful CLI commands:

```sh
node bin/agent-buzzer.mjs doctor
node bin/agent-buzzer.mjs check-token
node bin/agent-buzzer.mjs test-card --dry-run
node bin/agent-buzzer.mjs test-card
```

`test-card` queues a test event for the enabled channels and obeys the notification policy. `--dry-run` prints a Feishu card without sending anything.

## Delivery policy

- **Notifications off:** no message is sent. New events are discarded immediately, and pending events are removed. Turning notifications back on does not replay them. The same applies to an Agent-specific switch.
- **DND or Break:** new events are persisted; delivery resumes when the pause ends. A new event during Break resets the Break timer. Replaying an older event does not reset it.
- **Working hours:** disabled by default. If enabled, new events outside the selected local days/hours are discarded. Existing DND backlog waits until the next allowed window. Overnight hours are supported.
- **Channel off:** pending deliveries for that channel are discarded; pending deliveries for other enabled channels remain.

Each queued event is an atomic file. Failed deliveries retry with exponential backoff and survive service restarts. Multi-channel delivery tracks each channel separately. Delivery is at least once: a crash after a remote service accepts a message but before its local queue file is updated may cause a duplicate.

## Development

```sh
npm test
npm run stage
npm run build:installers
```

The plugin sources are in `plugins/`; generated plugin copies, staging output, and installers are ignored under `.agents/plugins/agent-buzzer/`, `dist/`, `build/`, and `release/`. The GitHub workflow builds Windows x64 NSIS, macOS x64 and arm64 DMGs, and Linux x64 DEB on native runners.
