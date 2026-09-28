# AgentBuzzer

AgentBuzzer sends a short Feishu interactive card when Codex, GitHub Copilot CLI, or Hermes Agent finishes a turn or requests human approval. Each card shows the Agent and the local device name. Feishu is the only delivery channel in this version.

## Requirements

- Node.js 20 or newer on each device.
- A Feishu app with bot capability and permission to send messages (`im:message`). The bot must be allowed to send to the chosen `chat_id` or `open_id`.
- A recipient ID. App ID and App Secret alone cannot identify the recipient.

## Configure This Device

Run these commands from the repository root, changing the device name and recipient on each computer:

```powershell
node bin/agent-buzzer.mjs set-device Haipw-PC
node bin/agent-buzzer.mjs set-app-id <feishu-app-id>
node bin/agent-buzzer.mjs set-recipient chat_id <feishu-chat-id>
```

On Windows, enter the App Secret without putting it in the repository or shell history:

```powershell
$secure = Read-Host 'Feishu App Secret' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | node bin/agent-buzzer.mjs store-secret
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
```

The secret is encrypted for the current Windows user with DPAPI in `~/.agent-buzzer/feishu-secret.dpapi`. Device name, App ID and recipient are in `~/.agent-buzzer/config.json`; neither file is inside this repository. On other platforms, set `AGENTBUZZER_FEISHU_APP_ID`, `AGENTBUZZER_FEISHU_APP_SECRET`, `AGENTBUZZER_FEISHU_RECEIVE_ID`, `AGENTBUZZER_FEISHU_RECEIVE_ID_TYPE`, and optionally `AGENTBUZZER_DEVICE_NAME` in the Agent's environment.

Verify configuration and deliver a real test card:

```powershell
node bin/agent-buzzer.mjs doctor
node bin/agent-buzzer.mjs check-token
node bin/agent-buzzer.mjs test-card
```

To inspect the JSON without sending, use `test-card --dry-run`.

## Install

```powershell
npm run install:local
```

The installer packages three native adapters, registers a local Codex marketplace plugin, installs a Copilot CLI plugin, copies a Hermes plugin under `HERMES_HOME/plugins` (or `~/.hermes/plugins`), and enables it. It only manages the `agent-buzzer` plugin. It leaves other plugins and existing Codex notification settings alone. After changing the source, run `npm run install:local -- --force` to replace this plugin's installed copies.

- **Codex:** Review and trust the two new hooks in `/hooks` when prompted. The installed package includes `Stop` and `PermissionRequest`. Existing `notify` settings are not changed. Restart the desktop app to pick up newly installed hooks.
- **Copilot CLI:** The package includes `agentStop` and `notification` hooks. The latter filters `permission_prompt` and `elicitation_dialog`. Native CLI plugin installs from local paths currently work but are deprecated upstream; future versions may need a plugin marketplace.
- **Hermes:** A new CLI, TUI, Desktop, or gateway session picks up the enabled plugin. It observes `post_llm_call`, failed/interrupted `on_session_end`, and `pre_approval_request`.

Copilot's standalone desktop app uses the CLI/SDK runtime, but its execution of installed CLI hooks has not been verified in this project. The Copilot CLI path has been tested end to end.

## Behavior

The card contains the Agent, device name, completion/waiting/failure status, and at most 160 characters of the final reply or approval reason. `Stop` and `agentStop` represent a completed **turn**, not necessarily the end of a multi-turn project. A final answer that asks a question still sends a completion card with the question in its summary. Explicit approval/elicitation events send a separate waiting card. The card is sent as Feishu `msg_type: interactive` with Card JSON 2.0. A task URL, when available, adds an open-link button; no inactive buttons are displayed otherwise.

Notification delivery is best effort. If the machine loses power or the Feishu API is unavailable when a Hook runs, the Hook does not persist a retry queue. Avoid including secrets in agent replies: the short summary is sent to the configured Feishu conversation.

## Development

```powershell
npm test
npm run pack:plugins
```

The source adapters live in `plugins/`, the shared Feishu sender in `src/`, and the generated local plugin bundles in ignored directories under `dist/` and `.agents/plugins/agent-buzzer/`. No Feishu credentials belong in source control.
