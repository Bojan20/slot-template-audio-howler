# playa-slot-template-audio

Repository for Audio Team to place audio assets.
Must be synced with the game repo in order for changes to be in a build. 
Audio changes can be done directly in the game repo but should be synced with the audio repo for archiving purposes.

AudioNamingConvention.xlsx included for reference.

Replace "PlayaTemplate" with the game name for the file PlayaTemplate_AudioSpec.xlsx

.json5 files are no longer supported. Please do not use json5

sourceSoundFiles folder is only for the original .WAV audio files, use only for archiving the game once complete. Can include the individual sounds, sound sprites (SL_) with markers, or both.

INFO ON HOW TO USE MAKE MY JSON 3.0:

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

yarn build-audio
This script will generate a new sounds.json file, based on the files found in "SourceSoundDirectory".  It will generate a new soundmanifest, sprites, and spritelists based on the files found, and will use additional settings found in JSONtemplate for sprites or spritelists, as well as keeping all the commands found in the template.  It will save the new sounds.json file to the "JSONtarget" location.  If you are happy with the newly generated file, you can rename it to the "JSONtemplate" name and it can be used for future invocations of the script.

yarn deploy
To copy the audio files from this repo into your game repo, run "yarn deploy" in this folder.  The script reads in configuration params from the adjacent settings.json file so make sure and update those with the correct relative paths to your game project for your game.
# ------------------------------------------------------------------------------------------------

Instructions to publish audioSprite audio files and audioSprite based sound.json file are as follows -

yarn build-audio

old style 

yarn build-audioSprite 

This command will pick up all input sourceSoundFiles folder's wav files and combine them to create audioSprite with different possible soundFormats ogg, mp4, aac, wav. Currently its set to publish m4a audioSprites. This file get exported and published to 'dist -> soundFiles -> SlotTemplateAudioSprite_SL.m4a'

Along with it will also create soundData.json which has start and end time for each sprite.
Then it will generate sounds.json file based on soundData.json and sounds.json (source file at root level)
After this step soundData.json is auto deleted.

Sound Engineer can copy soundFiles folder and sounds.json file from dist folder and directly copy paste this into the game. 


