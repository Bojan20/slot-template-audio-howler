# Ultimativni vodic: Defer Loading & Streaming zvukova u HTML5 Slot igrama

## Sadrzaj
1. [Pragmatic Play — Kako rade audio](#1-pragmatic-play--kako-rade-audio)
2. [Play'n GO — Kako rade audio](#2-playn-go--kako-rade-audio)
3. [Poredjenje: Pragmatic vs Play'n GO vs IGT Template](#3-poredjenje-pragmatic-vs-playn-go-vs-igt-template)
4. [Ultimativno resenje: Defer Loading arhitektura](#4-ultimativno-resenje-defer-loading-arhitektura)
5. [Ultimativno resenje: Streaming arhitektura](#5-ultimativno-resenje-streaming-arhitektura)
6. [Konkretne preporuke za IGT Template](#6-konkretne-preporuke-za-igt-template)
7. [Implementacioni kod i primeri](#7-implementacioni-kod-i-primeri)
8. [Format i kompresija](#8-format-i-kompresija)
9. [Mobile-specific tehnike](#9-mobile-specific-tehnike)
10. [Caching strategije](#10-caching-strategije)
11. [Performance best practices](#11-performance-best-practices)

---

## 1. Pragmatic Play — Kako rade audio

### Audio biblioteka: CreateJS SoundJS (NE Howler.js)

Pragmatic Play koristi **CreateJS SoundJS** (verzija "NEXT", build oktobar 2015), deo CreateJS suite-a. Rendering engine im je **PixiJS 3.0.2**.

SoundJS ima dva plugin-a sa automatskim fallback-om:
- **WebAudioPlugin** (primarni) — koristi Web Audio API: `AudioContext`, `GainNode`, `DynamicsCompressorNode`, `decodeAudioData`, `createBufferSource`
- **HTMLAudioPlugin** (fallback za UC Browser i starije browser-e)

```javascript
// Pragmatic Play detekcija
if (IS_UCBROWSER) createjs.Sound.registerPlugins([createjs.HTMLAudioPlugin]);
// Inace:
createjs.Sound.registerPlugins([createjs.WebAudioPlugin, createjs.HTMLAudioPlugin]);
```

### Audio format: MP3 + OGG (dual format, browser-detected)

Dva formata za svaki sound package:
- **MP3** — primarni za vecinu browser-a
- **OGG (Vorbis)** — koristi se kad browser podrzava OGG (auto-detekcija)

```javascript
SoundHelper.audioFormat = capabilities["ogg"]
  ? SoundHelper.AudioFormat.ogg
  : SoundHelper.AudioFormat.mp3;
```

**NE koriste** M4A, WebM, Opus, ili WAV.

### Delivery: Base64-Encoded JSON Packages (KLJUCNA RAZLIKA)

Pragmatic Play **NE koristi** tradicionalne audiosprite-ove. Umesto toga koriste **JSON-pakovani base64 encoding sistem**:

1. Svi individualni zvucni klipovi su **base64-encoded** kao posebni unosi unutar JSON fajlova
2. JSON fajlovi se preuzimaju kao obicni HTTP zahtevi
3. Posle preuzimanja, svaki zvuk se **individualno dekodira** koristeci `AudioContext.decodeAudioData()` (Web Audio) ili registruje kao `data:audio/...;base64,...` URI (HTML Audio)

**Struktura sound JSON-a:**
```json
{
  "sounds": [
    {"id": "fb679d7b77b4ef140ae6e89892ab6bdc", "data": "//tQxAAAAAAA...base64..."},
    {"id": "next_sound_id", "data": "...base64..."}
  ]
}
```

**Sound paketi za Sweet Bonanza (primer):**

| Paket | MP3 velicina | OGG velicina | Namena |
|-------|-------------|-------------|--------|
| `sounds.mp3.json` | 8.4 MB | 8.7 MB | Glavni zvuci igre |
| `GUI_sounds.mp3.json` | 720 KB | 767 KB | UI/interfejs zvuci |
| `MDL_Jackpot_sounds.mp3.json` | 692 KB | 748 KB | Jackpot modul zvuci |

**Ukupan audio payload: ~9.9 MB** (za jedan format — browser bira MP3 ili OGG, ne oba).

### Defer Loading strategija

Zvuk se ucitava **odlozeno** u dve faze:

**Faza 1 — Game bootstrap (bez audio-a):**
- HTML page ucitava bootstrap.js
- bootstrap.js ucitava build.js (3 MB main engine)
- Game resursi, teksture i sprite-ovi se ucitavaju
- Igra postaje vizuelno interaktivna

**Faza 2 — Sound loading (odlozeno):**
- `SoundLoader.OnLoad()` se poziva POSLE inicijalizacije game engine-a
- Na mobilnim/touch uredjajima: zvuci se ucitavaju **TEK POSLE prvog korisnickog interakcije** (touch/click)
- Na desktopu: `SoundLoader.InitSounds()` i `SoundLoader.LoadSounds()` idu odmah posle engine init-a
- Sound loading **NE BLOKIRA** game renderovanje ili pocetnu interakciju

```javascript
// Pragmatic: mobile wait za touch pre loading-a zvukova
if (window["UHT_ForceClickForSounds"] || createjs.BrowserDetect.isIOS ||
    createjs.BrowserDetect.isAndroid || ...) {
    // Registruj touch handler, load na prvu interakciju
} else {
    SoundLoader.InitSounds();
    SoundLoader.LoadSounds();
}
```

### Multi-threaded dekodiranje

Posle download-a, zvuci se dekodiraju koristeci **4 paralelna dekodiranja** (`SoundLoader.numProcessingThreads = 4`). Svaki thread chain-uje sekvencijalne `decodeAudioData` pozive:

```javascript
var sThread = i % SoundLoader.numProcessingThreads;
if (i <= SoundLoader.numProcessingThreads - 1)
    firstProcessors[sThread] = processor;
else
    lastProcessors[sThread].nextToDecode = processor;
```

### Modularno ucitavanje zvukova

Sound paketi su modularni. Base game uvek ucitava:
- `sounds.[mp3|ogg].json` — glavni audio
- `GUI_sounds.[mp3|ogg].json` — deljeni UI zvuci

Opcionalni moduli ucitavaju dodatne pakete on-demand:
- `MDL_Jackpot_sounds.[mp3|ogg].json` — samo ako je jackpot feature aktivan

```javascript
Modules.LoadSounds = function(soundSizes) {
    for (var i = 0; i < Modules.neededModules.length; i++)
        Modules.LoadSound(Modules.neededModules[i], soundSizes);
};
```

### Lokalizacija zvukova

Sound paketi mogu biti jezicki-specificni (18 jezika: de, es, fr, it, ko, ru, zh, th, vi, ja, sv, no, fi, ro, tr, da, id, zt).

### SoundManager arhitektura

- **Music:** Posebna volume kontrola, ducking podrska, fade in/out
- **Sound FX:** One-shot playback sa cooldown sistemom za sprecavanje preklapanja
- **Ducking:** `VS_MusicDuckByOneShot` — muzika se stisava kad SFX svira
- **Cooldown:** `OneShotCooldown` — sprecava isti efekat da se pusti prebrzo
- **Looping:** Dediciran looping source management

### CDN i caching

- **CDN:** Amazon CloudFront
- **Origin:** Amazon S3
- **Cache headers:** `max-age=604800` (7 dana), `public`, `must-revalidate`
- **Content versioning:** URL sadrzi `?key=<md5hash>` parametar — efektivno permanentno cacheiranje dok se sadrzaj ne promeni
- **Server-side encryption:** AES256

### Error handling

- Sound download-i retry do 5 puta sa 500ms delay-em
- Alternativni CDN path posle 5 neuspelih bootstrap pokusaja
- iOS `AudioContext` suspend/resume preko touch event-ova

---

## 2. Play'n GO — Kako rade audio

### Napomena o dostupnosti podataka

Play'n GO je ekstremno zatvoren po pitanju interne tehnologije. Game client se servira sa `playngonetwork.com` koji blokira direktan pristup. Nema javne developer dokumentacije, tech blog-ova, konferencijskih predavanja, ili open-source repo-a. Analiza je bazirana na industrijskim obrascima, OMNY platformi (njihov proprietarni HTML5 framework), i reverse-engineering-u.

### Audio Sprite pristup

Play'n GO, kao i vecina HTML5 slot provajdera, koristi **audio sprite-ove**:
- Vise individualnih WAV fajlova (tipicno 60-90 po igri) kombinovano u mali broj sprite fajlova (2-4)
- Svaki sprite je jedan audio fajl sa svim zvucima konkateniranim sa silence gap-ovima
- JSON manifest mapira sprite ID-ove na `{startTime, duration}` offset-e

### Audio format: M4A (AAC)

Primarni format za univerzalnu kompatibilnost:
- M4A/AAC ima univerzalnu podrsku (Chrome, Firefox, Safari, Edge, svi mobilni)
- OGG nije podrzan na Safari/iOS — dealbreaker jer je iOS 30-40% saobracaja u igamingu
- MP3 ima slabiju kompresiju
- Opus/WebM nemaju podrsku na starijim Safari verzijama

### Audio biblioteka: Howler.js v2

De facto standard u igamingu:
- **Web Audio API primarno, HTML5 Audio fallback**
- **Ugradjena audio sprite podrska** — nativan `sprite` parametar sa milisekundnom preciznoscu
- **7KB gzipped** — zanemarljiv uticaj na bundle velicinu
- **Sound pooling** — reciklira zaustavljene zvukove (default pool od 5)
- **Automatsko cachiranje** — dekodirani audio buffer-i se cacheju
- **Cross-browser edge case handling** — iOS autoplay, AudioContext resume, itd.

### Loading strategija

**Faza 1 — Game shell (blokirajuce):**
- Game client JS bundle
- PixiJS renderer init
- `sounds.json` manifest (mali JSON, ~25KB)

**Faza 2 — Kritican audio preload (loading screen):**
- Prvi audio sprite (base game muzika + esencijalni UI zvuci)
- `preload: true` u Howler-u
- Full file download + decode

**Faza 3 — Odlozen audio load (posle gameplay-a):**
- Preostali audio sprite-ovi (bonus, special features, win celebracije)
- `preload: false` inicijalno, zatim `howl.load()` kad zatreba
- Ili low-priority loading posle prvog moguceg spin-a

### File size budget

- **Target sprite velicina: < 1.5MB po sprite-u**
- **Ukupan audio po igri: ~3-5MB** preko svih sprite-ova
- Source WAV-ovi konvertovani u M4A putem ffmpeg

### CDN

- `playngonetwork.com` sa agresivnim caching-om
- Content-hash u imenima fajlova
- Gzip/Brotli za JSON manifeste
- Poseban CDN domen od game logike za paralelne download-e

### OMNY platforma specificnosti

- Sofisticiraniji asset loader koji paralelizuje audio sprite download-e sa texture atlas download-ima
- Verovatno custom Howler.js wrapper sa igaming-specificnim optimizacijama
- Priority-based loading: UI zvuci i base muzika prvi, feature/bonus zvuci odlozeni
- Potencijalno WebWorker-bazirano audio dekodiranje
- Integracija sa game state machine-om za audio lifecycle management
- Adaptivni kvalitet — serviranje nizeg bitrate-a na sporim konekcijama

---

## 3. Poredjenje: Pragmatic vs Play'n GO vs IGT Template

| Feature | Pragmatic Play | Play'n GO | IGT Template (vas) |
|---------|---------------|-----------|-------------------|
| **Biblioteka** | CreateJS SoundJS | Howler.js v2 | Howler.js v2 |
| **Format** | MP3 + OGG | M4A (AAC) | M4A (AAC) |
| **Delivery** | Base64 u JSON | Binary audiosprite | Binary audiosprite |
| **Sprite sistem** | Individualni zvuci u JSON-u | Tradicionalni audiosprite | Tradicionalni audiosprite |
| **Dekodiranje** | Manual `decodeAudioData` po klipu | Howler automatski | Howler automatski |
| **Struktura fajlova** | 2-3 JSON paketa | 2-4 M4A sprite fajla | 3 M4A sprite fajla |
| **Sprite definicije** | Nema startTime/duration (individualni klipovi) | startTime + duration | startTime + duration |
| **Size management** | Po-paketno (~8MB main + 700KB GUI) | Size-based (<1.5MB po sprite-u) | Size-based (<1.5MB po sprite-u) |
| **Defer loading** | DA — posle game init, na mobile tek posle touch-a | DA — prioritetno, idle-time | NE — sve se ucitava odjednom |
| **Modularnost** | DA — odvojeni GUI, Jackpot, lokalizovani paketi | DA — po game stanju | NE — sve u 3 sprite-a |
| **Multi-thread decode** | DA — 4 paralelna thread-a | Verovatno | NE |
| **CDN** | CloudFront/S3, 7-dana cache | playngonetwork.com | Nexus registry |
| **Ukupna velicina** | ~9.9 MB (base64 overhead) | ~3-5 MB | ~2.6 MB |

### Kljucni zakljucci

1. **Pragmatic Play pristup** (base64 u JSON): Daje im per-clip dekodiranje i modularno ucitavanje, ali ima ~33% veci payload zbog base64 overhead-a. Zrelo, production-proven resenje.

2. **Play'n GO pristup** (audiosprite + Howler): Industriski standard, manji payload, jednostavniji za implementaciju. Oslanja se na Howler za tesko podizanje.

3. **Vas IGT Template**: Solidna osnova (3 sprite-a, m4a, size-based splitting), ali **NEDOSTAJE defer loading** — sve se ucitava odjednom, sto je glavni uzrok kocenja.

---

## 4. Ultimativno resenje: Defer Loading arhitektura

### Troslojna prioritetna arhitektura

**Tier 1 — CRITICAL (load pre gameplay-a):**
- UI zvuci: UiSpin, UiSpinSlam, UiClick, UiOpen, UiClose, UiSelect, UiSkip
- Reel zvuci: ReelLand
- Kratki, cesti zvuci — korisnik odmah ocekuje feedback
- **MORA biti gotovo pre nego sto igrac prvi put klikne Spin**

**Tier 2 — HIGH (load u pozadini dok je igra idle):**
- Base game muzika: BaseMusicLoop
- Win zvuci: Rollup1, Rollup1End, Rollup2Start, Rollup2End, RollupLow, Payline
- Symbol win zvuci: SymbolS01-S15, SymbolW01, SymbolF01, SymbolB01
- Preshow zvuci: SymbolPreshow1-5
- Koristi `requestIdleCallback` za loading u idle periodima

**Tier 3 — LOW (load on-demand):**
- Bonus: BonusMusicLoop, BonusMusicLoopEnd, BonusSpinStart/End, BonusRetrigger
- Bonus symbols: BonusSymbolS01-S15, BonusSymbolW01, BonusSymbolWin
- BigWin: BigWinStart, BigWinEnd, BigWinTier
- Picker: PickerMusicLoop, PickerSelect, PickerStart
- Anticipation: SymbolB01Anticipation, SymbolF01Anticipation
- Transitions: BaseToBonusStart, BonusToBaseStart, PreBonusLoop
- Bonus rollup: BonusRollupStart/End, BonusRollup2Start/End
- **Load tek kad bonus/BigWin postanu mogucni** (npr. 2+ scattera pala)

### Mapiranje na vase sprite fajlove

| Sprite | Trenutni sadrzaj | Tier |
|--------|-----------------|------|
| audioSprite3 | UI + Symbol + Reel zvuci | **CRITICAL (Tier 1+2)** |
| audioSprite1 | BaseMusicLoop + Base game SFX + Anticipation | **HIGH (Tier 2)** |
| audioSprite2 | Bonus + BigWin + Picker | **LOW (Tier 3)** |

**Optimalan redosled ucitavanja:**
1. `audioSprite3` — ODMAH (sadrzi UI i Symbol zvukove — neophodan za prvu interakciju)
2. `audioSprite1` — IDLE TIME (sadrzi muziku i base game SFX — potreban za punu igru)
3. `audioSprite2` — ON-DEMAND (bonus/BigWin/Picker — retko potreban)

### Idle-Until-Urgent Pattern

Kombinacija `requestIdleCallback` + eager loading kad zatreba:

```javascript
class AudioLoadQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  enqueue(howl, priority) {
    this.queue.push({ howl, priority });
    this.queue.sort((a, b) => a.priority - b.priority);
    if (!this.isProcessing) this.processNext();
  }

  processNext() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }
    this.isProcessing = true;
    const { howl } = this.queue.shift();

    requestIdleCallback((deadline) => {
      howl.load();
      howl.once('load', () => this.processNext());
    }, { timeout: 3000 }); // fallback ako nema idle vremena
  }

  // "Urgent" — preseci queue i load odmah
  loadNow(howl) {
    this.queue = this.queue.filter(item => item.howl !== howl);
    howl.load();
  }
}
```

---

## 5. Ultimativno resenje: Streaming arhitektura

### Web Audio vs HTML5 Audio — Kada sta koristiti

| Karakteristika | Web Audio (default) | HTML5 Audio (`html5: true`) |
|---|---|---|
| Latencija | Niska (~5-10ms) | Visa (~50-100ms) |
| Sprites | Precizni | Neprecizni (poznati bug) |
| Memorija | Ceo fajl dekodiran u RAM | Streaming, range requests |
| Max velicina | ~1.5MB sprite (mobile safe) | Neograniceno |
| Simultane instance | Neograniceno | Pool ogranicen |

**Pravilo za slot igre:** Web Audio za SVE sprite-ove sa kratkim zvucima, HTML5 Audio SAMO za dugacke muzicke loop-ove (100+ sekundi) ako memorija postane problem.

### Streaming za dugacku muziku

Vas `BaseMusicLoop` traje **101.5 sekundi**. Kad se dekodira u PCM:
- 101.5s x 44100Hz x 2 kanala x 4 bajta = **~35.8 MB u memoriji**

Opcija: izdvojiti muziku u poseban fajl sa HTML5 streaming:

```javascript
const baseMusicStream = new Howl({
  src: ['baseMusicLoop.m4a'],
  html5: true,   // Streaming — NE drzi ceo buffer u memoriji
  loop: true,
  volume: 1,
  preload: false  // Ucitaj tek kad zatreba
});
```

### Fetch + decodeAudioData za napredni streaming

```javascript
async function streamDecode(url, audioCtx) {
  const response = await fetch(url);
  const reader = response.body.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const fullBuffer = concatenateArrayBuffers(chunks);
  return audioCtx.decodeAudioData(fullBuffer);
}
```

### WebCodecs AudioDecoder (buducnost — Chrome, Firefox, Safari TP)

```javascript
const decoder = new AudioDecoder({
  output: (audioData) => { /* schedule playback */ },
  error: (e) => console.error(e)
});
decoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 });
decoder.decode(new EncodedAudioChunk({ type: 'key', data: chunk, timestamp: 0 }));
```

Prednost nad `decodeAudioData`: radi sa chunk-ovima, ne zahteva ceo fajl.

---

## 6. Konkretne preporuke za IGT Template

### Preporuka 1: Reorganizuj sprite-ove po prioritetu

Trenutno se sprite-ovi dele po velicini (automatski). Treba ih deliti **po prioritetu/game stanju**:

| Sprite | Sadrzaj | Prioritet | Preload |
|--------|---------|-----------|---------|
| `audioSprite_critical` | UI zvuci + ReelLand + Payline + BaseGameStart + SymbolPreshow | CRITICAL | `preload: true` |
| `audioSprite_base` | BaseMusicLoop + Symbol wins (S01-S15, W01, F01, B01) + Rollup + ScreenShake | HIGH | `preload: false`, load u idle |
| `audioSprite_bonus` | BonusMusicLoop + Bonus SFX + BigWin + Picker + Anticipation + Transitions | LOW | `preload: false`, load on-demand |

### Preporuka 2: Izdvoji dugacku muziku

`BaseMusicLoop` (101.5s) i `BonusMusicLoop` (37.5s) zauzimaju ~50MB PCM memorije kad se dekodiraju. Opcije:

**Opcija A — HTML5 streaming (preporuceno):**
```javascript
const baseMusic = new Howl({
  src: ['baseMusicLoop.m4a'],
  html5: true,
  loop: true,
  preload: false
});
```

**Opcija B — Ostavi u sprite-u ali smanji kvalitet muzike:**
- Muzika na 64kbps (dovoljno za background loop)
- SFX na 128kbps (potrebna preciznost)

### Preporuka 3: Dodaj preload: false za ne-kriticne sprite-ove

```javascript
// U game init kodu:
const criticalSprite = new Howl({
  src: ['audioSprite_critical.m4a'],
  sprite: { /* UI zvuci */ },
  preload: true   // ODMAH
});

const baseSprite = new Howl({
  src: ['audioSprite_base.m4a'],
  sprite: { /* Base game zvuci */ },
  preload: false  // IDLE
});

const bonusSprite = new Howl({
  src: ['audioSprite_bonus.m4a'],
  sprite: { /* Bonus zvuci */ },
  preload: false  // ON-DEMAND
});

// Kad loading screen zavrsi:
requestIdleCallback(() => baseSprite.load());

// Kad 2+ scattera padnu:
function onScatterLand(count) {
  if (count >= 2 && bonusSprite.state() === 'unloaded') {
    bonusSprite.load();
  }
}
```

### Preporuka 4: Pool management

```javascript
// Za ceste zvukove koji se preklapaju
const reelLandSprite = new Howl({
  src: ['audioSprite_critical.m4a'],
  sprite: { ReelLand: [offset, 186] },
  pool: 10  // 5 reela x 2 (overlap safety)
});

// Za retke zvukove
const bigWinSprite = new Howl({
  src: ['audioSprite_bonus.m4a'],
  sprite: { BigWinStart: [offset, 15000] },
  pool: 2
});
```

### Preporuka 5: sounds.json prosirenje

Dodajte `tier` polje svakom sprite-u u sounds.json:

```json
{
  "soundSprites": {
    "s_UiSpin": {
      "soundId": "audioSprite_critical",
      "spriteId": "UiSpin",
      "startTime": 0,
      "duration": 1608,
      "tags": ["SoundEffects"],
      "tier": 1
    },
    "s_BaseMusicLoop": {
      "soundId": "audioSprite_base",
      "spriteId": "BaseMusicLoop",
      "startTime": 0,
      "duration": 101538,
      "tags": ["Music"],
      "tier": 2
    },
    "s_BigWinStart": {
      "soundId": "audioSprite_bonus",
      "spriteId": "BigWinStart",
      "startTime": 0,
      "duration": 15000,
      "tags": ["SoundEffects"],
      "tier": 3
    }
  }
}
```

---

## 7. Implementacioni kod i primeri

### Kompletna Defer Loading implementacija

```javascript
class SlotAudioManager {
  constructor(soundsConfig) {
    this.sprites = {};
    this.loadQueue = new AudioLoadQueue();
    this.config = soundsConfig;
  }

  init() {
    // Grupisanje po tier-u
    const tiers = this.groupByTier(this.config.soundDefinitions.soundSprites);

    // Tier 1 — Critical: load odmah, blocking
    tiers[1].forEach(manifest => {
      this.sprites[manifest.id] = new Howl({
        src: manifest.src.map(s => s),
        sprite: this.buildSpriteMap(manifest.id),
        preload: true
      });
    });

    // Tier 2 — High: load u idle time
    tiers[2].forEach(manifest => {
      const howl = new Howl({
        src: manifest.src.map(s => s),
        sprite: this.buildSpriteMap(manifest.id),
        preload: false
      });
      this.sprites[manifest.id] = howl;
      this.loadQueue.enqueue(howl, 2);
    });

    // Tier 3 — Low: registruj ali ne load
    tiers[3].forEach(manifest => {
      this.sprites[manifest.id] = new Howl({
        src: manifest.src.map(s => s),
        sprite: this.buildSpriteMap(manifest.id),
        preload: false
      });
    });
  }

  // Play sa automatic urgent loading
  play(spriteId, options = {}) {
    const spriteDef = this.config.soundDefinitions.soundSprites[spriteId];
    const howl = this.sprites[spriteDef.soundId];

    if (howl.state() === 'unloaded') {
      // Urgent load — preseci queue
      this.loadQueue.loadNow(howl);
      howl.once('load', () => {
        howl.play(spriteDef.spriteId);
      });
    } else if (howl.state() === 'loading') {
      howl.once('load', () => {
        howl.play(spriteDef.spriteId);
      });
    } else {
      howl.play(spriteDef.spriteId);
    }
  }

  // Preload specifican tier (npr. kad se priblizava bonus)
  preloadTier(tier) {
    Object.values(this.sprites).forEach(howl => {
      if (howl._tier === tier && howl.state() === 'unloaded') {
        howl.load();
      }
    });
  }
}
```

### requestIdleCallback Loading Queue

```javascript
class AudioLoadQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  enqueue(howl, priority) {
    this.queue.push({ howl, priority });
    this.queue.sort((a, b) => a.priority - b.priority);
    if (!this.isProcessing) this.processNext();
  }

  processNext() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }
    this.isProcessing = true;
    const { howl } = this.queue.shift();

    requestIdleCallback((deadline) => {
      howl.load();
      howl.once('load', () => this.processNext());
      howl.once('loaderror', () => {
        console.warn('Audio load failed, retrying...');
        setTimeout(() => {
          howl.load();
          howl.once('load', () => this.processNext());
        }, 1000);
      });
    }, { timeout: 3000 });
  }

  loadNow(howl) {
    this.queue = this.queue.filter(item => item.howl !== howl);
    howl.load();
  }
}
```

### AudioContext Lifecycle Management

```javascript
// Singleton AudioContext
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// Tab visibility — suspend kad tab ode u background
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    audioCtx?.suspend();
  } else {
    audioCtx?.resume();
  }
});

// Howler vec automatski radi suspend posle 30s neaktivnosti i resume na playback
```

### iOS Audio Unlock (Production-grade)

```javascript
function unlockAudioContext(ctx) {
  if (ctx.state === 'running') return Promise.resolve();

  return new Promise((resolve) => {
    const events = ['touchstart', 'touchend', 'click', 'keydown'];

    function unlock() {
      ctx.resume().then(() => {
        events.forEach(e => document.removeEventListener(e, unlock));
        resolve();
      });
    }

    events.forEach(e => document.addEventListener(e, unlock, { once: false }));
  });
}
// Napomena: Howler.js vec radi ovo automatski
```

---

## 8. Format i kompresija

### Poredjenje formata

| Format | Kvalitet @ 96kbps | iOS podrska | Velicina (relativan) | Preporuka |
|---|---|---|---|---|
| **Opus** | Odlican | iOS 18.4+ (mart 2025) | 1x (najmanji) | Buducnost |
| **M4A/AAC** | Dobar | SVE iOS verzije | 1.3x | **Najbolji izbor DANAS** |
| **OGG Vorbis** | Dobar | iOS 18.4+ | 1.2x | Dobar fallback |
| **MP3** | OK | SVE verzije | 1.8x | Samo kao zadnji fallback |

### Encoding preporuke

```bash
# M4A/AAC — optimalno za slot audio sprites DANAS
ffmpeg -i input.wav -c:a aac -b:a 96k -ar 44100 output.m4a

# Za kratke SFX (< 2s) — visi bitrate za kvalitet
ffmpeg -i sfx.wav -c:a aac -b:a 128k output.m4a

# Opus — BUDUCNOST (kad iOS 18.4 bude minimum)
ffmpeg -i input.wav -c:a libopus -b:a 64k -ar 48000 output.opus

# Dual format build (za buducnost)
# export: 'opus,m4a' — Howler automatski bira best format
```

### Kompresioni odnosi

- WAV → M4A @ 96kbps: tipicno **10:1 do 15:1** kompresija
- WAV → Opus @ 64kbps: tipicno **15:1 do 20:1** kompresija
- Base64 encoding: +33% overhead (Pragmatic Play pristup)

### Budzet velicine za igru

| Platforma | Max sprite (kompresovan) | Max sprite (PCM u memoriji) | Preporuka |
|---|---|---|---|
| iOS mobile | ~5MB m4a | ~55MB PCM | **1.5MB max** (safety) |
| Android | ~8MB | ~80MB PCM | **1.5MB max** (safety) |
| Desktop | 15MB+ | nebitno | 3-5MB comfortable |

**Vas projekat (2.6MB ukupno) je unutar budget-a.** Ali `BaseMusicLoop` (101s) sam zauzima ~35MB PCM memorije — razmisliti o HTML5 streaming-u za njega.

---

## 9. Mobile-specific tehnike

### iOS Audio Unlock

- `AudioContext` se automatski suspenduje ako je kreiran bez user gesture
- `context.resume()` MORA biti pozvan iz event handler-a (click/touch)
- Howler.js handluje ovo automatski — drzi global pool "otkljucanih" HTML5 Audio nodova

### Android Chrome Autoplay Policy

- Ista pravila kao iOS — AudioContext suspend bez user gesture
- `context.resume()` iz event handler-a
- Howler.js automatski

### Mobile Memory Constraints

- **5MB MP3/M4A = ~55MB PCM u memoriji** (10x ekspanzija)
- iOS Safari moze **crashovati na 23MB+ audio sprite-ovima** (Howler issue #1151)
- **Sigurni limit: 1.5MB po sprite-u** kompresovano

### Latencija po platformi

| Platforma | Output latencija |
|---|---|
| macOS/iOS | Par milisekundi |
| Windows (WASAPI) | ~10ms |
| Linux/PulseAudio | 30-40ms |
| Android | 12.5ms - 150ms (jako varijabilno) |

### Preporuka za muzicke loop-ove na mobilnim

Izdvojiti `BaseMusicLoop` (101.5s) i `BonusMusicLoop` (37.5s) iz sprite-ova:

```javascript
// Muzika kao streaming — NE zauzima PCM memoriju
const baseMusic = new Howl({
  src: ['baseMusicLoop.m4a'],
  html5: true,
  loop: true,
  preload: false
});

// SFX kao sprite — preciznost i niska latencija
const sfxSprite = new Howl({
  src: ['sfxSprite.m4a'],
  sprite: { /* ... */ },
  preload: true,
  html5: false  // Web Audio za preciznost
});
```

---

## 10. Caching strategije

### Service Worker Audio Caching

```javascript
// sw.js
const AUDIO_CACHE = 'audio-cache-v1';

self.addEventListener('fetch', (event) => {
  if (event.request.url.match(/\.(m4a|ogg|mp3|opus)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;

        return fetch(event.request).then((response) => {
          const clone = response.clone();
          caches.open(AUDIO_CACHE).then((cache) => {
            cache.put(event.request, clone);
          });
          return response;
        });
      })
    );
  }
});
```

**VAZNO za HTML5 Audio mode:** Server MORA podrzavati Range Requests, i Service Worker mora koristiti `workbox-range-requests` plugin za seeking iz cache-a.

### Cache API vs IndexedDB

| Strategija | Za | Protiv |
|---|---|---|
| **Cache API** | Idealan za mreza resurse, radi sa SW | Cuvaju se kompresovani fajlovi |
| **IndexedDB** | Moze cuvati decoded AudioBuffer-e | Ogromni (PCM), ne preporucuje se |

### Strategija za slot igru

1. **Prva poseta:** Preuzmi sve sprite-ove, cacheiraj u Cache API
2. **Svaka sledeca poseta:** Svi audio fajlovi iz cache-a (0 mreza latencije)
3. **Verzionisanje:** `audio-cache-v2` za novi set zvukova, obrisi stari cache

### CDN preporuke (ono sto Pragmatic Play radi)

- **CloudFront/S3** ili ekvivalent
- **Cache headers:** `max-age=604800` (7 dana), `public`
- **Content-hash u URL-u:** `sprite.m4a?v=abc123` — permanentno cachiranje dok se ne promeni
- **Separate CDN domen** od game logike — paralelni download-i

---

## 11. Performance best practices

### Sprecavanje Jank/Stutter

1. **requestIdleCallback za loading:** Nikad ne ucitavaj audio tokom animacije
2. **Web Worker dekodiranje:** Offload `decodeAudioData` u Worker za heavy sprite-ove
3. **Batching decode poziva:** Firefox multi-thread (safe limit: 4-6 simultanih)
4. **NIKAD** DOM manipulacija tokom audio procesiranja

### Web Worker Audio Decoding

```javascript
// audioWorker.js
self.onmessage = async (e) => {
  const { arrayBuffer, sampleRate } = e.data;
  const offlineCtx = new OfflineAudioContext(2, 1, sampleRate);
  const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

  const channels = [];
  for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
    channels.push(audioBuffer.getChannelData(i).buffer);
  }
  self.postMessage({ channels, sampleRate: audioBuffer.sampleRate }, channels);
};
```

### Howler.js Pool Management

```javascript
// Cesti zvuci sa overlap-om
new Howl({ ..., pool: 10 });  // ReelLand (5 reela x 2)

// Retki zvuci
new Howl({ ..., pool: 2 });   // BigWin, BonusMusicLoop

// Default: 5 (dovoljan za vecinu)
```

### Howler.js Memory Leak Workaround

Poznati problem: `unload()` ne oslobadja potpuno memoriju. Workaround — reuse instance umesto create/destroy:

```javascript
// LOSE: create/unload ciklus
bonusMusic.unload(); // memorija mozda nece biti oslobodjena
bonusMusic = new Howl({...});

// BOLJE: reuse instance
if (bonusMusic.playing()) bonusMusic.stop();
bonusMusic._src = [newSrc];
bonusMusic.load();
```

### GC Avoidance u audio procesiranju

- Nikad alociraj nove `Float32Array` u audio processing petlji
- Koristi `copyFromChannel()`/`copyToChannel()` umesto `getChannelData()`
- Reuse typed arrays
- Izbegavaj DOM manipulaciju tokom audio procesiranja

### Visibility API — Suspend kad tab ode u background

```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    Howler.mute(true);      // ili
    audioCtx?.suspend();
  } else {
    Howler.mute(false);     // ili
    audioCtx?.resume();
  }
});
```

---

## Reference i izvori

- [Howler.js Official Docs](https://howlerjs.com/)
- [Howler.js GitHub](https://github.com/goldfire/howler.js/)
- [Howler.js Lazy Loading — Issue #1213](https://github.com/goldfire/howler.js/issues/1213)
- [Howler.js Large Sprite Mobile Crash — Issue #1151](https://github.com/goldfire/howler.js/issues/1151)
- [Howler.js Memory Leak on Unload — Issue #914](https://github.com/goldfire/howler.js/issues/914)
- [Howler.js Unload Memory — Issue #1731](https://github.com/goldfire/howler.js/issues/1731)
- [Audio for Web Games — MDN](https://developer.mozilla.org/en-US/docs/Games/Techniques/Audio_for_Web_Games)
- [Web Audio API Performance Notes — Paul Adenot](https://padenot.github.io/web-audio-perf/)
- [WebCodecs API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- [AudioDecoder — MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder)
- [Fast Playback with Preload — web.dev](https://web.dev/fast-playback-with-preload/)
- [Idle Until Urgent — Philip Walton](https://philipwalton.com/articles/idle-until-urgent/)
- [Serving Cached Audio — Chrome/Workbox](https://developer.chrome.com/docs/workbox/serving-cached-audio-and-video)
- [Autoplay Guide — MDN](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- [Opus Codec](https://opus-codec.org/)
- [Phonograph.js — Streaming Audio](https://github.com/Rich-Harris/phonograph)
- [decodeAudioData Concurrent Failures — Bugzilla 1648309](https://bugzilla.mozilla.org/show_bug.cgi?id=1648309)
- Pragmatic Play: Reverse-engineering Sweet Bonanza (`vs20fruitsw`) production build
- Play'n GO: OMNY platform analiza, playngonetwork.com CDN patterns
