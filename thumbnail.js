import { generateThumbnailForVideo } from "./helpers.js";
import fs from 'fs';

const videosDataJson = fs.readFileSync('./output/videos_data.json');
const videosData = JSON.parse(videosDataJson);


const thumbnail = videosData[`video_1`].thumbnail;


const thumbnailPath = await generateThumbnailForVideo(thumbnail, "IRACING", 23)


console.log("Thumbnail generated at path:", thumbnailPath);

