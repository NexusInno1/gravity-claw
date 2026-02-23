import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { log } from "../logger.js";

// ── Browser Manager — Playwright Singleton ───────────────

const SCREENSHOTS_DIR = join(process.cwd(), "data", "screenshots");

let browser: Browser | null = null;
const pages = new Map<string, Page>();

/** Ensure screenshots directory exists. */
function ensureScreenshotDir(): void {
  if (!existsSync(SCREENSHOTS_DIR)) {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
}

/** Lazy-launch a Chromium browser instance. */
export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    log.info("🌐 Launching Chromium...");
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    log.info("🌐 Chromium ready");
  }
  return browser;
}

/** Get or create a page for a specific user. */
export async function getPage(userId: string): Promise<Page> {
  let page = pages.get(userId);

  if (page && !page.isClosed()) {
    return page;
  }

  const b = await getBrowser();
  const context = await b.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  page = await context.newPage();
  pages.set(userId, page);
  return page;
}

/** Take a screenshot and save to data/screenshots/. Returns the file path. */
export async function takeScreenshot(userId: string): Promise<string> {
  ensureScreenshotDir();
  const page = await getPage(userId);
  const filename = `screenshot_${Date.now()}.png`;
  const filepath = join(SCREENSHOTS_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  return filepath;
}

/** Close browser and all pages on shutdown. */
export async function closeBrowser(): Promise<void> {
  for (const [, page] of pages) {
    try {
      await page.close();
    } catch {
      // already closed
    }
  }
  pages.clear();

  if (browser) {
    try {
      await browser.close();
    } catch {
      // already closed
    }
    browser = null;
    log.info("🌐 Chromium closed");
  }
}
