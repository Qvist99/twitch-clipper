import inquirer from "inquirer";
import { mainProcess } from "./index.js";

const games = [
  { name: "iRacing", value: 19554 },
  { name: "Le Mans Ultimate", value: 2060730947 },
]

const questions = [
  {
    type: "list",
    name: "gameId",
    message: "Choose a game",
    choices: games
  },
  {
    type: "input",
    name: "lowestViewCount",
    message: "Minimum view count for clips:",
    default: 100,
    validate: val => !isNaN(val) && parseInt(val) >= 0
  },
  {
    type: 'input',
    name: 'minVideoTime',
    message: 'Minimum video time (seconds):',
    default: 300,
    validate: val => !isNaN(val) && parseInt(val) > 0
  },
  {
    type: 'input',
    name: 'maxVideoTime',
    message: 'Maximum video time (seconds):',
    default: 600,
    validate: val => !isNaN(val) && parseInt(val) > 0
  },
  {
    type: 'input',
    name: 'daysAgo',
    message: 'Fetch clips from how many days ago?',
    default: 7,
    validate: val => !isNaN(val) && parseInt(val) > 0
  },
  {
    type: 'input',
    name: 'title',
    message: 'Title for the final video compilation:',
    default: 'Twitch Clips Compilation'
  },
  {
    type: 'input',
    name: 'part',
    message: 'Starting part number for the video title:',
    default: 1,
    validate: val => !isNaN(val) && parseInt(val) > 0
  }
]


const runCLI = async () => {
  const answers = await inquirer.prompt(questions);

  const args = {
    gameId: answers.gameId,
    lowestViewCount: parseInt(answers.lowestViewCount),
    minVideoTime: parseInt(answers.minVideoTime),
    maxVideoTime: parseInt(answers.maxVideoTime),
    daysAgo: parseInt(answers.daysAgo),
    title: answers.title,
    part: parseInt(answers.part)
  };


  const selectedGame = games.find(g => g.value === answers.gameId);

  // Display summary
  console.log("\n📋 Job Summary:");
  console.log(`Game: ${selectedGame?.name || 'Unknown'} (ID: ${args.gameId})`);
  console.log(`Minimum View Count: ${args.lowestViewCount}`);
  console.log(`Minimum Video Time: ${args.minVideoTime} seconds`);
  console.log(`Maximum Video Time: ${args.maxVideoTime} seconds`);
  console.log(`Fetch Clips From: Last ${args.daysAgo} days`);
  console.log(`Video Title: ${args.title}\n`);
  console.log(`Starting Part Number: ${args.part}\n`);


  const { confirm } = await inquirer.prompt({
    type: 'confirm',
    name: 'confirm',
    message: 'Do you want to proceed with these settings?',
    default: true
  });

  if (!confirm) {
    console.log("Operation cancelled by user.");
    process.exit(0);
  }

  await mainProcess(args);
}

runCLI()
  .then(() => {
    console.log("CLI executed successfully.");
  })
  .catch(error => {
    console.error("Error executing CLI:", error);
  });