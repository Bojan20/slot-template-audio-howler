#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const util = require("util");
const exec = require("child_process").exec;

const settings = JSON.parse(fs.readFileSync("settings.json"));

const audio = new Map(Object.entries(settings || {}));

const gameProjectPath = audio.get('gameProjectPath');

const distSoundFolder = "./dist/soundFiles";


function copyDirectory(path) {
    fs.readdirSync(path).forEach(element => {
        const filePath = path + "/" + element;
        let destPath = null;
        if (!element.startsWith(".") && fs.existsSync(filePath) && !fs.lstatSync(filePath).isDirectory()) {
            //process and copy file
            console.log("process " + element);
            destPath = gameProjectPath + "/assets/default/default/default/sounds/soundFiles/";

            if (destPath) {
                console.log("copy from " + filePath + " to " + destPath + element);
                if (!fs.existsSync(destPath)) {
                    fs.mkdirSync(destPath, { recursive: true });
                }
                fs.copyFileSync(filePath, destPath + element);
            }
        }
    })
}

function copySoundConfigToGame(path) {
    if (!fs.existsSync(path + "/sounds.json")) {
        console.log(path + "/sounds.json is missing, skipping");

    } else {
        let filePath = path + "/sounds.json";
        let destPath = gameProjectPath + "/assets/default/default/default/sounds";
        console.log("copy from " + filePath + " to " + destPath + "/sounds.json");
        if (!fs.existsSync(destPath)) {
            fs.mkdirSync(destPath, { recursive: true });
        }
        fs.copyFileSync(filePath, destPath + "/sounds.json");
    }
    if (!fs.existsSync(path + "/sounds.json5")) {
        console.log(path + "/sounds.json5 is missing, skipping");

    } else {
        let filePath = path + "/sounds.json5";
        let destPath = gameProjectPath + "/assets/default/default/default/sounds";
        console.log("copy from " + filePath + " to " + destPath + "/sounds.json5");
        if (!fs.existsSync(destPath)) {
            fs.mkdirSync(destPath, { recursive: true });
        }
        fs.copyFileSync(filePath, destPath + "/sounds.json5");
    }

}

function copySoundsToGame(path) {
    if (!fs.existsSync(path)) {
        console.log("Sounds Folder" + " missing, skipping...");
    } else {
        copyDirectory(path);
    }
}

if (audio !== "") {
    console.log("audio files:");
    console.log(gameProjectPath);

    if (!fs.existsSync(gameProjectPath + "/assets")) {
        console.log("Game Path " + gameProjectPath + "/assets" + " missing, skipping...");
    } else {
        copySoundConfigToGame(".");
        copySoundsToGame(distSoundFolder);
    }
}