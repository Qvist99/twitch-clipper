import fs from 'fs';
import { getClipsFromTwitch, getAccesToken, downloadClip, distributeClipsForVideo, callPythonVideoComposer, prepareClipOverlays, cleanUpTempFolderAndClipsFolder, uploadVideoToYoutube, generateThumbnailForVideo } from './helpers.js';
import { configDotenv } from 'dotenv';
configDotenv();


export async function mainProcess({
    gameId,
    minVideoTime,
    maxVideoTime,
    lowestViewCount,
    daysAgo,
    title,
    part
}) {
    console.log(gameId, minVideoTime, maxVideoTime, lowestViewCount, daysAgo);

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

    const clips = await getClipsFromTwitch(accessToken, process.env.TWITCH_CLIENT_ID, gameId, lowestViewCount, daysAgo, maxVideoTime, minVideoTime);

    if (!clips || clips.length === 0) {
        console.error("No clips found or failed to fetch clips.");
        process.exit(1);
    }

    console.log("Clips fetched successfully:", clips.length);

    const downloadedClips = [];

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

    if (filteredDownloadedClips.length === 0) {
        console.error("No clips left after filtering. Exiting.");
        process.exit(1);
    }


    const distributedClips = distributeClipsForVideo(filteredDownloadedClips);

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

    // upload to youtube 
    // Get the videos_data.json file which contains info about all created videos
    const videosDataJson = fs.readFileSync('./output/videos_data.json');
    const videosData = JSON.parse(videosDataJson);

    for (const [i] of distributedClips.entries()) {
        const currentPart = part + i
        const videoFilePath = `./output/final_video_${i + 1}.mp4`;

        const currentMonth = new Date().toLocaleString('default', { month: 'long' });
        const currentYear = new Date().getFullYear();
        const videoTitle = `${title} #${currentPart} | ${currentMonth} ${currentYear}`
        const description = videosData[`video_${i + 1}`].description;
        const tags = []  // In future maybe add some relevant tags


        const oauthSecrets = {
            client_id: process.env.YT_CLIENT_ID,
            client_secret: process.env.YT_CLIENT_SECRET,
            redirect_uri: process.env.YT_REDIRECT_URI,
        }


        // Create thumbnail for the video and set the thumbnailPath variable accordingly
        const thumbnailPath = await generateThumbnailForVideo(videosData[`video_${i + 1}`].thumbnail, "IRACING", currentPart);


        await uploadVideoToYoutube(
            oauthSecrets,
            videoFilePath,
            videoTitle,
            description,
            thumbnailPath,
            tags
        )

        part++;
    }

    // cleanup output folder
    const outputDir = 'output';

    fs.rmSync(outputDir, { recursive: true, force: true });
    console.log(`✅ Cleaned up output folder: ${outputDir}`);

    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`✅ Recreated output folder: ${outputDir}`);

    return
    // Exit the process gracefully
    process.exit(0);

}

