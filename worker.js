import { configDotenv } from 'dotenv';
configDotenv();

import cron from 'node-cron';
import { mainProcess } from './index.js';
import { getCurrentPart, incrementPart } from './statemanager.js';

let isRunning = false;

async function runDailyJob() {
    if (isRunning) {
        console.log(`[${new Date().toISOString()}] Skipping — job already running.`);
        return;
    }

    isRunning = true;
    console.log(`[${new Date().toISOString()}] Starting daily job...`);
    const gameId = process.env.GAME_ID;
    const part = getCurrentPart(gameId);

    try {
        console.log("Running main process for part: #", part);

        await mainProcess({
            gameId: gameId,
            minVideoTime: Number(process.env.MIN_VIDEO_TIME),
            maxVideoTime: Number(process.env.MAX_VIDEO_TIME),
            maximumClips: Number(process.env.MAXIMUM_CLIPS),
            lowestViewCount: Number(process.env.LOWEST_VIEW_COUNT),
            daysAgo: Number(process.env.DAYS_AGO),
            title: process.env.VIDEO_TITLE,
            part: part
        })


        incrementPart(gameId);

    } catch (error) {
        console.error("Error during daily job execution:", error);
        process.exit(1);
    }

    isRunning = false;
    console.log(`[${new Date().toISOString()}] Daily job completed.`);

}

// Cron running every day at midnight UTC
cron.schedule('0 0 * * *', () => {
    runDailyJob();
},
    { timezone: "UTC" }
);

// Keep the Node.js process running (when not using PM2)
/* process.stdin.resume(); */




/* 
pm2 start ecosystem.config.cjs
pm2 stop daily-worker
pm2 restart daily-worker
pm2 logs daily-worker
*/

