import { getYTrefreshToken } from "./helpers.js";
import { configDotenv } from 'dotenv';
configDotenv();


getYTrefreshToken(process.env.YT_CLIENT_ID, process.env.YT_CLIENT_SECRET, process.env.YT_REDIRECT_URI);