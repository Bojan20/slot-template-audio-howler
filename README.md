# slot-template-audio-howler
Repository for Audio Team to place audio assets

Script prerequisites:
Yarn or Npm package manager (for these examples we use Yarn) https://yarnpkg.com/getting-started/install
Exiftool https://exiftool.org/
Sox Sound Exchange http://sox.sourceforge.net/
All three of these need to be added to your path and work from the command line to the scripts to work.

To install: type "yarn" from this directory.

Usage: please alter the settings.json to conform to the needs of your project.

"gameProjectPath" is the local location of you game folder
"JSONtemplate" is the file used as a starting point to generate a new sounds.json
"JSONtarget" is where the newly generated file is saved
"SourceSoundDirectory" the directory where the source .wav files are kept
"DestinationSoundDirectory" the location where the aac & ogg files are kept which will be used by the game


you can run two scripts in this folder:

$yarn build-sounds
This script will generate a new sounds.json file, based on the files found in "SourceSoundDirectory".  It will generate a new soundmanifest, sprites, and spritelists based on the files found, and will use additional settings found in JSONtemplate for sprites or spritelists, as well as keeping all the commands found in the template.  It will save the new sounds.json file to the "JSONtarget" location.  If you are happy with the newly generated file, you can rename it to the "JSONtemplate" name and it can be used for future invocations of the script.

$yarn deploy
To copy the audio files from this repo into your game repo, run "yarn deploy" in this folder.  The script reads in configuration params from the adjacent settings.json file so make sure and update those with the correct relative paths to your game project for your game.



