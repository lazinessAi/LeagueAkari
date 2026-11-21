# Automatic surrender

One opt-in switch under Automation > Miscellaneous enables both following surrender announcements
and accepting teammate votes. It retains the existing `autoSurrenderEnabled` setting. The former
`autoAcceptSurrenderEnabled` preference is no longer registered or read. Both percentage regions
are retained: chat defaults to the bottom-left quadrant, and the vote panel to the bottom-right.

Windows Simplified Chinese OCR runs in one hidden, persistent PowerShell process. No screenshots
or recognized text are sent to a remote service. Windows must have Chinese OCR installed and the
native input component must be available. Each capture checks that the foreground process is
League of Legends. An active game/end-transition phase and a valid game ID are required;
spectator mode does not start monitoring.

Each scan captures the bounding rectangle of both regions once, then crops the chat and panel from
that same bitmap. Default regions copy only the bottom half of the game window. The crops are
recognized sequentially in one worker, with a 250 ms gap between scans; OCR work remains separate
because the two regions use different preprocessing. Chat mode
filters yellow text and normalizes whitespace/punctuation to find `军团同意投降`; army names and
vote counts are ignored. Panel mode preserves image colors and recognizes `发起投降` (including
a known blurred-character OCR variant). Vote-bar color and counts are irrelevant. Select the
complete panel, including the `你选择…` text shown after voting, and keep chat outside this region.

## Confirming and retrying

- An army surrender announcement starts an initiation round. Send `/ff`, then check fresh panel
  frames. A vote title or the recorded-choice text confirms that a vote exists. If no panel is
  recognized, continue attempting initiation, even if the original chat message has scrolled away.
- A vote title starts an acceptance round. Send `/ff` to vote yes. Only recognizing `你选择…`
  confirms the recorded vote; a successful native input return alone does not confirm it. An
  already visible recorded choice suppresses automatic voting, including a prior manual choice.
- Initiation and acceptance each have a fixed budget of five total attempts per round, including
  input failures/cancellation. Wait at least 1500 ms after input completes before retrying. The
  fifth attempt is still checked for confirmation. At the limit, show a manual-action error and
  keep recognizing so late confirmation can clear it.
- A visible vote takes priority over initiation. One controller/worker prevents competing sends.
  Acceptance retries pause when no vote panel is visible; they never start a new vote from an
  absent panel.

Repeated OCR frames and toggle/region changes preserve the round and its attempt budget. There
is no per-game attempt limit or one-minute voting cooldown. A completed/exhausted chat round can
rearm after its announcement is absent for three seconds; a vote round rearms after the panel
and recorded choice are absent for three seconds. Background/skipped frames reset absence
tracking and cannot prove a new round. A new game ID clears both budgets. State lives only in
the running Akari process. Closing the switch, changing regions, leaving allowed phases, disposing
the shard, or changing games cancels pending recognition/input through generation and abort checks.

The panel cannot identify who initiated the vote. OCR may miss a panel, especially if the region
excludes the title/recorded choice. Actual game timing, native capture/input, and outcome still
require an in-game smoke check. Tests using mocked OCR/input prove orchestration only.

## Recognition smoke checks

```powershell
node src/main/shards/auto-misc/auto-surrender/ocr-smoke.mjs C:/path/to/announcement.png
node src/main/shards/auto-misc/auto-surrender/ocr-smoke.mjs --vote C:/path/to/vote.png
node src/main/shards/auto-misc/auto-surrender/ocr-smoke.mjs --selection C:/path/to/recorded-choice.png
node src/main/shards/auto-misc/auto-surrender/ocr-smoke.mjs --no-vote C:/path/to/unrelated-text.png
node src/main/shards/auto-misc/auto-surrender/ocr-smoke.mjs --pair C:/path/to/full-window-with-chat-and-vote.png
```

These commands use the production worker against supplied image files; they send no keys, capture
no desktop frames, and make no League Client API changes.
`--pair` verifies both default regions cropped from one image; combine with `--selection` to check
an announcement and recorded choice together. Other modes recognize the entire supplied image.
