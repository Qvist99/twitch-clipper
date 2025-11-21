import fs from "fs";

const TOKEN_PATH = "./tokens.json";

export function loadTokens() {
    if (!fs.existsSync(TOKEN_PATH)) return {};
    return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
}

export function saveTokens(tokens) {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}