import { getClipsFromTwitch, getAccesToken, downloadClip, distributeClipsForVideo, callPythonVideoComposer, prepareClipOverlays, cleanUpTempFolderAndClipsFolder } from './helpers.js';
import { blacklists } from './blacklists.js';
import { configDotenv } from 'dotenv';
configDotenv();


export async function mainProcess({
    gameId, 
    minVideoTime, 
    maxVideoTime , 
    maximumClips, 
    lowestViewCount
}) {
    console.log(gameId, minVideoTime, maxVideoTime, maximumClips, lowestViewCount);

if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
    console.error("Please set the TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET environment variables.");
    process.exit(1);
}

const accessToken = await getAccesToken(process.env.TWITCH_CLIENT_ID, process.env.TWITCH_CLIENT_SECRET);

if (!accessToken) {
    console.error("Failed to retrieve access token.");
    process.exit(1);
}

console.log("Access Token received:", accessToken);

const clips = await getClipsFromTwitch(accessToken, process.env.TWITCH_CLIENT_ID, gameId, lowestViewCount, maximumClips);

if (!clips || clips.length === 0) {
    console.error("No clips found or failed to fetch clips.");
    process.exit(1);
}

console.log("Clips fetched successfully:", clips.length);

const downloadedClips =  [];

for (const clip of clips) {
    try {
        console.log(`Downloading clip: ${clip.id} - ${clip.title}`);
        const result = await downloadClip(clip);
        console.log(`Successfully downloaded clip: ${clip.id}`);
        downloadedClips.push(result);
        await new Promise(resolve => setTimeout(resolve, 1500)); // Throttle requests to avoid rate limiting
    } catch (error) {
        console.error(`Failed to download clip ${clip.id}:`, error);
        continue;
    }
}
console.log("All clips processed. Downloaded clips:", downloadedClips);

// filter out potentiall undefined results in the downloadedClips array
const filteredDownloadedClips = downloadedClips.filter(clip => clip !== undefined);

const blacklistBroadcasters = blacklists[gameId] || []; // Blacklisted broadcasters to exclude from the final video compilation

const filteredClips = filteredDownloadedClips.filter(clip => !blacklistBroadcasters.includes(clip.broadcaster));

if (filteredClips.length === 0) {
    console.error("No clips left after filtering. Exiting.");
    process.exit(1);
}


const distributedClips = distributeClipsForVideo(filteredClips, minVideoTime, maxVideoTime);

await prepareClipOverlays(distributedClips, gameId);

for (const [i, videoClips] of distributedClips.entries()) {
  console.log(`🎬 Starting video ${i + 1}/${distributedClips.length}`);
  await callPythonVideoComposer(videoClips, i + 1, gameId);
  console.log(`✅ Finished video ${i + 1}`);
}

console.log("All videos processed successfully.");

console.log("Cleaning up temporary files...");
await cleanUpTempFolderAndClipsFolder();
console.log("Temporary files cleaned up successfully.");

console.log("Process completed successfully. All videos are ready.");
// Exit the process gracefully
process.exit(0);

} 

