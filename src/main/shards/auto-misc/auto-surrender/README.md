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

The optional **Always Check** switch bypasses gameflow and game-ID requirements for both recognition
and `/ff` keyboard input. It still captures and sends only while the League of Legends game window
is foreground. This supports spectator recognition tests and missing LCU state; spectating itself
cannot surrender. In this mode the worker keeps scanning through stage changes and after a match.
The captured process ID plus start time identifies a game process, preventing repeated attempts
even after toggling settings and allowing a new process to arm without a game ID. The option is
disabled by default and persisted. Disabling it cancels pending recognition/input immediately.

The screenshot must include the visible chat announcement. Divide the game window into four equal
quadrants: the default region is the bottom-left quadrant (x 0%, y 50%, width 50%, height 50%).
Users can adjust this for relocated chat. Fullscreen
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
