const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getShortCommitHash() {
  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA.substring(0, 7);
  }

  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch (err) {
    console.error('Failed to get commit hash via git command:', err.message);
    return 'unknown';
  }
}

const configPath = path.join(__dirname, '../src/config.ts');
if (!fs.existsSync(configPath)) {
  console.error(`Error: Config file not found at ${configPath}`);
  process.exit(1);
}

const sha = getShortCommitHash();
console.log(`Injecting short commit SHA: ${sha}`);

let content = fs.readFileSync(configPath, 'utf8');
const versionRegex = /(VERSION:\s*['"`])([^'"`]*)(['"`])/;
if (!versionRegex.test(content)) {
  console.error('Error: Could not find VERSION key in src/config.ts');
  process.exit(1);
}

content = content.replace(versionRegex, `$1${sha}$3`);
fs.writeFileSync(configPath, content, 'utf8');
console.log(`Successfully updated src/config.ts with VERSION: ${sha}`);
