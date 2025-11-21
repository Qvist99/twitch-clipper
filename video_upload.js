import fs from 'fs';
import { uploadVideoToYoutube, generateThumbnailForVideo } from './helpers.js';

import { configDotenv } from 'dotenv';
configDotenv();

const currentPart = 4

const oauthSecrets = {
            client_id: process.env.YT_CLIENT_ID,
            client_secret: process.env.YT_CLIENT_SECRET,
            redirect_uri: process.env.YT_REDIRECT_URI,
            refresh_token: process.env.YT_REFRESH_TOKEN
        }

const videosDataJson = fs.readFileSync('./output/videos_data.json');
const videosData = JSON.parse(videosDataJson);

const videoFilePath = `./output/final_video_1.mp4`;

const thumbnailPath = await generateThumbnailForVideo(videosData[`video_1`].thumbnail, "IRACING", currentPart);

const videoTitle = "iRacing Daily Clips #4 | November 2025"
const description = videosData[`video_1`].description;
const tags = []


await uploadVideoToYoutube(
            oauthSecrets,
            videoFilePath,
            videoTitle,
            description,
            thumbnailPath,
            tags
        )