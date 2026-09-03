# Spell Path — QA Testing Guide

A plain-language guide to how Spell Path, Live Duels, and Spellpath Combat work today — for testers and anyone validating the game.

The app has three modes:

1. **Solo** — play puzzles on your own (default)
2. **Live Duel** — real-time 1v1 race against another player (or a bot)
3. **Spellpath Combat** — share a set of puzzles with others and compete on a leaderboard at your own pace

---

## 1. Spell Path (Solo)

### What the game is

You get a grid with some letter cells (milestones) that spell a target word, plus optional walls between cells.

Your job is to **draw a path** with your finger that:

- Starts on the **first letter** of the word
- Visits the letters **in order** (spelling the word)
- Ends on the **last letter**
- Visits **every cell on the board exactly once**
- Only moves **up, down, left, or right** (no diagonals)
- Never crosses a **wall**

If the path breaks any of those rules, it isn’t a valid solve.

### Difficulty

| Difficulty | Board size | Rough feel |
|---|---|---|
| Easy | 5×5 | Smaller board, fewer walls |
| Medium | 7×7 | Bigger board, some walls |
| Hard | 9×9 | Largest board, more walls |

### Getting a puzzle

From the main screen you can:

- **Generate** — ask the server for a puzzle (can take a while)
- **Build** — get a puzzle built on the fly (usually faster)
- **Reset** — clear your current path and try again
- **Show Solution** — reveal a valid path when one is available

You can also jump into **Live Duel** or **Spellpath Combat** from the header.

### Misses and backtracks

While drawing:

- **Miss** — you try an illegal next move (for example onto a blocked cell, a wall edge, or a non-adjacent cell). The miss count goes up by 1.
- **Backtrack** — you undo by moving back onto the previous cell of your path. The backtrack count goes up by 1.

These don’t stop you from finishing, but they **lower your score** when you solve.

### How scoring works (solo)

You only get a score when the path is a **full valid solve**.

Starting points by difficulty:

- Easy → **5**
- Medium → **7**
- Hard → **9**

Then penalties are applied:

```
Score = starting points − (0.1 × backtracks) − (0.25 × misses)
```

Examples:

- Easy puzzle, 0 misses, 0 backtracks → **5.0**
- Medium puzzle, 2 misses, 1 backtrack → 7 − 0.5 − 0.1 = **6.4**
- Hard puzzle, 4 misses, 10 backtracks → 9 − 1.0 − 1.0 = **7.0**

The score is **not floored at zero** — with enough mistakes it can go negative.

Your session score on the main screen adds up across successful solves.

---

## 2. Live Duels

### What it is

A timed head-to-head race. You and an opponent get the **same sequence of puzzles**. Each of you solves at your own pace. Whoever builds a better score in **2 minutes** wins.

You can also play against a **Bot** if no one is available.

### How a live duel goes

1. Enter a display name and tap **Find Duel**
2. Wait in queue (after a short wait, the app may offer playing a bot)
3. When matched, both players see a **3-2-1 countdown**
4. The match starts — **120 seconds** on the clock
5. Solve as many puzzles as you can before time runs out
6. Results screen shows winner / tie and scores

You can **forfeit** during a match (opponent wins).

### What’s different from solo during a live duel

- The **target word is hidden** — you still follow milestone letters on the board, but you don’t see the word spelled out the same way as in solo
- Puzzles get harder as you progress through the match (early ones easier, later ones harder)
- You’re racing the clock and the opponent at the same time
- Opponent progress can flash when they solve something

### Scoring in live duels

Each puzzle uses the **same scoring idea as solo**:

```
Puzzle points = base for that puzzle’s difficulty − (0.1 × backtracks) − (0.25 × misses)
```

- A **correct** solve adds those points to your total and moves you to the next puzzle
- A **wrong** path does **not** advance you; the attempt is counted against you for tie-breaks
- Your match score is the **sum** of points from puzzles you solved during the 2 minutes

### Who wins

When the match ends, the winner is decided in this order:

1. **Higher total score**
2. If tied → **more puzzles solved**
3. If still tied → **fewer wrong attempts**
4. If still tied → **draw**

### How a match can end

- Timer hits zero
- Someone forfeits
- Someone disconnects for too long (about 30 seconds) during an active human match — that counts as a forfeit for the disconnected player

### Rematch and bot

- After results you can rematch the same opponent (human), find a new duel, or play the bot again
- Bot matches are immediate; the bot “solves” on a timer with approximate scores (not perfect human-style path validation)

Local win / loss / tie stats are kept on the device.

---

## 3. Spellpath Combat (Async)

### What it is

A shared challenge you play **on your own schedule**. Someone creates a combat and gets a short **join code**. Anyone with the code plays the **same 6 puzzles** and lands on a leaderboard.

This is not a live race — no shared countdown against another player while you play.

### The 6-puzzle set

Every combat uses the same difficulty pattern:

1. Easy  
2. Easy  
3. Medium  
4. Medium  
5. Hard  
6. Hard  

Creating a combat may take a while while those puzzles are prepared. Until they’re ready, players wait in the lobby. If preparation fails, the combat shows as failed.

### How a run works

1. Enter (or reuse) your name
2. **Create** a combat, or **join** with a code
3. When ready, start your run
4. Play puzzles in order (1 through 6)
5. On each puzzle you can solve it normally, or **Skip** (that puzzle scores **0**)
6. When all six are done, you see results and the leaderboard

You can leave and come back to an unfinished run — it continues where you left off.

### Scoring in Spellpath Combat

Same formula as solo for each puzzle you actually solve:

```
Puzzle points = base − (0.1 × backtracks) − (0.25 × misses)
```

Skipped puzzles = **0**.

Your run total = sum of all six puzzle scores. Time taken is also tracked and used for champion tie-breaks.

### Champion and leaderboard

- The **champion** is the best completed run on that combat so far
- Best means **highest total score**; if scores are equal, the **faster** total time wins
- After you finish you can see whether you beat the champion or became the new champion
- Solutions for the puzzles are only revealed after you’ve completed your full run

---

## 4. Quick comparison

| | Solo | Live Duel | Spellpath Combat |
|---|---|---|---|
| Pace | Your own time | 2-minute race | Your own time |
| Opponent | None | 1 other player or bot | Shared board / leaderboard |
| Word shown | Yes | Hidden | Yes |
| Skip | — | No | Yes |
| Goal | Personal score | Beat opponent in 2 minutes | Beat champion / climb board |

---

## 5. Things to check while testing

### Solo

- Easy / Medium / Hard feel appropriately harder (bigger boards, more walls)
- Misses and backtracks increase for the right actions
- Valid full path gets a score; incomplete or illegal path does not
- Score matches: base − 0.1×backtracks − 0.25×misses
- Generate and Build both produce playable puzzles
- Reset and Show Solution behave as expected
- Switching modes doesn’t break the app

### Live Duel

- Two players can match, countdown, and play together
- Match lasts about 2 minutes
- Correct solves advance only that player
- Wrong solves don’t advance
- Opponent score updates are visible
- Word is not shown during live play
- Later puzzles feel harder than early ones
- Forfeit and disconnect handling work as described
- Bot match and rematch options work
- Results correctly show win / loss / tie

### Spellpath Combat

- Create and join by code both work
- Lobby waits while puzzles prepare, then allows play
- You play exactly 6 puzzles in order
- Skip gives 0 and moves on
- Finished run shows totals and leaderboard
- Higher score (or same score, faster time) becomes champion
- Solutions appear only after a full completed run

### General notes

- Live and Combat matches live on the server memory — if the server restarts, open matches/codes can disappear
- Generate / Combat puzzle prep can be slow when the AI puzzle service is busy or unavailable

---

*Written for QA handoff — focuses on gameplay and scoring, not implementation details.*
