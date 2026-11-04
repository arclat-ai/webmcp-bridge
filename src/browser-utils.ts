import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

/**
 * Resolves an existing Chromium or chrome-headless-shell executable from Playwright cache
 * or standard system installation locations.
 */
export function findChromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    if (fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)) {
      return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    }
  }

  try {
    const stdPath = chromium.executablePath();
    if (fs.existsSync(stdPath)) {
      return stdPath;
    }
  } catch {
    // Ignore error and search cache directories
  }

  const localAppData = process.env.LOCALAPPDATA;
  const userProfile = process.env.USERPROFILE || process.env.HOME;
  const candidateDirs = [
    localAppData ? path.join(localAppData, 'ms-playwright') : null,
    userProfile ? path.join(userProfile, 'AppData', 'Local', 'ms-playwright') : null,
    userProfile ? path.join(userProfile, '.cache', 'ms-playwright') : null,
    userProfile ? path.join(userProfile, 'Library', 'Caches', 'ms-playwright') : null,
  ].filter(Boolean) as string[];

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const sortedFolders = entries
        .filter(e => e.isDirectory() && (e.name.startsWith('chromium-') || e.name.startsWith('chromium_headless_shell-')))
        .map(e => e.name)
        .sort()
        .reverse();

      for (const folder of sortedFolders) {
        const fullFolder = path.join(dir, folder);
        const subpaths = [
          path.join(fullFolder, 'chrome-win64', 'chrome.exe'),
          path.join(fullFolder, 'chrome-win', 'chrome.exe'),
          path.join(fullFolder, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
          path.join(fullFolder, 'chrome-headless-shell-win', 'chrome-headless-shell.exe'),
          path.join(fullFolder, 'chrome-linux', 'chrome'),
          path.join(fullFolder, 'chrome-linux', 'headless_shell'),
          path.join(fullFolder, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        ];
        for (const candidate of subpaths) {
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
      }
    } catch {
      // Continue to next directory
    }
  }

  return undefined;
}
