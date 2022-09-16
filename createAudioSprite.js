const audiosprite = require('./customAudioSprite');
const fs = require('fs');
const pathToFFmpeg = require('ffmpeg-static');

console.log("pathToFFmpeg ->", pathToFFmpeg);

const sourceSndFiles = './sourceSoundFiles/';
const outDir = './dist/audioSprite/';

fs.mkdirSync(outDir, { recursive: true });


const audioFiles = fs.readdirSync(sourceSndFiles).map(dir => sourceSndFiles + dir);

console.log("audioFiles-->", audioFiles);

var opts = {
    output: outDir + 'SlotTemplateAudioSprite_SL',
    format: 'howler2',
    logger: {
        debug: console.log,
        info: console.log,
        log: console.log,
    }
}

audiosprite(pathToFFmpeg, audioFiles, opts, function(err, obj) {
    if (err) return console.error(err)

    const dataText = 'export default ' + JSON.stringify(obj, null, 2);
    fs.writeFile(outDir + "soundData.js", dataText, function(err) {
        if (err) {
            throw err;
        }
        console.log('complete');
    });
});