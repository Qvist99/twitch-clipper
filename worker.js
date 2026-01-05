import { configDotenv } from 'dotenv';
import { shouldRunFunction } from './helpers.js';
configDotenv();

import { mainProcess } from './index.js';
import { getCurrentPart, incrementPart } from './statemanager.js';

async function runDailyJob() {
    console.log(`[${new Date().toISOString()}] Starting daily job...`);

    const gameId = process.env.GAME_ID;

    if (!shouldRunFunction(gameId)) {
        console.log(`[${new Date().toISOString()}] Skipping job for gameId ${gameId} as per configuration.`);
        process.exit(0);
    }

    const part = getCurrentPart(gameId);

    try {
        console.log("Running main process for part: #", part);

        await mainProcess({
            gameId: gameId,
            minVideoTime: Number(process.env.MIN_VIDEO_TIME),
            maxVideoTime: Number(process.env.MAX_VIDEO_TIME),
            lowestViewCount: Number(process.env.LOWEST_VIEW_COUNT),
            daysAgo: Number(process.env.DAYS_AGO),
            title: process.env.VIDEO_TITLE,
            part: part
        });

        incrementPart(gameId);

        console.log(`[${new Date().toISOString()}] Daily job completed successfully.`);

    } catch (error) {
        console.error("Error during daily job execution:", error);
        process.exit(1);
    }

    // Exit cleanly when done
    process.exit(0);
}

// Run the daily job immediately (PM2 will schedule via cron)
runDailyJob();



/* 
pm2 start ecosystem.config.cjs
pm2 stop daily-worker
pm2 restart daily-worker
pm2 logs daily-worker
*/

