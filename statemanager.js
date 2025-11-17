import fs from "fs";
import path from "path";

const stateFile = path.resolve("data/state.json");

function loadFullState() {
    if (!fs.existsSync(stateFile)) {
        return {};
    }
    const raw = fs.readFileSync(stateFile, "utf8");
    return JSON.parse(raw);
}

function saveFullState(state) {
    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

export function incrementPart(gameId) {
    const state = loadFullState();
    if (!state[gameId]) {
        state[gameId] = { part: 1 };
    }
    state[gameId].part += 1;
    saveFullState(state);
    return state[gameId].part;
}

export function getCurrentPart(gameId) {
    const state = loadFullState();
    return state[gameId]?.part ?? 1;
}

export function resetPart(gameId, to = 1) {
    const state = loadFullState();
    state[gameId] = { part: to };
    saveFullState(state);
}