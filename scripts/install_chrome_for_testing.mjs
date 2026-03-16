import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const installRoot = path.join(repoRoot, '.debug', 'chrome');
const metadataPath = path.join(installRoot, 'metadata.json');
const archivePath = path.join(installRoot, 'chrome.zip');

const PLATFORM_MAP = {
	win32: {
		x64: { key: 'win64', executable: ['chrome-win64', 'chrome.exe'] },
		ia32: { key: 'win32', executable: ['chrome-win32', 'chrome.exe'] }
	},
	darwin: {
		arm64: { key: 'mac-arm64', executable: ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'] },
		x64: { key: 'mac-x64', executable: ['chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'] }
	},
	linux: {
		x64: { key: 'linux64', executable: ['chrome-linux64', 'chrome'] }
	}
};

/**
 * Resolve the Chrome for Testing platform descriptor for the current machine.
 * @returns {{ key: string; executable: string[] }} Supported platform descriptor.
 */
function getPlatformDescriptor() {
	const platform = PLATFORM_MAP[process.platform];
	const descriptor = platform?.[process.arch];
	if (!descriptor) {
		throw new Error(`Unsupported platform for Chrome for Testing: ${process.platform} ${process.arch}`);
	}
	return descriptor;
}

/**
 * Ensure a directory exists.
 * @param {string} dirPath - Directory path to create.
 */
function ensureDir(dirPath) {
	fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Remove a file or directory if it exists.
 * @param {string} targetPath - File system path to remove.
 */
function removeIfExists(targetPath) {
	if (!fs.existsSync(targetPath)) return;
	fs.rmSync(targetPath, { recursive: true, force: true });
}

/**
 * Read the install metadata if present.
 * @returns {{ version: string; executable: string } | null} Parsed metadata or null.
 */
function readMetadata() {
	if (!fs.existsSync(metadataPath)) return null;
	return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
}

/**
 * Download a file from a URL.
 * @param {string} url - Remote URL to fetch.
 * @param {string} targetPath - Local file path to write.
 * @returns {Promise<void>} Resolves when download completes.
 */
async function downloadFile(url, targetPath) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
	}
	const buffer = Buffer.from(await response.arrayBuffer());
	fs.writeFileSync(targetPath, buffer);
}

/**
 * Extract the downloaded Chrome for Testing archive.
 * Uses PowerShell on Windows and unzip on Unix-like systems.
 * @param {string} zipPath - Path to the downloaded archive.
 * @param {string} destination - Directory to extract into.
 */
function extractArchive(zipPath, destination) {
	if (process.platform === 'win32') {
		execFileSync(
			'powershell',
			[
				'-NoProfile',
				'-Command',
				`Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`
			],
			{ stdio: 'inherit' }
		);
		return;
	}

	execFileSync('unzip', ['-o', zipPath, '-d', destination], { stdio: 'inherit' });
}

/**
 * Persist install metadata for later launch configs and checks.
 * @param {string} version - Installed browser version.
 * @param {string} executablePath - Absolute path to the browser executable.
 */
function writeMetadata(version, executablePath) {
	fs.writeFileSync(
		metadataPath,
		JSON.stringify(
			{
				version,
				executable: executablePath
			},
			null,
			2
		)
	);
}

/**
 * Main installer entry point.
 * @returns {Promise<void>} Resolves when installation is complete or already satisfied.
 */
async function main() {
	const descriptor = getPlatformDescriptor();
	const dashboardUrl = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';
	const response = await fetch(dashboardUrl);
	if (!response.ok) {
		throw new Error(`Failed to fetch Chrome for Testing availability: HTTP ${response.status}`);
	}
	const payload = await response.json();
	const channel = payload?.channels?.Stable;
	const download = channel?.downloads?.chrome?.find((entry) => entry.platform === descriptor.key);
	if (!channel?.version || !download?.url) {
		throw new Error(`No stable Chrome for Testing download found for platform ${descriptor.key}`);
	}

	const executablePath = path.join(installRoot, ...descriptor.executable);
	const currentMetadata = readMetadata();
	if (
		currentMetadata?.version === channel.version &&
		currentMetadata.executable === executablePath &&
		fs.existsSync(executablePath)
	) {
		console.log(`[Cite Forge debug] Chrome for Testing ${channel.version} already installed`);
		return;
	}

	console.log(`[Cite Forge debug] Installing Chrome for Testing ${channel.version} for ${descriptor.key}`);
	ensureDir(installRoot);
	removeIfExists(path.join(installRoot, descriptor.executable[0]));
	removeIfExists(archivePath);
	await downloadFile(download.url, archivePath);
	extractArchive(archivePath, installRoot);
	removeIfExists(archivePath);

	if (!fs.existsSync(executablePath)) {
		throw new Error(`Chrome for Testing executable not found after extraction: ${executablePath}`);
	}

	writeMetadata(channel.version, executablePath);
	console.log(`[Cite Forge debug] Chrome for Testing ready at ${executablePath}`);
}

main().catch((error) => {
	console.error('[Cite Forge debug] Chrome for Testing install failed:', error);
	process.exit(1);
});
