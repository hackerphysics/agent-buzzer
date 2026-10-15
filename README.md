# AgentBuzzer

AgentBuzzer receives completion and approval events from Codex, GitHub Copilot, and Hermes. A shared local background service routes notifications to 20 configurable channel types. The desktop app has separate pages for overview, timing, individual channel configuration, and adapter installation.

## Install

GitHub Actions builds an unsigned Windows NSIS `.exe`, macOS Intel and Apple Silicon `.dmg` files, and Linux `.deb` on every push to `master` and on manual runs. Download the artifact for your platform from the workflow run. Version tags `v*` also publish the installers to a GitHub Release. The desktop installers include their own Node runtime; the Codex, Copilot, and Hermes CLIs still need to be installed separately if you use those adapters.

On first launch the desktop app copies its service and runtime to `~/.agent-buzzer/app-<version>-<build-id>` and starts a local service at `http://127.0.0.1:38147`. Use the **Adapters** page to install or update each Agent's plugin. Installed hooks use the bundled runtime and start the service automatically if it is not running. Quit the desktop window without stopping the notification service.

After installing or updating the Codex adapter, the app opens a short Hook-authorization guide. Restart Codex, open `/hooks` in a new conversation, review and trust AgentBuzzer's `Stop` and `PermissionRequest` hooks, then finish a test turn. You can reopen the guide from the Codex adapter row. An installed plugin is not proof that Codex has trusted its hooks; the app never grants that trust on your behalf.

Generated Codex hooks select an explicit native launcher: PowerShell on Windows and `/bin/sh` on macOS/Linux. Windows uses a UTF-16 encoded command; Unix passes UTF-8 path bytes as octal escapes to the inner shell. Paths are never evaluated as outer-shell code, stdin/stdout are preserved, and failures propagate as nonzero exits. An outer PowerShell may normalize a native failure code to `1`. Changing a generated hook requires reviewing the two hooks again.

The **Adapters** page can also remove each AgentBuzzer plugin individually after confirmation. This leaves the AgentBuzzer service, other adapters, channel settings, and marketplace registrations intact, but discards that Agent's pending notifications. Restart an already-open Agent session to unload hooks it may have cached.

The app icon is maintained in `src/icon.svg`; `npm run stage` renders the desktop and Linux icon sizes before packaging. Windows and Linux remove Electron's default in-window menu bar. macOS retains the operating system's global application menu.

Settings load independently of background adapter checks. Slow or failed Agent CLIs do not block the settings page; UI requests time out with a retry message instead of staying on "Connecting" indefinitely. Credential decryption occurs only when Feishu delivery needs the secret, not during page refresh or policy checks.

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

## Shell compatibility

The native CI runners execute launch-contract tests with these outer shells:

| Platform | Tested shells |
| --- | --- |
| Windows x64 | `cmd.exe`, Windows PowerShell 5.1, PowerShell 7, Git Bash |
| macOS Intel / Apple Silicon | `sh`, `bash`, `zsh`, `fish` |
| Linux x64 | `sh`, `bash`, `dash`, `zsh`, `fish` |

The tests exercise both Codex hooks, paths containing spaces, apostrophes, Unicode and shell metacharacters, UTF-8 JSON on stdin, stdout, nonzero exit status, and missing runtime/script failures. They also verify Copilot's executable/argument arrays and Hermes's Python subprocess contract without calling an external notification service. These are launch-contract tests, not an end-to-end certification of every Agent version.

`npm run test:shells` runs the matrix available on the current machine. With `AGENTBUZZER_REQUIRE_SHELLS=1`, missing shells or Python fail the tests instead of being skipped; CI enables this setting and installs the additional Unix shells. WSL, SSH/remote sessions, and other shells are not part of this matrix. Install adapters separately in each operating-system environment; do not copy a Windows plugin's generated paths into Linux.

Node's ESM loader rejects literal backslashes in Unix module directories. Runtime executable paths with backslashes are tested, but the app's `.mjs` files must remain in module directories that Node can load. Shell quoting cannot bypass that runtime restriction.

## Hook diagnostics

Codex hook diagnostics are written to `~/.agent-buzzer/codex-hook.log` (beside the settings file when `AGENTBUZZER_CONFIG` is set). Logs contain timestamps, hook commands, completion states, and safe error categories, never notification text or credentials. The log rotates after 128 KiB and retains one previous file. A failure with no `started` record indicates that the shell or runtime failed before AgentBuzzer could start.

## Settings

The sidebar **Language / 语言** selector supports Simplified Chinese (`zh-CN`) and English (`en`). Switching applies immediately and is saved in the local settings file, without changing notification policies, channel credentials or unsaved form drafts. Existing installations default to Chinese. Pages, provider labels, validation feedback, confirmation dialogs, Hook guidance, and date/time displays follow the selected language. Narrow layouts use a two-column page navigation so English labels remain fully visible.

App-generated notification titles, status labels, footer labels, test messages and adapter fallback summaries also use the selected language. Queue replay uses the current language while retaining the original event time and metadata. Actual Agent replies, session names, device names, model identifiers and Webhook JSON field names are never translated. Older queued events/adapters that did not mark their generated fallback text retain their original summary. Update adapters to enable localized fallback summaries. Technical CLI diagnostic output and operating-system-native controls may retain their own language.

You can also update the preference with `PUT /api/settings` and `{ "language": "en" }` or `{ "language": "zh-CN" }`.

Set the device name and choose a channel on the **Channels** page. Each channel has independent configuration, enable/disable controls, a scoped test button, and its last delivery status. Desktop uses a grouped channel list; mobile uses a selector. Unsaved drafts stay in memory while switching channels, not in browser storage.

| Channel | Required configuration |
| --- | --- |
| Feishu application | App ID, App Secret, recipient type and ID; bot needs `im:message` permission |
| Feishu group bot | Group-bot webhook; optional signing secret |
| Slack | Incoming Webhook URL |
| Telegram | Bot Token, Chat ID; optional forum Topic ID |
| Discord | Channel webhook; automatic mentions are disabled |
| Microsoft Teams | Power Automate Workflows webhook accepting Adaptive Cards, with anonymous caller access |
| Google Chat | Space webhook URL containing its key and token |
| Mattermost | Incoming webhook URL |
| DingTalk | Robot webhook; optional HMAC signing secret |
| WeCom | Group robot webhook URL |
| Matrix | Homeserver, Room ID and access token; unencrypted rooms only |
| LINE | Channel access token and user/group/room ID |
| ntfy | Server and topic; optional access token |
| Bark | Server and device key |
| Gotify | Server, application token and priority |
| Pushover | Application token and user key; optional device |
| Email SMTP | Host, port, STARTTLS/TLS, sender and recipient; optional password/App Password authentication |
| Twilio SMS | Account SID, Auth Token, registered sender and recipient in E.164 format |
| Generic webhook | HTTPS URL; optional Bearer Token |
| Hermes send bridge | Hermes executable and configured delivery target, such as `signal:+...` or `whatsapp:...` |

New channels are disabled by default. Tests target only the selected saved channel and obey the same off/DND/work-hours policy as real events. Turning notifications off discards a test rather than sending it. SMS tests request confirmation because Twilio may charge per message segment; no test credentials are supplied or created automatically.

Teams uses Workflows, not retired Office 365 connectors. Matrix checks room encryption before sending and refuses encrypted rooms; use a configured encryption-capable gateway for those rooms. Robot keyword allowlists must match the outgoing text, which includes `AgentBuzzer`. SMTP requires verified TLS or STARTTLS; anonymous TLS relays and password/App Password authentication are supported, not an OAuth onboarding flow. Public self-hosted servers require HTTPS; loopback `localhost`, `127.0.0.1` and `::1` may use HTTP.

The optional Hermes bridge invokes `hermes send --to <target> --file - --quiet` with an argument array and the message on stdin. It does not copy Hermes credentials or start a model conversation. The installed Hermes version must provide `hermes send`, and its target must already be configured. On Windows use a native executable, such as the Python-installed `hermes.exe`, rather than a `.cmd` shim. Known media/file directives are neutralized so notification summaries cannot request file attachments. WhatsApp and Signal support here depends on that external gateway; personal WeChat, QQ, iMessage and other account/session-based integrations are not advertised as native senders.

### Feishu cards

The Feishu application and group bot both send interactive JSON 2.0 cards. The header contains the Agent and task status; the subtitle contains the supplied session name. If no session name is available, the subtitle is omitted rather than displaying a fabricated title or session ID. The body contains the short result summary and an optional task link.

A final small grey footer contains AgentBuzzer, the device name, and the original completion time (end time for failed events, occurrence time for approval requests). Times use the service machine's local timezone, with an explicit UTC offset. Missing timestamps are omitted; old queue files fall back to their persisted creation time, never the replay time.

When available, the footer also shows the model and context usage, for example `Model: gpt-example` and `Context: 24,000 / 128,000 tokens (18.8%)`. If only the used tokens, window size or percentage is available, only that known value is shown. Unknown values and invalid numbers are omitted. The notification event captures this metadata so retries and DND replay do not fetch newer values from a live session.

Direct events may supply `model`, `contextTokens`, `contextWindow` and `contextPercent`. Adapters also accept snake_case equivalents. Hermes forwards the model supplied by its lifecycle hooks and any explicit context metrics. Codex reads the current-turn model and the latest `last_token_usage`/`model_context_window` snapshot when supplied in its JSONL transcript. Copilot reads current-turn `assistant.usage.model` and `session.usage_info.currentTokens`/`tokenLimit` records. Transcript reads are limited to the last 512 KiB, ignore malformed/incomplete records, and omit data if the current turn cannot be identified. Cumulative session token totals are not treated as context usage. Availability depends on the installed Agent version and what it records; metadata is not estimated from message lengths or fetched from model providers.

Generic webhooks use the standard v1 contract below with editable JSON field mappings. Previously configured webhooks retain `{ "event": { "agent": "...", "status": "...", "summary": "..." }, "deviceName": "..." }` until you explicitly select **Standard message v1**. You can select the legacy format again without deleting your saved mappings.

Provider HTTP/business failures stay in the durable queue. Retry schedules are per channel and honor HTTP `Retry-After` and Telegram/Discord rate-limit responses. Matrix and LINE reuse transaction keys on retries. A provider acknowledgement is not a read receipt, and an already-in-flight remote request cannot be recalled when a switch is turned off.

### Webhook contract

The generic webhook sends an HTTPS `POST` with `Content-Type: application/json; charset=utf-8` and an optional `Authorization: Bearer <token>`. Any HTTP 2xx response acknowledges receipt. Standard v1 JSON:

```json
{
  "deviceName": "Office-PC",
  "agentName": "Codex",
  "appName": "AgentBuzzer",
  "sessionName": "Update notification settings",
  "resultDetails": "Implemented and verified the requested change.",
  "completedAt": "2026-10-12T08:00:00.000Z",
  "eventId": "unique-persisted-queue-id",
  "sessionId": "session-id",
  "turnId": "turn-id",
  "status": "completed",
  "occurredAt": "2026-10-12T08:00:00.000Z",
  "schemaVersion": 1
}
```

- Set `deviceName` in the app's Channels page. New events capture that name when queued; renaming the device does not rename an existing backlog.
- `sessionName` uses a title supplied by the Agent, otherwise its session ID, otherwise an empty string. Hooks do not always expose a conversation title. Unavailable session/turn IDs are empty strings, not fabricated IDs.
- `resultDetails` preserves up to 8,000 characters of the Agent's result, separate from the short summary used by chat channels. It may contain sensitive task output; configure only receivers you trust.
- `status` is `completed`, `failed`, or `needs_input`. `completedAt` is the end time for completed/failed events and `null` while waiting for input. `occurredAt` is always the event time. If a hook does not supply a timestamp, the adapter captures it; direct ingress and older queue files fall back to their queue creation time. Times are UTC ISO 8601, not replay/send times.
- `eventId` is stable across retries and restarts. Delivery is at least once; receivers can use this ID to deduplicate. It identifies the notification event, not the session.
- In the Webhook page, each source field defaults to the identical destination name. Blank destinations also mean identity. A destination such as `data.message` nests the value under `data`. Values retain their original type. Arrays, templates, static fields, omission and type conversion are not supported. Duplicate destinations, parent/child collisions and unsafe object keys are rejected.
- **Restore defaults** resets the mapping draft; save to apply it. **JSON preview** is a synthetic example using the saved device name and sends nothing. Mapping and format changes apply to deliveries that have not yet been sent, including backlog/retries.

Settings example: `channels.webhook.payloadFormat = "standard"` and `channels.webhook.fieldMapping = {"deviceName":"device","resultDetails":"data.message"}`. Environment overrides are `AGENTBUZZER_WEBHOOK_PAYLOAD_FORMAT` and `AGENTBUZZER_WEBHOOK_FIELD_MAPPING` (a JSON object).

The channel/gateway split is informed by [OpenClaw's channel catalog](https://github.com/openclaw/openclaw/blob/main/docs/channels/index.md) and [Hermes's one-shot send interface](https://github.com/nousresearch/hermes-agent/blob/main/website/docs/reference/cli-commands.md). This app implements outbound task notifications, not their full two-way chat gateways.

Settings and queued events are stored under `~/.agent-buzzer`, never in the repository. Existing Feishu settings and legacy credential files are read automatically. New tokens, passwords and webhook URLs are stored in `credentials.json`, encrypted with Windows DPAPI or protected by `0600` user-only file permissions on macOS/Linux (not OS-keychain encryption). With `AGENTBUZZER_CONFIG`, the credential file lives beside that config. Metadata records only which credential fields exist, so settings refreshes and hooks do not decrypt credentials. Legacy plaintext webhook URLs remain readable for compatibility and move to the credential store when edited and saved.

Credential-bearing URLs, tokens and passwords are never returned by the settings API. Non-secret server addresses and recipient IDs remain visible for editing. Environment variables override saved credentials; GUI credential inputs managed by the environment are read-only. Existing `AGENTBUZZER_FEISHU_APP_SECRET`, `AGENTBUZZER_WEBHOOK_URL` and `AGENTBUZZER_SLACK_WEBHOOK_URL` continue to work. Other fields use `AGENTBUZZER_<CHANNEL>_<FIELD>`, for example `AGENTBUZZER_TELEGRAM_BOT_TOKEN`, `AGENTBUZZER_TELEGRAM_CHAT_ID`, or `AGENTBUZZER_EMAIL_PASSWORD`. Clearing a saved credential does not remove an environment variable. The service listens on loopback only and rejects cross-origin browser requests.

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

Hooks wait up to 3 seconds for local service startup, with a shared 5-second budget for startup and event submission, including the response body. An unavailable or unresponsive service falls back to the durable local queue after rechecking notification switches. Remote delivery is not part of this wait; the service acknowledges the persisted event before starting delivery work. The Codex hook keeps its 15-second timeout to leave room for shell/runtime startup. `codex-hook.log` records `started`, `completed` (handler returned), and `exited` (Node actually exited), with process ID and elapsed milliseconds, but no message content or credentials.

## Development

```sh
npm test
npm run stage
npm run build:installers
```

The plugin sources are in `plugins/`; generated plugin copies, staging output, and installers are ignored under `.agents/plugins/agent-buzzer/`, `dist/`, `build/`, and `release/`. The GitHub workflow builds Windows x64 NSIS, macOS x64 and arm64 DMGs, and Linux x64 DEB on native runners.

Nodemailer is explicitly copied into the external service resources because Electron's ASAR dependencies are not available to the bundled standalone Node runtime. The `afterPack` hook checks the actual packaged resources, imports the card and mail modules with the bundled Node, and builds an in-memory MIME message without a network connection. Missing service dependencies fail the installer build.
