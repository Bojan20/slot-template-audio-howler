#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const util = require("util");
const exec = require("child_process").exec;
var sox = require('sox');
const exiftool = require('node-exiftool')
const ep = new exiftool.ExiftoolProcess();
const settings = JSON.parse(fs.readFileSync("settings.json"));
const sndData = JSON.parse(fs.readFileSync("dist/soundFiles/soundData.json"));
const audioSettings = new Map(Object.entries(settings || {}));
const sndDataEntries = new Map(Object.entries(sndData || {}));
const sndSpriteEntries = sndDataEntries.get("sprite");
const JSONtemplate = audioSettings.get('JSON2template');
const JSONtarget = audioSettings.get('JSON2target');
const SourceSoundDirectory = audioSettings.get('SourceSoundDirectory');
const DestinationSoundDirectory = audioSettings.get('DestinationSoundDirectory');
const DestinationAudioSpriteDirectory = audioSettings.get('DestinationAudioSpriteDirectory');



//const sndData = (fs.readFileSync('soundFiles/audioSprite/soundData.js'), "utf8");
//console.log(" sound Data file " + sndSpriteEntries.BaseMusicLoop[0]);

let myNewJson = {};
let myNewSoundDefinitions = {};
let myNewSoundManifest = [];
let myNewSoundSprites = {};
let myNewSpriteLists = {};
let originalCommands;
let originalSprites;
let originalSpriteLists;
let soundProcessCount = 0;

async function processOriginalJson() {
    console.log("Reading template File: " + JSONtemplate);
    const originalFile = JSON.parse(fs.readFileSync(JSONtemplate));
    const originalJson = new Map(Object.entries(originalFile || {}));
    originalCommands = (originalJson.get('soundDefinitions').commands || {});
    originalSprites = (originalJson.get('soundDefinitions').soundSprites || {});
    originalSpriteLists = (originalJson.get('soundDefinitions').spriteList || {});

    myNewSoundDefinitions.soundSprites = {};
    myNewSoundDefinitions.spriteList = {};
    myNewSoundDefinitions.commands = originalCommands;
    processSourceManifest();
    processSourceSprites();
}

function finishProcessOrignalJson() {
    console.log("Writing File and exiting: " + JSONtarget);
    myNewJson.soundManifest = myNewSoundManifest;
    myNewSoundDefinitions.commands = originalCommands;
    myNewSoundDefinitions.spriteList = originalSpriteLists; // Allow temp spritelists to be copied over to exported sounds-audioSprite.json.
    /*myNewSoundDefinitions.spriteList = Object.keys(myNewSpriteLists).sort().reduce(
        (obj, key) => {
            obj[key] = myNewSpriteLists[key];
            return obj;
        }, {}
    );*/
    myNewSoundDefinitions.soundSprites = Object.keys(myNewSoundSprites).sort().reduce(
        (obj, key) => {
            obj[key] = myNewSoundSprites[key];
            return obj;
        }, {}
    );
    myNewJson.soundDefinitions = myNewSoundDefinitions;
    fs.writeFileSync(JSONtarget, formatJson(JSON.stringify(myNewJson)));
    process.exit(0);
}

function formatJson(input) {
    return input
        .replace(/]},/g, ']},\n')
        .replace(/}],/g, '}],\n')
        .replace(/},"/g, '},\n"')
        .replace(/"soundManifest":/g, '\n"soundManifest":\n')
        .replace(/"soundDefinitions":/g, '\n"soundDefinitions":\n')
        .replace(/"commands":/g, '\n"commands":\n')
        .replace(/"spriteList":/g, '\n"spriteList":\n')
        .replace(/"soundSprites":/g, '\n"soundSprites":\n')
}

function processSourceManifest() {
    console.log("creating manifest");
    fs.readdirSync(DestinationAudioSpriteDirectory).forEach(element => {
        let myNewEntry = {};
        if (element.endsWith(".wav")) {
            let id = element.substring(0, element.length - 4);
            let src = [];
            let entry = {};
            src.push(DestinationSoundDirectory + "/" + id + ".ogg");
            src.push(DestinationSoundDirectory + "/" + id + ".m4a");
            entry.id = id;
            entry.src = src;
            myNewSoundManifest.push(entry);
        } else {
            console.log("problem with file " + element + " not ending with .wav");
        }
    });
}

function processSpriteList(element) {
    let srcPath = sndDataEntries.get("src")[0];
    let srcWords = srcPath.split("/");
    let soundId = srcWords[3].substring(0, srcWords[3].length - 4);
    let duration = [];
    let startTime = [];
    let spriteNames = [];
    let totalDuration = 0;
    soundProcessCount++;
    console.log("Processcing spritelist " + soundProcessCount + " File: " + element);
    sox.identify(SourceSoundDirectory + "/" + element, async function(err, results) {
        /* results looks like:
        {
            format: 'wav',
            duration: 1.5,
            sampleCount: 66150,
            channelCount: 1,
            bitRate: 722944,
            sampleRate: 44100,
        }
        */
        totalDuration = Math.round(results.sampleCount * 100000 / results.sampleRate) / 100;
        let mySpriteListData = await extractSpriteListData(SourceSoundDirectory + "/" + element);
        if (mySpriteListData.TracksMarkersName) {
            for (let i = 0; i < mySpriteListData.TracksMarkersName.length; i++) {
                if (mySpriteListData.TracksMarkersName[i].startsWith('Tempo:')) {} else {
                    spriteNames.push(mySpriteListData.TracksMarkersName[i]);
                    startTime.push(Math.round(mySpriteListData.TracksMarkersStartTime[i] * 100000 / results.sampleRate) / 100);
                }
            }
            for (let i = 0; i < spriteNames.length; i++) {
                if (i < (spriteNames.length - 1)) {
                    duration.push(Math.round((startTime[i + 1] - startTime[i]) * 100) / 100);
                } else {
                    duration.push(Math.round((totalDuration - startTime[i]) * 100) / 100);
                }
            }
        }
        //build spritelist
        let spriteListName = 'sl_' + soundId;
        let myNewSpriteList = originalSpriteLists[spriteListName] || {};
        myNewSpriteList.items = [];
        if (!myNewSpriteList.type) {
            myNewSpriteList.type = "random";
        }
        if (!myNewSpriteList.overlap) {
            myNewSpriteList.overlap = "true";
        }
        spriteNames.forEach(element => {
            myNewSpriteList.items.push('s_' + element);
        });
        //add sprites
        for (let i = 0; i < spriteNames.length; i++) {
            let entryName = "s_" + element;
            let myNewEntry = originalSprites[entryName] || {};
            myNewEntry.spriteId = 's_' + spriteNames[i];
            myNewEntry.soundId = soundId;
            myNewEntry.startTime = startTime[i];
            myNewEntry.duration = duration[i];
            myNewEntry.tags = originalSprites[myNewEntry.spriteId] ? originalSprites[myNewEntry.spriteId].tags || ["SoundEffects"] : ["SoundEffects"];
            myNewSoundSprites[myNewEntry.spriteId] = myNewEntry;
        }

        myNewSpriteLists[spriteListName] = myNewSpriteList;

        soundProcessCount--;
        if (soundProcessCount <= 0) {
            finishProcessOrignalJson();
        }
    });
}
async function processSourceSprites() {
    fs.readdirSync(SourceSoundDirectory).forEach(element => {
        if (element.endsWith("_SL.wav")) {
            processSpriteList(element);
        } else if (element.endsWith(".wav")) {
            let spriteId = element.substring(0, element.length - 4);
            let srcPath = sndDataEntries.get("src")[0];
            let srcWords = srcPath.split("/");
            let soundId = srcWords[3].substring(0, srcWords[3].length - 4);
            let entryName = "s_" + spriteId;
            let myNewEntry = (originalSprites[entryName] || {});
            let duration = 0;
            let startTime = 0;
            soundProcessCount++;
            console.log("Processing Sprite " + spriteId);
            sox.identify(SourceSoundDirectory + '/' + element, function(err, results) {
                /* results looks like:
                {
                  format: 'wav',
                  duration: 1.5,
                  sampleCount: 66150,
                  channelCount: 1,
                  bitRate: 722944,
                  sampleRate: 44100,
                }
                */
                duration = Math.round(results.sampleCount * 100000 / results.sampleRate) / 100;
                myNewEntry.spriteId = spriteId;
                myNewEntry.soundId = soundId;
                myNewEntry.startTime = sndSpriteEntries[spriteId][0];
                myNewEntry.duration = duration;
                myNewEntry.tags = originalSprites[entryName] ? originalSprites[entryName].tags || ["SoundEffects"] : ["SoundEffects"];
                myNewSoundSprites[entryName] = myNewEntry;
                soundProcessCount--;
                if (soundProcessCount <= 0) {
                    finishProcessOrignalJson();
                }
            });


        } else {
            console.log("problem with file " + element + " not ending with .wav, skipping");
        }
    });
}

async function extractSpriteListData(element) {
    let mySpriteListData = {};
    await ep
        .open()
        // display pid
        .then(() => ep.readMetadata(element, ['-s3']))
        .then((x) => {
            mySpriteListData.TracksMarkersName = x.data[0].TracksMarkersName;
            mySpriteListData.TracksMarkersStartTime = x.data[0].TracksMarkersStartTime;
        }, console.error)
        .then(() => console.log('Loaded metadata: ' + element))
        .then(() => {
            if (ep.isOpen)
                ep.close();
        })
        .catch(console.error);
    return mySpriteListData;
}

function processSourceSounds() {
    fs.readdirSync(SourceSoundDirectory).forEach(element => {
        sox.identify(SourceSoundDirectory + '/' + element, function(err, results) {
            /* results looks like:
            {
              format: 'wav',
              duration: 1.5,
              sampleCount: 66150,
              channelCount: 1,
              bitRate: 722944,
              sampleRate: 44100,
            }
            */
            console.log("file: " + element + " " + JSON.stringify(results));
        });
    });
}

processOriginalJson();