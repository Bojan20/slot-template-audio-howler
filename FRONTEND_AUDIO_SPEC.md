# Frontend Audio Implementation Spec
## Slot Game — Definitive Audio Architecture

Version: 1.0
Author: Audio Team
Target: Frontend Development Team

---

## Table of Contents

1. [Overview](#1-overview)
2. [Audio File Structure](#2-audio-file-structure)
3. [Howler.js Configuration](#3-howlerjs-configuration)
4. [Tier-Based Deferred Loading](#4-tier-based-deferred-loading)
5. [Loading Implementation](#5-loading-implementation)
6. [Music Layer System](#6-music-layer-system)
7. [Audio Warmup](#7-audio-warmup)
8. [AudioContext Lifecycle](#8-audiocontext-lifecycle)
9. [iOS Safari Handling](#9-ios-safari-handling)
10. [Playback & Command System](#10-playback--command-system)
11. [Error Handling & Recovery](#11-error-handling--recovery)
12. [Memory Management](#12-memory-management)
13. [Server Requirements](#13-server-requirements)
14. [Caching Strategy](#14-caching-strategy)
15. [Tab Visibility Handling](#15-tab-visibility-handling)
16. [Pool Configuration](#16-pool-configuration)
17. [QA Checklist for Frontend](#17-qa-checklist-for-frontend)
18. [Known Howler.js Issues & Workarounds](#18-known-howlerjs-issues--workarounds)
19. [Complete Integration Example](#19-complete-integration-example)

---

## 1. Overview

Audio assets are delivered as:

- **Audio sprites** (M4A) — multiple short sounds packed into a single file with timing offsets
- **Standalone music files** (M4A) — individual music layers for synchronized layered playback
- **sounds.json** — manifest, sprite definitions, sprite lists, and command definitions

The frontend is responsible for:

- Loading audio files according to the tier priority system
- Implementing deferred/lazy loading for non-critical assets
- Handling music layer synchronization
- Managing AudioContext lifecycle
- Error recovery and retry logic
- Memory management

---

## 2. Audio File Structure

### Delivered in `dist/` folder:

```
dist/
  sounds.json
  soundFiles/
    {gameName}_boot_sprite.m4a          (< 500 KB)
    {gameName}_reel_win_sprite.m4a      (< 1.5 MB)
    {gameName}_bigwin_sprite.m4a        (< 1.5 MB)
    {gameName}_bonus_sprite.m4a         (< 1.5 MB)
    {gameName}_BaseMusicLoop_L1.m4a     (standalone music layer)
    {gameName}_BaseMusicLoop_L2.m4a     (standalone music layer)
    {gameName}_BaseMusicLoop_L3.m4a     (standalone music layer)
    {gameName}_BonusMusicLoop_L1.m4a    (standalone music layer)
    ...
```

### File types:

| Type | Format | Encoding | Bitrate | Channels |
|------|--------|----------|---------|----------|
| SFX sprites | M4A | AAC-LC | 48–64 kbps | Mono |
| Music layers | M4A | AAC-LC | 96–128 kbps | Stereo |

### sounds.json structure:

```json
{
  "soundManifest": [
    {"id": "gameName_boot_sprite", "src": ["soundFiles/gameName_boot_sprite.m4a"], "tier": 1},
    {"id": "gameName_reel_win_sprite", "src": ["soundFiles/gameName_reel_win_sprite.m4a"], "tier": 2},
    {"id": "gameName_bigwin_sprite", "src": ["soundFiles/gameName_bigwin_sprite.m4a"], "tier": 3},
    {"id": "gameName_bonus_sprite", "src": ["soundFiles/gameName_bonus_sprite.m4a"], "tier": 4},
    {"id": "gameName_BaseMusicLoop_L1", "src": ["soundFiles/gameName_BaseMusicLoop_L1.m4a"], "tier": 5, "music": true},
    {"id": "gameName_BaseMusicLoop_L2", "src": ["soundFiles/gameName_BaseMusicLoop_L2.m4a"], "tier": 5, "music": true}
  ],
  "soundDefinitions": {
    "soundSprites": { ... },
    "spriteList": { ... },
    "commands": { ... }
  }
}
```

---

## 3. Howler.js Configuration

### SFX Sprites — Web Audio mode (mandatory)

```javascript
const sprite = new Howl({
  src: ['soundFiles/gameName_boot_sprite.m4a'],
  sprite: {
    UiSpin: [0, 1608],
    UiSpinSlam: [1658, 900],
    ReelLand: [2608, 186],
    // ... from sounds.json soundSprites where soundId matches
  },
  html5: false,     // MANDATORY — Web Audio for sprites
  preload: true,    // depends on tier (see Section 4)
  pool: 5           // depends on sound (see Section 16)
});
```

**CRITICAL: Never use `html5: true` for sprites.** HTML5 Audio mode has known timing inaccuracies with sprites — sounds play longer than their defined duration and bleed into adjacent sounds. This is a documented Howler.js bug (GitHub Issue #826). Sprites MUST use Web Audio mode.

### Music Layers — Web Audio mode (recommended for sync)

```javascript
const musicLayer = new Howl({
  src: ['soundFiles/gameName_BaseMusicLoop_L1.m4a'],
  html5: false,     // Web Audio — required for sample-accurate layer sync
  loop: true,
  volume: 1,
  preload: false    // deferred loading
});
```

**Why Web Audio for music layers:** HTML5 Audio elements have independent timing — there is no shared clock between elements. Multiple HTML5 Audio play() calls introduce variable millisecond delays, causing layers to drift out of sync. Web Audio mode uses a single AudioContext with a shared `currentTime` clock that enables sample-accurate scheduling.

**Trade-off:** Web Audio decodes the entire file into PCM memory. A 60-second stereo track at 44.1 kHz = ~21 MB RAM. With 4 layers = ~84 MB. This is acceptable on desktop but may be problematic on low-end mobile devices. See Section 12 for memory management strategies.

**Alternative — HTML5 mode for memory-constrained devices:**

If memory is critical (low-end mobile, many music layers), HTML5 mode can be used as a fallback with the understanding that sync will be approximate (±5-50ms drift):

```javascript
const musicLayer = new Howl({
  src: ['soundFiles/gameName_BaseMusicLoop_L1.m4a'],
  html5: true,      // Streaming — lower memory
  loop: true,
  volume: 1,
  preload: false
});
```

Decision matrix:

| Scenario | Mode | Sync accuracy | Memory per layer (60s stereo) |
|----------|------|---------------|-------------------------------|
| Desktop, any number of layers | Web Audio | Perfect | ~21 MB |
| Mobile, 1-2 layers | Web Audio | Perfect | ~21 MB |
| Mobile, 3-4 layers | HTML5 fallback | ±5-50ms drift | ~100 KB |

---

## 4. Tier-Based Deferred Loading

Audio assets are organized into tiers by priority. The `tier` field in `soundManifest` entries indicates loading priority.

| Tier | Name | Contents | Loading Strategy | Target |
|------|------|----------|-----------------|--------|
| 1 | BOOT | UI sounds, ReelLand, Payline, BaseGameStart, RollupLow | `preload: true` — load immediately, blocking | Must be ready before first spin |
| 2 | GAMEPLAY | Symbol wins, Rollup, ScreenShake, Preshow | `preload: false` — load in idle time | Must be ready within 5s of game start |
| 3 | BIGWIN | BigWin, Anticipation, SymbolB01 lands, PreBonusLoop | `preload: false` — load in idle time | Should be ready within 10s |
| 4 | BONUS | Bonus music, Bonus SFX, Picker, Transitions | `preload: false` — load on demand | Load when bonus becomes possible |
| 5 | MUSIC | Base music layers, Bonus music layers | `preload: false` — load after Tier 1 ready | Stream or decode based on device capability |

### Loading timeline:

```
Game Load Start
  |
  |-- [Tier 1] boot_sprite preload: true (blocking)
  |
  v
Loading Screen Complete / First Spin Available
  |
  |-- [Tier 5] Music layers begin loading (needed for first spin ambiance)
  |-- [Tier 2] reel_win_sprite load via requestIdleCallback
  |
  v
Idle Period (player adjusting bet, reading paytable)
  |
  |-- [Tier 3] bigwin_sprite load via requestIdleCallback
  |
  v
Gameplay (scatter/bonus symbols appear on reels)
  |
  |-- [Tier 4] bonus_sprite load on demand (2+ scatters landed)
  |
  v
All audio loaded
```

---

## 5. Loading Implementation

### AudioLoadManager class:

```javascript
class AudioLoadManager {
  constructor() {
    this.howls = new Map();         // id -> Howl instance
    this.loadQueue = [];            // {howl, tier, id}
    this.isProcessing = false;
    this.loadedTiers = new Set();
    this.onTierLoaded = null;       // callback(tier)
  }

  // ── Register a Howl instance with its tier ──────────────
  register(id, howl, tier) {
    this.howls.set(id, { howl, tier, state: 'registered' });
  }

  // ── Initialize loading sequence ────────────────────────
  start() {
    // Tier 1: already preloading (preload: true)
    // Verify Tier 1 is loaded, then proceed
    const tier1Howls = this.getHowlsByTier(1);
    const tier1Promises = tier1Howls.map(({ id, howl }) => {
      return new Promise((resolve) => {
        if (howl.state() === 'loaded') {
          resolve();
        } else {
          howl.once('load', resolve);
          howl.once('loaderror', (soundId, err) => {
            console.error(`Tier 1 load failed: ${id}`, err);
            this.retryLoad(howl, id, 3);
            howl.once('load', resolve);
          });
        }
      });
    });

    Promise.all(tier1Promises).then(() => {
      this.loadedTiers.add(1);
      if (this.onTierLoaded) this.onTierLoaded(1);

      // Start music layers (Tier 5) — needed soon for base game ambiance
      this.loadTier(5);

      // Queue Tier 2, 3 for idle loading
      this.queueForIdle(2);
      this.queueForIdle(3);
    });
  }

  // ── Load a specific tier immediately ───────────────────
  loadTier(tier) {
    const howls = this.getHowlsByTier(tier);
    howls.forEach(({ id, howl }) => {
      if (howl.state() === 'unloaded') {
        howl.load();
        howl.once('load', () => {
          this.checkTierComplete(tier);
        });
        howl.once('loaderror', (soundId, err) => {
          console.error(`Tier ${tier} load failed: ${id}`, err);
          this.retryLoad(howl, id, 3);
        });
      }
    });
  }

  // ── Queue a tier for idle-time loading ─────────────────
  queueForIdle(tier) {
    const howls = this.getHowlsByTier(tier);
    howls.forEach(({ id, howl }) => {
      this.loadQueue.push({ howl, tier, id });
    });
    this.loadQueue.sort((a, b) => a.tier - b.tier);
    if (!this.isProcessing) this.processIdleQueue();
  }

  // ── Process queue during idle time ─────────────────────
  processIdleQueue() {
    if (this.loadQueue.length === 0) {
      this.isProcessing = false;
      return;
    }
    this.isProcessing = true;
    const { howl, tier, id } = this.loadQueue.shift();

    if (howl.state() !== 'unloaded') {
      // Already loaded or loading — skip
      this.processIdleQueue();
      return;
    }

    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback((deadline) => {
        howl.load();
        howl.once('load', () => {
          this.checkTierComplete(tier);
          this.processIdleQueue();
        });
        howl.once('loaderror', (soundId, err) => {
          console.error(`Idle load failed: ${id}`, err);
          this.retryLoad(howl, id, 3);
          this.processIdleQueue();
        });
      }, { timeout: 5000 });
    } else {
      // Fallback for browsers without requestIdleCallback (Safari)
      setTimeout(() => {
        howl.load();
        howl.once('load', () => {
          this.checkTierComplete(tier);
          this.processIdleQueue();
        });
        howl.once('loaderror', (soundId, err) => {
          console.error(`Idle load failed: ${id}`, err);
          this.retryLoad(howl, id, 3);
          this.processIdleQueue();
        });
      }, 100);
    }
  }

  // ── Urgent load — preempt queue ────────────────────────
  //    Call this when a sound is needed NOW but its tier
  //    hasn't loaded yet (e.g., unexpected bonus trigger)
  urgentLoad(id) {
    const entry = this.howls.get(id);
    if (!entry) return null;
    const { howl } = entry;

    // Remove from idle queue if present
    this.loadQueue = this.loadQueue.filter(item => item.id !== id);

    if (howl.state() === 'unloaded') {
      howl.load();
    }
    return howl;
  }

  // ── Retry logic ────────────────────────────────────────
  retryLoad(howl, id, maxRetries, attempt = 1) {
    if (attempt > maxRetries) {
      console.error(`Audio load permanently failed after ${maxRetries} retries: ${id}`);
      return;
    }
    const delay = Math.min(500 * Math.pow(2, attempt - 1), 5000); // 500, 1000, 2000, max 5000
    setTimeout(() => {
      console.warn(`Retry ${attempt}/${maxRetries} for: ${id}`);
      howl.load();
      howl.once('loaderror', () => {
        this.retryLoad(howl, id, maxRetries, attempt + 1);
      });
    }, delay);
  }

  // ── Helpers ────────────────────────────────────────────
  getHowlsByTier(tier) {
    const result = [];
    this.howls.forEach(({ howl, tier: t }, id) => {
      if (t === tier) result.push({ id, howl });
    });
    return result;
  }

  checkTierComplete(tier) {
    const howls = this.getHowlsByTier(tier);
    const allLoaded = howls.every(({ howl }) => howl.state() === 'loaded');
    if (allLoaded && !this.loadedTiers.has(tier)) {
      this.loadedTiers.add(tier);
      if (this.onTierLoaded) this.onTierLoaded(tier);
    }
  }

  isTierLoaded(tier) {
    return this.loadedTiers.has(tier);
  }
}
```

---

## 6. Music Layer System

### Architecture

Music layers are individual M4A files that play simultaneously in perfect sync. The number of layers varies per game (1–4 for base game, 1–4 for bonus).

All layers of the same music group:
- Are the exact same duration
- Start at the exact same time
- Loop indefinitely
- Have independent volume control (for dynamic mixing)

### Implementation — Web Audio mode (recommended):

```javascript
class MusicLayerManager {
  constructor() {
    this.groups = new Map();  // groupName -> { layers: [], playing: false }
  }

  // ── Register a music group ─────────────────────────────
  //    Call once per group during initialization
  registerGroup(groupName, layerConfigs) {
    // layerConfigs: [{ id, src, volume }]
    const layers = layerConfigs.map(config => ({
      id: config.id,
      howl: new Howl({
        src: [config.src],
        html5: false,       // Web Audio for sync
        loop: true,
        volume: config.volume || 1,
        preload: false
      }),
      targetVolume: config.volume || 1
    }));

    this.groups.set(groupName, { layers, playing: false });
  }

  // ── Load all layers in a group ─────────────────────────
  load(groupName) {
    const group = this.groups.get(groupName);
    if (!group) return Promise.reject(`Unknown group: ${groupName}`);

    const promises = group.layers.map(layer => {
      return new Promise((resolve, reject) => {
        if (layer.howl.state() === 'loaded') {
          resolve();
        } else {
          layer.howl.load();
          layer.howl.once('load', resolve);
          layer.howl.once('loaderror', (id, err) => reject(err));
        }
      });
    });

    return Promise.all(promises);
  }

  // ── Start all layers in sync ───────────────────────────
  //    MUST be called after all layers are loaded
  play(groupName) {
    const group = this.groups.get(groupName);
    if (!group) return;
    if (group.playing) return;

    // Verify all loaded
    const allLoaded = group.layers.every(l => l.howl.state() === 'loaded');
    if (!allLoaded) {
      console.error(`Cannot play ${groupName}: not all layers loaded`);
      return;
    }

    // Start all layers in a single requestAnimationFrame
    // to minimize scheduling jitter
    requestAnimationFrame(() => {
      group.layers.forEach(layer => {
        layer.howl.play();
      });
      group.playing = true;
    });
  }

  // ── Stop all layers ────────────────────────────────────
  stop(groupName) {
    const group = this.groups.get(groupName);
    if (!group) return;

    group.layers.forEach(layer => {
      layer.howl.stop();
    });
    group.playing = false;
  }

  // ── Fade a single layer volume ─────────────────────────
  //    Use this for dynamic layer mixing during gameplay
  fadeLayer(groupName, layerId, targetVolume, duration) {
    const group = this.groups.get(groupName);
    if (!group) return;

    const layer = group.layers.find(l => l.id === layerId);
    if (!layer) return;

    layer.howl.fade(layer.howl.volume(), targetVolume, duration);
    layer.targetVolume = targetVolume;
  }

  // ── Fade entire group ──────────────────────────────────
  fadeGroup(groupName, targetVolume, duration) {
    const group = this.groups.get(groupName);
    if (!group) return;

    group.layers.forEach(layer => {
      layer.howl.fade(layer.howl.volume(), targetVolume, duration);
    });
  }

  // ── Crossfade between two groups ───────────────────────
  //    e.g., base game music -> bonus music
  crossfade(fromGroup, toGroup, duration) {
    this.fadeGroup(fromGroup, 0, duration);

    // Load and start the target group
    this.load(toGroup).then(() => {
      this.play(toGroup);
      this.fadeGroup(toGroup, 1, duration);
    });

    // Stop the old group after fade completes
    setTimeout(() => {
      this.stop(fromGroup);
    }, duration + 100);
  }

  // ── Unload a group to free memory ──────────────────────
  unload(groupName) {
    const group = this.groups.get(groupName);
    if (!group) return;

    group.layers.forEach(layer => {
      layer.howl.unload();
    });
    group.playing = false;
  }
}
```

### Usage example:

```javascript
const musicManager = new MusicLayerManager();

// Register base game music (3 layers)
musicManager.registerGroup('baseMusic', [
  { id: 'L1', src: 'soundFiles/gameName_BaseMusicLoop_L1.m4a', volume: 1 },
  { id: 'L2', src: 'soundFiles/gameName_BaseMusicLoop_L2.m4a', volume: 0.7 },
  { id: 'L3', src: 'soundFiles/gameName_BaseMusicLoop_L3.m4a', volume: 0 }
]);

// Register bonus music (2 layers)
musicManager.registerGroup('bonusMusic', [
  { id: 'L1', src: 'soundFiles/gameName_BonusMusicLoop_L1.m4a', volume: 1 },
  { id: 'L2', src: 'soundFiles/gameName_BonusMusicLoop_L2.m4a', volume: 0.5 }
]);

// On game start: load and play base music
musicManager.load('baseMusic').then(() => {
  musicManager.play('baseMusic');
});

// During big win: bring in Layer 3 for intensity
musicManager.fadeLayer('baseMusic', 'L3', 1, 500);

// On bonus trigger: crossfade to bonus music
musicManager.crossfade('baseMusic', 'bonusMusic', 1000);

// On bonus end: crossfade back
musicManager.crossfade('bonusMusic', 'baseMusic', 1000);

// After crossfade: unload bonus music to free memory
setTimeout(() => musicManager.unload('bonusMusic'), 2000);
```

---

## 7. Audio Warmup

### Why warmup is needed

Browsers delay the internal decoding pipeline until the first playback of a given audio buffer. This means the first time a specific sound plays, there can be a 50–300ms delay while the browser initializes its decoder.

For sounds that must respond instantly (anticipation during reel spin, big win celebration), this delay is unacceptable.

### Implementation

The `onGameInit` command in sounds.json includes warmup entries. Execute all `onGameInit` commands immediately after the AudioContext is unlocked and Tier 1 audio is loaded:

```javascript
function executeWarmup(soundManager) {
  const warmupCommands = soundsJson.soundDefinitions.commands.onGameInit;

  warmupCommands.forEach(cmd => {
    if (cmd.command === 'Play' && cmd.volume === 0) {
      // This is a warmup command — play at zero volume, then stop
      const soundId = soundManager.play(cmd.spriteId, { volume: 0 });
      if (soundId !== null) {
        // Stop after a minimal duration (10ms is enough to warm the decoder)
        setTimeout(() => {
          soundManager.stop(cmd.spriteId, soundId);
        }, 10);
      }
    } else {
      // Normal init command (e.g., Set volume)
      soundManager.executeCommand(cmd);
    }
  });
}
```

### Warmup commands in sounds.json:

```json
"onGameInit": [
  {"command": "Set", "spriteId": "s_BaseMusicLoop", "volume": 1},
  {"command": "Play", "spriteId": "s_SymbolB01Anticipation", "volume": 0},
  {"command": "Stop", "spriteId": "s_SymbolB01Anticipation"},
  {"command": "Play", "spriteId": "s_BigWinStart", "volume": 0},
  {"command": "Stop", "spriteId": "s_BigWinStart"},
  {"command": "Play", "spriteId": "s_BonusRetrigger", "volume": 0},
  {"command": "Stop", "spriteId": "s_BonusRetrigger"}
]
```

Warmup entries are identifiable by `"volume": 0` followed by a `"Stop"` for the same spriteId.

---

## 8. AudioContext Lifecycle

### Howler.js uses a single global AudioContext

Accessible as `Howler.ctx`. Created once, reused by all Web Audio mode Howl instances. HTML5 mode instances do not use it.

### AudioContext states:

| State | Meaning | Action |
|-------|---------|--------|
| `"suspended"` | Created but not yet activated, or manually suspended | Call `Howler.ctx.resume()` on user interaction |
| `"running"` | Normal operation | No action needed |
| `"interrupted"` | External interruption (phone call, iOS lock screen, laptop lid) | Attempt `resume()`, may need to wait for OS |
| `"closed"` | Permanently closed | Cannot recover — should never happen during gameplay |

### Required initialization:

```javascript
function initAudioContext() {
  // Ensure context exists
  if (!Howler.ctx) {
    // Creating any Howl instance triggers context creation
    return;
  }

  // Listen for state changes
  Howler.ctx.addEventListener('statechange', handleContextStateChange);
}

function handleContextStateChange() {
  const state = Howler.ctx.state;

  switch (state) {
    case 'suspended':
      // Needs user gesture to resume
      registerResumeOnInteraction();
      break;

    case 'interrupted':
      // iOS: phone call, Siri, etc.
      // Attempt resume — may work immediately or after interruption ends
      Howler.ctx.resume().catch(() => {
        // Will retry on next user interaction
        registerResumeOnInteraction();
      });
      break;

    case 'running':
      // All good — remove any pending resume listeners
      removeResumeListeners();
      break;

    case 'closed':
      // Fatal — should not happen
      console.error('AudioContext closed unexpectedly');
      break;
  }
}

// ── Resume helpers ───────────────────────────────────────
let resumeListenerAttached = false;

function registerResumeOnInteraction() {
  if (resumeListenerAttached) return;
  resumeListenerAttached = true;

  const events = ['touchstart', 'touchend', 'click', 'keydown'];
  const resume = () => {
    if (Howler.ctx && Howler.ctx.state !== 'running') {
      Howler.ctx.resume().then(() => {
        removeResumeListeners();
      });
    }
  };

  events.forEach(e => document.addEventListener(e, resume, { passive: true }));

  // Store reference for cleanup
  window._audioResumeHandler = { events, handler: resume };
}

function removeResumeListeners() {
  if (!window._audioResumeHandler) return;
  const { events, handler } = window._audioResumeHandler;
  events.forEach(e => document.removeEventListener(e, handler));
  resumeListenerAttached = false;
  window._audioResumeHandler = null;
}
```

---

## 9. iOS Safari Handling

### Autoplay policy

Audio cannot start without user interaction on iOS. The AudioContext starts in `"suspended"` state.

**Required:** Call `Howler.ctx.resume()` inside a user gesture event handler (touchstart, touchend, click). Howler.js does this automatically via its internal unlock mechanism, but verify it works in your integration.

### HTML5 Audio pool

Howler maintains a global pool of pre-unlocked HTML5 Audio elements (default: 10). These are created on the first user gesture. If the pool is exhausted, Howler returns a potentially locked audio object that may fail to play silently.

```javascript
// Increase pool size if using many HTML5 mode sounds
Howler.html5PoolSize = 20;
```

For sprite-based audio (Web Audio mode), this pool is not relevant.

### Background tab / lock screen

Audio stops when the iOS device locks or the tab goes to background. This is an OS-level restriction — no workaround exists for web apps.

Recovery after returning to foreground:

```javascript
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    // Tab is visible again
    if (Howler.ctx && Howler.ctx.state !== 'running') {
      Howler.ctx.resume().then(() => {
        // Restart any music that should be playing
        restoreAudioState();
      });
    }
  }
});
```

### Phone call / Siri interruption

AudioContext enters `"interrupted"` state. Handle via the `statechange` listener in Section 8.

### iOS 17.4 known issue

HTML5 mode was broken entirely in iOS 17.4 (audio would not play). Fixed by Apple in iOS 17.5. Large files (>2 min) in Web Audio mode would remain in `'unloaded'` state indefinitely on iOS 17.4.

**Mitigation:** Keep audio files reasonably sized. Music layers should be 30–90 seconds (shorter loops are smaller and load faster).

---

## 10. Playback & Command System

### Command types in sounds.json:

| Command | Parameters | Behavior |
|---------|-----------|----------|
| `Play` | `spriteId`, `volume?`, `loop?`, `delay?`, `pan?`, `cancelDelay?` | Play the specified sound |
| `Stop` | `spriteId`, `cancelDelay?` | Stop the specified sound |
| `Fade` | `spriteId`, `volume`, `duration`, `delay?` | Fade volume over duration |
| `Pause` | `spriteId`, `delay?` | Pause playback (resumable) |
| `Set` | `spriteId`, `volume` | Set volume without fade |
| `Execute` | `commandId` | Execute another command by reference |
| `ResetSpriteList` | `spriteListId`, `delay?` | Reset sprite list index |

### Command executor:

```javascript
class CommandExecutor {
  constructor(soundManager) {
    this.soundManager = soundManager;
    this.pendingTimeouts = new Map(); // spriteId -> [timeoutIds]
  }

  execute(commandId) {
    const commands = soundsJson.soundDefinitions.commands[commandId];
    if (!commands) {
      console.warn(`Unknown command: ${commandId}`);
      return;
    }

    commands.forEach(cmd => this.executeOne(cmd));
  }

  executeOne(cmd) {
    const delay = cmd.delay || 0;

    // Cancel pending delays for this sprite if requested
    if (cmd.cancelDelay === 'true' || cmd.cancelDelay === true) {
      this.cancelDelays(cmd.spriteId || cmd.spriteListId);
    }

    if (delay > 0) {
      const timeoutId = setTimeout(() => {
        this.executeImmediate(cmd);
        this.removeTimeout(cmd.spriteId, timeoutId);
      }, delay);
      this.addTimeout(cmd.spriteId, timeoutId);
    } else {
      this.executeImmediate(cmd);
    }
  }

  executeImmediate(cmd) {
    switch (cmd.command) {
      case 'Play':
        this.soundManager.play(cmd.spriteId, {
          volume: cmd.volume !== undefined ? cmd.volume : 1,
          loop: cmd.loop === -1,
          pan: cmd.pan || 0
        });
        break;

      case 'Stop':
        this.soundManager.stop(cmd.spriteId);
        break;

      case 'Fade':
        this.soundManager.fade(cmd.spriteId, cmd.volume, cmd.duration);
        break;

      case 'Pause':
        this.soundManager.pause(cmd.spriteId);
        break;

      case 'Set':
        this.soundManager.setVolume(cmd.spriteId, cmd.volume);
        break;

      case 'Execute':
        this.execute(cmd.commandId);
        break;

      case 'ResetSpriteList':
        this.soundManager.resetSpriteList(cmd.spriteListId);
        break;
    }
  }

  cancelDelays(spriteId) {
    const timeouts = this.pendingTimeouts.get(spriteId);
    if (timeouts) {
      timeouts.forEach(id => clearTimeout(id));
      this.pendingTimeouts.delete(spriteId);
    }
  }

  addTimeout(spriteId, timeoutId) {
    if (!this.pendingTimeouts.has(spriteId)) {
      this.pendingTimeouts.set(spriteId, []);
    }
    this.pendingTimeouts.get(spriteId).push(timeoutId);
  }

  removeTimeout(spriteId, timeoutId) {
    const timeouts = this.pendingTimeouts.get(spriteId);
    if (timeouts) {
      const idx = timeouts.indexOf(timeoutId);
      if (idx !== -1) timeouts.splice(idx, 1);
    }
  }

  // Cancel ALL pending delays (call on game state reset)
  cancelAll() {
    this.pendingTimeouts.forEach(timeouts => {
      timeouts.forEach(id => clearTimeout(id));
    });
    this.pendingTimeouts.clear();
  }
}
```

### Sprite lists:

Sprite lists play multiple sounds in sequence or randomly. From sounds.json:

```json
"spriteList": {
  "sl_SymbolPreshow": {
    "items": ["s_SymbolPreshow1", "s_SymbolPreshow2", "s_SymbolPreshow3"],
    "type": "sequential",
    "overlap": true
  }
}
```

Track the current index for sequential lists. Reset on `ResetSpriteList` command.

---

## 11. Error Handling & Recovery

### Howler.js error events:

| Event | Trigger | Callback |
|-------|---------|----------|
| `loaderror` | Network failure, decode failure, unsupported format | `function(soundId, errorCode)` |
| `playerror` | Autoplay blocked, AudioContext suspended | `function(soundId, errorCode)` |

### Error codes for loaderror:

| Code | Meaning |
|------|---------|
| 0 | Web Audio decodeAudioData failed |
| 1 | MEDIA_ERR_ABORTED — fetch aborted |
| 2 | MEDIA_ERR_NETWORK — network error |
| 3 | MEDIA_ERR_DECODE — decoding failed |
| 4 | MEDIA_ERR_SRC_NOT_SUPPORTED — format not supported |

### Error handling implementation:

```javascript
function setupErrorHandling(howl, id) {
  howl.on('loaderror', (soundId, errorCode) => {
    console.error(`Load error [${id}]: code=${errorCode}`);

    switch (errorCode) {
      case 2: // Network error — retry
        retryLoad(howl, id, 3);
        break;
      case 3: // Decode error — possible corrupt file
        console.error(`Decode error for ${id} — file may be corrupt`);
        break;
      case 4: // Format not supported
        console.error(`Format not supported for ${id}`);
        break;
      default:
        retryLoad(howl, id, 2);
    }
  });

  howl.on('playerror', (soundId, errorCode) => {
    console.warn(`Play error [${id}]: likely autoplay blocked`);

    // Unlock AudioContext and retry
    if (Howler.ctx && Howler.ctx.state !== 'running') {
      Howler.ctx.resume().then(() => {
        howl.play(soundId);
      });
    }
  });
}

function retryLoad(howl, id, maxRetries, attempt = 1) {
  if (attempt > maxRetries) {
    console.error(`Permanently failed to load: ${id}`);
    return;
  }

  const delay = Math.min(500 * Math.pow(2, attempt - 1), 5000);
  console.warn(`Retry ${attempt}/${maxRetries} for ${id} in ${delay}ms`);

  setTimeout(() => {
    howl.load();
    howl.once('loaderror', () => {
      retryLoad(howl, id, maxRetries, attempt + 1);
    });
  }, delay);
}
```

---

## 12. Memory Management

### Memory cost per audio file (decoded PCM):

```
Memory = duration_seconds × sample_rate × channels × 4 bytes

Example:
60s stereo @ 44.1kHz = 60 × 44100 × 2 × 4 = 21,168,000 bytes ≈ 21 MB
```

### Memory budget:

| Platform | Safe total PCM budget | Reasoning |
|----------|----------------------|-----------|
| Desktop | ~200 MB | No practical limit |
| Mobile (high-end) | ~100 MB | Shared with textures, JS heap |
| Mobile (low-end) | ~50 MB | iOS Safari can crash at ~80 MB total audio |

### Memory lifecycle — load and unload per game state:

```javascript
// ── Base Game State ──────────────────────────────────────
function enterBaseGame() {
  // These should already be loaded (Tier 1-3)
  // Load base music if not already loaded
  musicManager.load('baseMusic').then(() => {
    musicManager.play('baseMusic');
  });
}

// ── Bonus Trigger ────────────────────────────────────────
function enterBonus() {
  // Load bonus audio (Tier 4)
  audioLoadManager.loadTier(4);
  musicManager.load('bonusMusic');

  // Crossfade music
  musicManager.crossfade('baseMusic', 'bonusMusic', 1000);

  // Optional: unload base-game-only sounds to free memory on mobile
  // Only if device memory is constrained
  if (isLowMemoryDevice()) {
    // Do NOT unload boot sprite or reel sprite — bonus still needs them
    // Only unload sounds exclusive to base game that bonus never uses
  }
}

// ── Return to Base Game ──────────────────────────────────
function exitBonus() {
  musicManager.crossfade('bonusMusic', 'baseMusic', 1000);

  // Unload bonus audio after crossfade
  setTimeout(() => {
    musicManager.unload('bonusMusic');
    // Unload bonus sprite to free memory
    // bonusSprite.unload(); // Only if memory is critical
  }, 2000);
}
```

### Device memory detection:

```javascript
function isLowMemoryDevice() {
  // navigator.deviceMemory returns approximate RAM in GB
  // Available in Chrome, Edge. Returns undefined in Safari, Firefox.
  if (navigator.deviceMemory && navigator.deviceMemory <= 2) {
    return true;
  }

  // Fallback: detect mobile
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return isMobile;
}
```

### CRITICAL: Howler.js unload() memory leak

Known issue: `howl.unload()` does NOT reliably free AudioBuffer memory in Chromium browsers. The decoded buffer may persist in memory until the page is refreshed.

**Workaround:** Reuse Howl instances instead of creating/destroying them:

```javascript
// BAD — memory leak over time
bonusSprite.unload();
bonusSprite = new Howl({ src: ['bonus.m4a'], ... });

// GOOD — reuse the same instance
bonusSprite.stop();
// Change source if needed:
// bonusSprite._src = ['new_bonus.m4a'];
// bonusSprite.load();
```

For the typical slot game lifecycle (base → bonus → base → bonus), this means:
- Create all Howl instances once during initialization
- Use `preload: false` for non-critical ones
- Call `.load()` when needed
- Call `.stop()` when done (not `.unload()`)
- Only call `.unload()` when you are certain that sound will never be needed again

---

## 13. Server Requirements

### Range requests (mandatory for HTML5 Audio mode):

The server MUST support HTTP Range Requests for any audio files that may be used with `html5: true`.

**Required response headers for range requests:**

```
HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 0-65535/1048576
Content-Length: 65536
Content-Type: audio/mp4
```

**CRITICAL for iOS Safari:** Safari sends a probe request `Range: bytes=0-1` before streaming. If the server responds with `200 OK` instead of `206 Partial Content`, Safari will refuse to play the audio.

### MIME types:

```
.m4a  →  audio/mp4
```

Ensure the server returns the correct Content-Type. Incorrect MIME types cause decode failures on some browsers.

### CORS (if audio is on a different domain):

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Range
Access-Control-Expose-Headers: Content-Range, Content-Length
```

---

## 14. Caching Strategy

### HTTP cache headers:

```
Cache-Control: public, max-age=2592000, immutable
ETag: "content-hash-of-file"
```

Audio files are versioned by their content — the filename contains the game name, and the sounds.json manifest references exact filenames. Once deployed, audio files never change.

`max-age=2592000` = 30 days. `immutable` tells the browser to never revalidate during the max-age period.

### Service Worker caching (optional, recommended):

```javascript
// In service worker (sw.js)
const AUDIO_CACHE_NAME = 'slot-audio-v1';

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Only cache audio files
  if (!url.endsWith('.m4a')) return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then(networkResponse => {
        // Clone before caching (response can only be consumed once)
        const responseClone = networkResponse.clone();
        caches.open(AUDIO_CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return networkResponse;
      });
    })
  );
});

// IMPORTANT: If using HTML5 Audio mode, the service worker MUST handle
// range requests correctly. Use workbox-range-requests plugin:
//
// import { RangeRequestsPlugin } from 'workbox-range-requests';
// registerRoute(
//   /\.m4a$/,
//   new CacheFirst({
//     cacheName: AUDIO_CACHE_NAME,
//     plugins: [new RangeRequestsPlugin()]
//   })
// );
```

### Cache versioning:

When deploying new audio for a game update, change the cache name (e.g., `slot-audio-v2`) and clean up old caches:

```javascript
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(names => {
      return Promise.all(
        names
          .filter(name => name.startsWith('slot-audio-') && name !== AUDIO_CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
});
```

---

## 15. Tab Visibility Handling

```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // ── Tab hidden ───────────────────────────────────────
    // Mute all audio (do NOT stop — preserve playback position)
    Howler.mute(true);

    // Suspend AudioContext to free CPU
    if (Howler.ctx && Howler.ctx.state === 'running') {
      Howler.ctx.suspend();
    }
  } else {
    // ── Tab visible ──────────────────────────────────────
    // Resume AudioContext
    if (Howler.ctx && Howler.ctx.state !== 'running') {
      Howler.ctx.resume().then(() => {
        // Unmute
        Howler.mute(false);

        // Resync music layers if they drifted
        // (Web Audio mode: should stay in sync)
        // (HTML5 mode: may need manual resync)
        resyncMusicLayers();
      });
    } else {
      Howler.mute(false);
    }
  }
});

function resyncMusicLayers() {
  // If using Web Audio mode for music, layers remain in sync
  // because the AudioContext clock paused and resumed together.
  //
  // If using HTML5 mode, layers may have drifted.
  // Restart all layers from the same position:
  //
  // const currentSeek = layer1.seek();
  // layers.forEach(l => l.seek(currentSeek));
}
```

---

## 16. Pool Configuration

Howler.js pool determines how many simultaneous instances of a sound can play. Default is 5.

### Recommended pool sizes per sound type:

| Sound type | Pool size | Reasoning |
|------------|-----------|-----------|
| ReelLand | 10 | 5 reels × 2 (overlap from rapid stops) |
| UI sounds (click, open, close) | 5 | Default is sufficient |
| Symbol win sounds | 5 | Multiple paylines can trigger simultaneously |
| Payline | 5 | Multiple paylines per spin |
| Rollup | 3 | Usually only 1 playing, but transitions need overlap |
| Music | 2 | Current + fading out |
| BigWin | 2 | Never more than 1 simultaneously |
| Anticipation | 3 | Can overlap with previous stopping |
| Preshow (sprite list) | 5 | Sequential but with overlap |

### Setting pool per Howl:

```javascript
const bootSprite = new Howl({
  src: ['boot_sprite.m4a'],
  sprite: { /* ... */ },
  pool: 10    // Set to highest need among contained sounds
});
```

Note: pool is per Howl instance, not per sprite within the Howl. If a sprite contains both ReelLand (needs 10) and UiClick (needs 5), set pool to 10.

### Global HTML5 pool:

```javascript
// Only relevant if using HTML5 mode
// Default is 10, increase if you have many HTML5-mode Howl instances
Howler.html5PoolSize = 20;
```

---

## 17. QA Checklist for Frontend

### Before release, verify:

**Loading:**
- [ ] Boot sprite loads and is playable before first spin button appears
- [ ] Game does not freeze/stutter during Tier 2-3 idle loading
- [ ] Bonus audio loads successfully when triggered (no silent bonus)
- [ ] All music layers load and play in sync

**First Spin Test:**
- [ ] Refresh game → press spin immediately
- [ ] UiSpin sound plays with no delay
- [ ] ReelLand sounds play for each reel
- [ ] Rollup plays if there is a win
- [ ] No missing sounds, no late sounds

**Error Recovery:**
- [ ] Simulate network error during Tier 2 load → audio retries and eventually loads
- [ ] Simulate slow 3G → boot sprite loads first, game is playable, other tiers load progressively
- [ ] Kill and restore AudioContext → audio recovers

**iOS Safari:**
- [ ] First tap unlocks AudioContext
- [ ] Audio plays after returning from background tab
- [ ] Audio recovers after phone call interruption
- [ ] No console errors about autoplay policy

**Memory:**
- [ ] Monitor memory during 100-spin session — no continuous growth
- [ ] Monitor memory during base → bonus → base transitions — memory returns to baseline
- [ ] Test on low-end mobile device (2 GB RAM) — no crashes

**Edge Cases:**
- [ ] Rapid spin (slam stop) — UiSpinSlam plays, anticipation stops cleanly
- [ ] Skip during big win — all win sounds stop, no lingering audio
- [ ] Inactivity timeout — music fades to silence, pauses
- [ ] Return from inactivity — music resumes from correct position

---

## 18. Known Howler.js Issues & Workarounds

### Issue 1: HTML5 sprites play longer than defined duration
**GitHub:** #826
**Impact:** Sounds bleed into adjacent sounds in the sprite
**Workaround:** NEVER use `html5: true` with sprites. Use Web Audio mode only.

### Issue 2: unload() memory leak in Chromium
**GitHub:** #914, #1731
**Impact:** Decoded audio buffers are not freed by garbage collector
**Workaround:** Reuse Howl instances. Call `.stop()` instead of `.unload()` when possible.

### Issue 3: HTML5 Audio pool exhaustion
**GitHub:** #1110
**Impact:** Silent playback when pool is exhausted on mobile
**Workaround:** Increase `Howler.html5PoolSize`. Minimize HTML5 mode usage.

### Issue 4: iOS 17.4 HTML5 mode broken
**GitHub:** #1721
**Impact:** Audio does not play at all in HTML5 mode on iOS 17.4
**Workaround:** Fixed in iOS 17.5. Prefer Web Audio mode for critical sounds.

### Issue 5: requestIdleCallback not available in Safari
**Impact:** Idle-time loading falls back to setTimeout
**Workaround:** Already handled in AudioLoadManager (Section 5) with setTimeout fallback.

### Issue 6: decodeAudioData concurrent limit in Firefox
**Bugzilla:** #1648309
**Impact:** More than 6 simultaneous decodeAudioData calls may fail
**Workaround:** Load audio sequentially per tier, not all at once. The AudioLoadManager in Section 5 processes one file at a time per tier.

---

## 19. Complete Integration Example

```javascript
// ══════════════════════════════════════════════════════════
// COMPLETE AUDIO INITIALIZATION
// ══════════════════════════════════════════════════════════

import soundsJson from './sounds.json';

// ── Step 1: Parse sounds.json ────────────────────────────
const manifest = soundsJson.soundManifest;
const sprites = soundsJson.soundDefinitions.soundSprites;
const commands = soundsJson.soundDefinitions.commands;
const spriteLists = soundsJson.soundDefinitions.spriteList;

// ── Step 2: Create managers ──────────────────────────────
const audioLoadManager = new AudioLoadManager();
const musicManager = new MusicLayerManager();
const commandExecutor = new CommandExecutor(/* soundManager instance */);

// ── Step 3: Build sprite maps per manifest entry ─────────
function buildSpriteMap(soundId) {
  const map = {};
  Object.entries(sprites).forEach(([key, def]) => {
    if (def.soundId === soundId) {
      map[def.spriteId] = [def.startTime, def.duration];
    }
  });
  return map;
}

// ── Step 4: Create Howl instances from manifest ──────────
manifest.forEach(entry => {
  if (entry.music) {
    // Music layers — handled separately by MusicLayerManager
    // Group detection by naming convention:
    // gameName_BaseMusicLoop_L1 → group "baseMusic", layer "L1"
    return;
  }

  const tier = entry.tier || 3;
  const spriteMap = buildSpriteMap(entry.id);
  const needsHighPool = Object.keys(spriteMap).some(name =>
    name === 'ReelLand' || name.startsWith('SymbolPreshow')
  );

  const howl = new Howl({
    src: entry.src.map(s => s),
    sprite: spriteMap,
    html5: false,
    preload: tier === 1,
    pool: needsHighPool ? 10 : 5
  });

  setupErrorHandling(howl, entry.id);
  audioLoadManager.register(entry.id, howl, tier);
});

// ── Step 5: Register music groups ────────────────────────
// (parse manifest entries with music: true, group by naming convention)

// ── Step 6: Initialize AudioContext ──────────────────────
initAudioContext();

// ── Step 7: Start loading sequence ───────────────────────
audioLoadManager.onTierLoaded = (tier) => {
  console.log(`Audio Tier ${tier} loaded`);

  if (tier === 1) {
    // Boot sprite ready — game can accept first spin
    executeWarmup(/* soundManager */);
    onAudioReady();
  }
};

audioLoadManager.start();

// ── Step 8: Game events trigger commands ─────────────────
// In game code:
function onSpinStart() {
  commandExecutor.execute('onBaseGameSpinStart');
}

function onReelStop(reelIndex) {
  commandExecutor.execute(`onReelLandDelayed${reelIndex + 1}`);
}

function onBigWinStart() {
  commandExecutor.execute('onBigWinStart');
}

function onBonusTrigger() {
  // Ensure bonus audio is loaded
  if (!audioLoadManager.isTierLoaded(4)) {
    audioLoadManager.loadTier(4);
  }
  commandExecutor.execute('onBaseToBonusStart');
}

// ... etc for all game events
```

---

## Document Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-12 | Initial release |

---

END DOCUMENT
