import dayjs from 'dayjs';
import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer';
import ffmpeg from 'fluent-ffmpeg';
import { createCanvas, loadImage, } from 'canvas';
import { spawn } from 'child_process';
import { gameThumbnails } from './game-thumbnails.js';
import { google } from 'googleapis';
import readline from 'readline';
import { blacklists } from './blacklists.js';
import { saveTokens, loadTokens } from './tokenStore.js';

export async function getAccesToken(client_id, client_secret) {
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

export async function getClipsFromTwitch(accessToken, clientId, gameId, lowestViewCount, daysAgo = 7, maxVideoTime, minVideoTime) {
  console.log("Fetching clips from Twitch...");

  if (!accessToken || !clientId) {
    throw new Error("Access Token and Client ID are required to fetch clips.");
  }

  if (!gameId) {
    throw new Error("Game ID is required to fetch clips.");
  }

  if (!maxVideoTime || !minVideoTime) {
    throw new Error("Max and Min video time are required to fetch clips.");
  }



  const now = dayjs()
  console.log(now.toISOString());
  const startDate = now.subtract(daysAgo, 'day')
  console.log(startDate.toISOString());
  const baseUrl = "https://api.twitch.tv/helix/clips";


  let durationOfAllClips = 0;
  let allClips = [];
  let cursor = null;
  let keepFetching = true;

  const blacklistBroadcasters = blacklists[gameId] || []; // Blacklisted broadcasters to exclude from the final video compilation

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

    // remove blacklisted broadcasters from the filtered clips and clips with view count lower than lowestViewCount
    const filtered =
      result.data.filter(clip =>
        clip.view_count >= lowestViewCount &&
        !blacklistBroadcasters.includes(clip.broadcaster_name)
      );

    if (filtered.length === 0) {
      console.log("No more clips meeting the criteria were found.");
      break;
    }


    for (const clip of filtered) {
      if (durationOfAllClips + clip.duration > maxVideoTime) {
        keepFetching = false;
        break;
      }

      allClips.push(clip);
      durationOfAllClips += clip.duration;

    }

    //filter through the clips to make sure we dont have any duplicates
    allClips = dedupeClips(allClips);

    // recalculate total duration after deduplication. Good if we have to run the loop multiple times
    durationOfAllClips = allClips.reduce((sum, clip) => sum + clip.duration, 0);

    console.log(`Total clips collected so far: ${allClips.length}, Total duration: ${durationOfAllClips.toFixed(2)} seconds`);

    // Keep fetching as we yet have reached maxVideoTime or ran out of clips meeting the minimum view count criteria
    if (!result.pagination?.cursor) {
      keepFetching = false;
    } else {
      cursor = result.pagination.cursor;
    }
  }


  if (durationOfAllClips < minVideoTime) {
    console.log(`Total duration of clips (${durationOfAllClips.toFixed(2)} seconds) is less than the minimum required (${minVideoTime} seconds).`);
    return [];
  }

  return allClips;

}


export function dedupeClips(clips) {
  for (const clip of clips) {
    if (clip.vod_offset != null && clip.duration != null) {
      clip.realStart = clip.vod_offset - clip.duration;
      clip.realEnd = clip.vod_offset;
    } else {
      clip.realStart = null;
      clip.realEnd = null;
    }
  }

  const byBroadcaster = new Map();
  for (const c of clips) {
    if (!byBroadcaster.has(c.broadcaster_id)) byBroadcaster.set(c.broadcaster_id, []);
    byBroadcaster.get(c.broadcaster_id).push(c);
  }

  const result = [];

  for (const list of byBroadcaster.values()) {

    list.sort((a, b) => {
      if (a.realStart === null && b.realStart === null) {
        return new Date(a.created_at) - new Date(b.created_at);
      }
      if (a.realStart === null) return 1;
      if (b.realStart === null) return -1;
      return a.realStart - b.realStart;
    });

    let cluster = [];

    function flushCluster() {
      if (cluster.length === 0) return;
      cluster.sort((a, b) => b.view_count - a.view_count);
      result.push(cluster[0]);
      cluster = [];
    }

    for (const clip of list) {
      if (cluster.length === 0) {
        cluster.push(clip);
        continue;
      }

      const last = cluster[cluster.length - 1];

      // -----------------------------
      // CASE 1: Both clips have offsets
      // -----------------------------
      if (clip.realStart !== null && last.realStart !== null) {

        // Video IDs must match
        if (clip.video_id !== last.video_id) {
          flushCluster();
          cluster.push(clip);
          continue;
        }

        const overlap =
          Math.min(last.realEnd, clip.realEnd) -
          Math.max(last.realStart, clip.realStart);

        if (overlap > 2) {
          cluster.push(clip);
        } else {
          flushCluster();
          cluster.push(clip);
        }
        continue;
      }

      // -----------------------------
      // CASE 2: Both have null offsets → use created_at fallback
      // -----------------------------
      if (clip.realStart === null && last.realStart === null) {
        const t1 = new Date(clip.created_at);
        const t2 = new Date(last.created_at);
        const diffSec = Math.abs((t1 - t2) / 1000);

        if (diffSec <= 60) {
          cluster.push(clip);
        } else {
          flushCluster();
          cluster.push(clip);
        }
        continue;
      }

      // -----------------------------
      // CASE 3: Mixed offset/non-offset
      // -----------------------------
      flushCluster();
      cluster.push(clip);
    }

    flushCluster();
  }

  return result;
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
    thumbnail: clip.thumbnail_url
  }
}


export function distributeClipsForVideo(clips) {
  if (!clips.length) return [];

  // Sort by view count descending
  const sorted = [...clips].sort((a, b) => b.viewCount - a.viewCount);

  const [topClip, ...rest] = sorted;

  return [
    {
      videoIndex: 1,
      clips: [topClip, ...shuffleArray(rest)]
    }
  ];
}

function shuffleArray(array) {
  const arr = [...array];
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


export async function getYTrefreshToken(clientId, clientSecret, redirectUri) {
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  )

  const scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube'
  ]


  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes
  });

  console.log('Authorize this app by visiting this url:\n', authUrl);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.question("\nEnter the code from that page here: ", async (code) => {
    const { tokens } = await oauth2Client.getToken(code);

    console.log("\n✅ Your refresh token is:\n", tokens.refresh_token);

    // Save refresh token persistently
    saveTokens(tokens);

    rl.close();
  });


}

export async function uploadVideoToYoutube(
  oauthSecrets,
  videoPath,
  title,
  description,
  thumbnailPath,
  tags = [],
  categoryId = '20', // Gaming category
) {


  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file does not exist at path: ${videoPath}`);
  }

  console.log("Starting youtube upload...");

  const oauth2Client = new google.auth.OAuth2(
    oauthSecrets.client_id,
    oauthSecrets.client_secret,
    oauthSecrets.redirect_uri
  );

  const storedTokens = loadTokens();
  oauth2Client.setCredentials(storedTokens);

  oauth2Client.on("tokens", (tokens) => {
    const updated = { ...storedTokens, ...tokens };

    if (tokens.refresh_token) {
      console.log("🔄 New refresh token received from Google");
    }
    saveTokens(updated);
  });



  const youtube = google.youtube({
    version: "v3",
    auth: oauth2Client
  })

  try {
    const res = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title,
          description,
          tags,
          categoryId,
        },
        status: {
          privacyStatus: "private",
          publishAt: getNext1630UTC(),
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(videoPath)
      }
    }
    )

    const videoId = res.data.id;
    console.log(`✅ Video uploaded with ID: ${videoId}`);


    // Update the thumbnail for the video

    if (thumbnailPath && fs.existsSync(thumbnailPath)) {
      try {
        console.log("uploading thumbnail...");
        await youtube.thumbnails.set({
          videoId: videoId,
          media: {
            body: fs.createReadStream(thumbnailPath)
          }
        })
        console.log("✅ Thumbnail uploaded successfully.");

      } catch (error) {
        console.error("Error uploading thumbnail:", error.message);
      }

    }


  } catch (error) {
    if (error.errors) {
      for (const err of error.errors) {
        console.error(`YouTube API error: ${err.reason} - ${err.message}`);
      }
    } else {
      console.error("Error uploading video to YouTube:", error.message);
    }
    // We can add retry logic here if needed in the future

    throw error;
  }
}


export async function generateThumbnailForVideo(imageUrl, gameName, part) {


  const WIDTH = 1280;
  const HEIGHT = 720;

  const PAD_x = 70;
  const PAD_y = 100;

  const RED_HEIGHT = 158;
  const BLACK_HEIGHT = 97;
  const YELLOW_HEIGHT = 129;
  const TEXT_PAD = 10;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // load the background image

  const bgImage = await loadImage(resizeImageUrl(imageUrl, WIDTH, HEIGHT));
  ctx.drawImage(bgImage, 0, 0, WIDTH, HEIGHT);

  // Load texture
  const texturePath = path.join(process.cwd(), "thumbnail_utils", "fabric.png");
  const texture = await loadImage(texturePath);

  function drawTexturedBox(x, y, width, height, color) {
    // Draw the base color
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);

    // Apply texture overlay with clipping
    ctx.save();

    // Clip to the box area
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    // Tile the texture manually across the box
    for (let ty = y; ty < y + height; ty += texture.height) {
      for (let tx = x; tx < x + width; tx += texture.width) {
        ctx.drawImage(texture, tx, ty);
      }
    }

    ctx.restore();

    // Now blend the color on top using a multiply-like effect
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
    ctx.restore();
  }


  function drawTextBox(text, yOffset, height, fontSize, boxColor, textColor, textBorderColor) {
    ctx.font = `bold ${fontSize}px "Sans"`;
    const textWidth = ctx.measureText(text).width;
    const boxWidth = textWidth + TEXT_PAD * 2;

    drawTexturedBox(PAD_x, yOffset, boxWidth, height, boxColor);

    ctx.textBaseline = "middle";

    // Draw text border/stroke first
    ctx.strokeStyle = textBorderColor;
    ctx.lineWidth = 4; // Adjust thickness as needed
    ctx.strokeText(text, PAD_x + TEXT_PAD, yOffset + height / 2);

    // Draw text fill on top
    ctx.fillStyle = textColor;
    ctx.fillText(text, PAD_x + TEXT_PAD, yOffset + height / 2);

    return height;
  }


  let currentY = PAD_y;

  currentY += drawTextBox(
    gameName.toUpperCase(),
    currentY,
    RED_HEIGHT,
    128,
    "#FF250D",
    "white",
    "#A3A3A3"
  );

  currentY += drawTextBox(
    "DAILY CLIPS",
    currentY,
    BLACK_HEIGHT,
    79,
    "#5f5f5fff",
    "white",
    "#A3A3A3"
  );

  drawTextBox(
    `#${part}`,
    currentY,
    YELLOW_HEIGHT,
    86,
    "#F1CF12",
    "black",
    "#D0CA06"
  );


  const outputDir = path.join(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  const filePath = path.join(outputDir, `thumbnail_video_${part}.png`);
  const buffer = canvas.toBuffer("image/png");

  fs.writeFileSync(filePath, buffer);

  console.log(`Thumbnail saved: ${filePath}`);

  return filePath;

}

function resizeImageUrl(url, width, height) {
  //find /preview-480x272.jpg and replace with /preview-widthxheight.jpg
  return url.replace(/preview-\d+x\d+\.jpg/, `preview-${width}x${height}.jpg`);
}


function getNext1630UTC() {
  const now = new Date();

  let next1630 = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    16, 30, 0
  ));

  // If it's already past 16:30 UTC today, schedule for tomorrow
  if (now >= next1630) {
    next1630.setUTCDate(next1630.getUTCDate() + 1);
  }

  return next1630.toISOString();
}



export function shouldRunFunction(gameId) {
  const STATUS_FILE = path.resolve('./run-status.json');

  let runStatus = {};
  if (fs.existsSync(STATUS_FILE)) {
    const data = fs.readFileSync(STATUS_FILE, 'utf-8');
    runStatus = JSON.parse(data);
  }

  // If this gameId exists and is false, exit early and flip it to true

  if (!runStatus[gameId]) {
    console.error("No run status object found for gameId:", gameId);
    //return false as we dont want the code to execute
    return false;
  }


  if (runStatus[gameId].should_run === false) {
    console.log(`[${new Date().toISOString()}] Skipping run for gameId ${gameId}. Setting flag to true.`);
    runStatus[gameId].should_run = true;
    fs.writeFileSync(STATUS_FILE, JSON.stringify(runStatus, null, 2));
    return false;
  }


  return true;
}

/* async function updateRunStatus(gameId, status) {
  const STATUS_FILE = path.resolve('./run-status.json');

  let runStatus = {};
  if (fs.existsSync(STATUS_FILE)) {
    const data = fs.readFileSync(STATUS_FILE, 'utf-8');
    runStatus = JSON.parse(data);
  }
  runStatus[gameId] = status;
  fs.writeFileSync(STATUS_FILE, JSON.stringify(runStatus, null, 2));
} */

