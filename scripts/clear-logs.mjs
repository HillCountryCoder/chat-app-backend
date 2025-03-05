import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = path.join(__dirname, "..", "logs");

console.log("Checking for logs directory...");

if (!fs.existsSync(logsDir)) {
  console.log("Logs directory does not exist. Creating it...");
  fs.mkdirSync(logsDir);
  console.log("Logs directory created successfully.");
} else {
  console.log("Logs directory exists. Clearing the log files");

  const files = fs.readdirSync(logsDir);

  let deleteCount = 0;
  for (const file of files) {
    if (file.endsWith(".log")) {
      fs.unlinkSync(path.join(logsDir, file));
      deleteCount++;
    }
  }
  console.log(`Cleared ${deleteCount} log files.`);
}
console.log("Log management complete.");
