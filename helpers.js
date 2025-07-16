
import dayjs from 'dayjs';
import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer';
import ffmpeg from 'fluent-ffmpeg';
import { createCanvas, loadImage } from 'canvas';
import { spawn } from 'child_process';
import { gameThumbnails } from './game-thumbnails.js';



export async function getAccesToken(client_id, client_secret){
    console.log("Fetching access token from Twitch...");

    if (!client_id || !client_secret) {
        throw new Error("Client ID and Client Secret are required to fetch the access token.");
    }

    console.log(`Client ID: ${client_id}`);
    console.log(`Client Secret: ${client_secret}`);

    const response = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            client_id: client_id,
            client_secret: client_secret,
            grant_type: "client_credentials"
        })
    });

    if (!response.ok) {
        throw new Error(`Error fetching access token: ${response.statusText}`);
    }

    const data = await response.json();
    return data.access_token;
}

export async function getClipsFromTwitch(accessToken, clientId, gameId , lowestViewCount, maximumClips = 60, daysAgo = 7) {
    console.log("Fetching clips from Twitch...");

    if (!accessToken || !clientId) {
        throw new Error("Access Token and Client ID are required to fetch clips.");
    }

    if (!gameId) {
        throw new Error("Game ID is required to fetch clips.");
    }



    const now = dayjs()
    console.log(now.toISOString());
    const startDate = now.subtract(daysAgo, 'day')
    console.log(startDate.toISOString());
    const baseUrl = "https://api.twitch.tv/helix/clips";



let allClips = [];
    let cursor = null;
    let keepFetching = true;

    while (keepFetching) {
        const params = new URLSearchParams({
            game_id: gameId,
            started_at: startDate.toISOString(),
            ended_at: now.toISOString(),
            first: "100"
        });

        if (cursor) {
            params.append("after", cursor);
        }

        const response = await fetch(`${baseUrl}?${params.toString()}`, {
            method: "GET",
            headers: {
                "Client-ID": clientId,
                "Authorization": `Bearer ${accessToken}`,
            }
        });

        if (!response.ok) {
            throw new Error(`Error fetching clips: ${response.statusText}`);
        }

        const result = await response.json();

        const filtered = result.data.filter(clip => clip.view_count >= lowestViewCount);

        // Make sure we don't exceed the maximum number of clips inside of allClips
        if (allClips.length + filtered.length > maximumClips) {
            // Make sure videos with the lowest view count are removed first
            filtered.sort((a, b) => a.view_count - b.view_count);
            const excessCount = allClips.length + filtered.length - maximumClips;
            filtered.splice(0, excessCount);
            console.log(`Exceeded maximum clips limit. Removed ${excessCount} clips with the lowest view counts.`);
        }
        
        allClips.push(...filtered);

        console.log(`Fetched ${filtered.length} clips, total: ${allClips.length}`);

        // We fetch until we get clips with less views than the lowestViewCount or no more clips are available
        if (result.data.length !== filtered.length || !result.pagination?.cursor || allClips.length >= maximumClips) {
            keepFetching = false;
        } else {
            cursor = result.pagination.cursor;
        }
    }

    return allClips;

}

export async function downloadClip(clip) {
    const clipUrl = clip.url;
    const outputDir = path.join('clips');
    const outputPath = path.join(outputDir, `${clip.id}.mp4`);

    fs.mkdirSync(outputDir, { recursive: true });

    console.log(`🚀 Visiting: ${clipUrl}`);

    const browser = await puppeteer.launch({
        headless: true, // Set to false if we want to see the browser
        defaultViewport: null,
        args: ['--window-size=1920,1080']
    });

    const page = await browser.newPage();
    await page.goto(clipUrl, { waitUntil: 'networkidle2' });

    // Find and click the Share button
    const buttons = await page.$$('button');
    let shareButton = null;
    for (const btn of buttons) {
        const text = await btn.evaluate(node => node.innerText.trim());
        if (text.toLowerCase() === 'share') {
            shareButton = btn;
            break;
        }
    }

    if (!shareButton) {
        console.warn('❌ Share button not found.');
        await browser.close();
        return;
    }

    console.log('✅ Clicking Share button...');
    await shareButton.click();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for the share menu to open

    // Find the Download Landscape Version link
    const mp4Url = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a'));
        const link = anchors.find(a => {
            const text = a.textContent?.replace(/\s+/g, ' ').trim().toLowerCase();
            return text === 'download landscape version' && a.href.includes('.mp4');
        });
        return link?.href || null;
    });

    if (!mp4Url) {
        console.error('❌ Could not find download link.');
        await browser.close();
        return;
    }

    console.log(`📥 Download URL: ${mp4Url}`);

    // Use Puppeteer's user agent + referer in node-fetch
    const userAgent = await page.evaluate(() => navigator.userAgent);

    await browser.close(); // We don't need Puppeteer anymore

    // Download in Node using fetch with proper headers
    console.log('⬇️ Downloading with node-fetch...');
    const res = await fetch(mp4Url, {
        headers: {
            'User-Agent': userAgent,
            'Referer': clipUrl
        }
    });

    if (!res.ok) {
        throw new Error(`❌ Failed to download clip: ${res.status} ${res.statusText}`);
    }

    const buffer = await res.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(buffer));
    console.log(`✅ Clip saved to: ${outputPath}`);

    return {
        filePath: outputPath,
        broadcaster: clip.broadcaster_name,
        duration: clip.duration,
        viewCount: clip.view_count,
        url: clipUrl,
    }
}
// add max videos to distributeClipsForVideo function
export function distributeClipsForVideo(clips, minVideoTime, maxVideoTime, maxVideos) {
  const sorted = [...clips].sort((a, b) => b.viewCount - a.viewCount);
  const totalDuration = sorted.reduce((sum, clip) => sum + clip.duration, 0);
  const estimatedVideoCount = Math.ceil(totalDuration / maxVideoTime);

  const buckets = Array.from({ length: estimatedVideoCount }, () => []);

  // Round-robin assign clips to buckets
  for (let i = 0; i < sorted.length; i++) {
    const bucketIndex = i % estimatedVideoCount;
    buckets[bucketIndex].push(sorted[i]);
  }

  const result = [];

  for (let i = 0; i < buckets.length; i++) {
    const group = buckets[i];
    const video = [];
    let total = 0;

    for (const clip of group) {
      if (total + clip.duration > maxVideoTime) continue;
      video.push(clip);
      total += clip.duration;
    }

    if (total >= minVideoTime) {
      video.sort((a, b) => b.viewCount - a.viewCount);
      const [top, ...rest] = video;
      result.push({
        videoIndex: i + 1,
        clips: [top, ...shuffleArray(rest)]
      });
    }
  }

  return result;
}

function shuffleArray(array) {
  const arr = [...array]; // copy to avoid mutating the original
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}


export async function callPythonVideoComposer(videoData, index, gameId) {
  const inputDir = `temp/video_${index}`;
  const inputJsonPath = path.join(inputDir, 'input.json');

  fs.mkdirSync(inputDir, { recursive: true });

  fs.writeFileSync(
    inputJsonPath,
    JSON.stringify({
      index,
      gameId,
      clips: videoData.clips
    }, null, 2)
  );

  // 🔧 Return a Promise that resolves only when the process finishes
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python', ['video_composer.py', inputJsonPath]);

    pythonProcess.stdout.on('data', (data) => {
      console.log(`[PYTHON STDOUT] ${data.toString().trim()}`);
    });


    let stderrBuffer = '';
    pythonProcess.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
       if (stderrBuffer.length > 1000) {
        console.error(`[PYTHON ERROR] ${stderrBuffer.trim()}`);
        stderrBuffer = '';
      }
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Python process for video_${index} finished successfully.`);
        resolve();
      } else {
        reject(new Error(`❌ Python process for video_${index} exited with code ${code}`));
      }
    });
  });
}


export async function prepareClipOverlays(distributedClips, gameId) {
  for (const video of distributedClips) {
    const videoIndex = video.videoIndex;
    const tempDir = path.join('temp', `video_${videoIndex}`);
    fs.mkdirSync(tempDir, { recursive: true });

    for (let i = 0; i < video.clips.length; i++) {
      const clip = video.clips[i];
      const badgePath = path.join(tempDir, `badge_${i}.png`);
      const outputPath = path.join(tempDir, `clip_${i}.mp4`);
      const gameImageUrl = gameThumbnails[gameId];

      if (!gameImageUrl) throw new Error(`Missing thumbnail for gameId: ${gameId}`);

      // Generate badge
      await generateOverlayImage({
        gameImageUrl,
        username: clip.broadcaster,
        outputPath: badgePath
      });

      // Overlay badge with FFmpeg
      await new Promise((resolve, reject) => {
        ffmpeg(clip.filePath)
          .input(badgePath)
          .complexFilter([
            "[0:v][1:v] overlay=0:(main_h-overlay_h)/2:enable='lt(t,3)'"
          ])
          .outputOptions([
            '-preset veryfast',
            '-c:v libx264',
            '-c:a aac',
            '-b:a 192k',
            '-movflags +faststart'
          ])
          .audioFilters('loudnorm')
          .on('end', () => {
            clip.filePath = outputPath; // Update to new clip path
            resolve();
          })
          .on('error', reject)
          .save(outputPath);
      });
    }
  }
}

export async function generateOverlayImage({ gameImageUrl, username, outputPath }) {
  const width = 500;
  const height = 100;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background box
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, width, height);

  // Load and draw game image
  const image = await loadImage(gameImageUrl);
  const imgHeight = 80;
  const imgWidth = (image.width / image.height) * imgHeight;
  ctx.drawImage(image, 10, 10, imgWidth, imgHeight);

  // Username text
  ctx.fillStyle = 'white';
  ctx.font = 'bold 28px Arial';
  ctx.fillText(`@${username}`, imgWidth + 30, height / 2 + 10);

  // Save to file
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);
}


export async function cleanUpTempFolderAndClipsFolder() {
  const tempDir = 'temp';
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(`✅ Cleaned up temporary folder: ${tempDir}`);
  fs.mkdirSync(tempDir, { recursive: true });
  console.log(`✅ Recreated temporary folder: ${tempDir}`);
  const clipsDir = 'clips';
  fs.rmSync(clipsDir, { recursive: true, force: true });
  console.log(`✅ Cleaned up clips folder: ${clipsDir}`);
  fs.mkdirSync(clipsDir, { recursive: true });
  console.log(`✅ Recreated clips folder: ${clipsDir}`);
}







