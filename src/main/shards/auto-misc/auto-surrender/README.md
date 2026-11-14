# Automatic surrender

The opt-in switch lives under Automation > Miscellaneous. Windows Simplified Chinese OCR runs in
one hidden, persistent Windows PowerShell process. No image or text is sent to a remote service.
Windows must have Simplified Chinese OCR installed, and Akari's native input must be available.

The worker checks the foreground process name before capturing the selected percentage region of
the game's client area. Yellow pixels become black on white, the crop is enlarged, and Windows OCR
recognizes the text. Whitespace and punctuation are normalized before matching `军团同意投降`.
The army name and vote counts do not affect matching. Ordinary victory-progress messages do not match.

Scans run sequentially with a 150 ms gap; there is no frame backlog. The first match consumes the
current game ID before input starts, then sends `/ff` through the in-game send executor. Disabling
the feature, changing the region, leaving the active game/end-transition phases, or changing game ID cancels pending work.
The same warm worker continues through `PreEndOfGame` and `WaitingForStats` so the transition does
not cancel recognition during the surrender animation. It stops at `EndOfGame`.
Toggling the switch cannot resend in a consumed game. A new game ID arms it again. The guarantee is
one attempt per game within the running Akari process, not across application restarts. Input may
still fail and teammates must pass the vote before the game's own deadline.

Recognition requires an active game/end-transition phase and a valid game ID. Spectator mode or
missing gameflow state does not start capture or input. Previously saved always-check preferences
are no longer registered or read and cannot bypass these requirements.

The screenshot must include the visible chat announcement. Divide the game window into four equal
quadrants: the default region is the bottom-left quadrant (x 0%, y 50%, width 50%, height 50%).
Users can draw, move, or resize the selection on the settings preview, or enlarge the editor.
The labeled game window diagram supports selection, keyboard movement, and exact numeric adjustments.
Only percentage coordinates are persisted. Cancel leaves settings unchanged.
Fullscreen
capture, native input, actual game timing, and the packaged app still need an in-game smoke check.

## Verify recognition without sending input

On Windows, pass a screenshot containing the yellow surrender announcement:

```powershell
node src/main/shards/auto-misc/auto-surrender/ocr-smoke.mjs C:/path/to/surrender.png
```

Multiple screenshots can be passed to verify repeated recognition in the same worker. This uses the
production OCR script, asserts that the announcement is recognized, and prints recognition duration.
It does not capture the desktop, change game state, or send keys.

Controller tests cover first-message triggering, once-per-game behavior, new games, late OCR results,
focus loss, cancellation, missing OCR, and sequential scanning. They mock OCR/input and do not prove
that native capture or input works in a running game.

## Auto Accept Surrender

A separate opt-in switch recognizes the Chinese `发起投降` vote panel. It has its own persisted
region, defaulting to the bottom-right quadrant (50%, 50%, 50%, 50%). Include the complete title;
adjust the region if the in-game panel was moved. It uses the same game/session, foreground, native
input, and cancellation checks as Follow Surrender. Spectator mode does not start it.

Vote recognition preserves the image colors and matches the Chinese
surrender title in recognized text (including a known blurred-character OCR variant). Vote-bar colors, counts, and
timer appearance are ignored. Keep chat and unrelated interface text outside the selected region.
The first recognized panel sends `/ff`, which casts a yes vote while a vote is active.
The input executor shares simultaneous `/ff` requests from the two automations.

Scans are sequential with a 250 ms gap, plus capture/OCR duration. The panel is consumed before
input starts, including failed attempts. Switch/region changes and foreground loss do not clear
that latch. Once more than 60 seconds have elapsed since the attempt, the next recognized title
is treated as a new vote, even if the previous title never disappeared. Skipped/background frames
cannot trigger input. A new game ID resets the latch. This state lasts for the Akari process.
The panel does not expose the initiator identity; it detects an active vote, including one started
by the local player. Actual input success and vote timing still require an in-game smoke check.

Verify the production worker with a panel screenshot, or a negative sample containing unrelated text:

```powershell
node src/main/shards/auto-misc/auto-surrender/ocr-smoke.mjs --vote C:/path/to/vote.png
node src/main/shards/auto-misc/auto-surrender/ocr-smoke.mjs --no-vote C:/path/to/unrelated-text.png
```
