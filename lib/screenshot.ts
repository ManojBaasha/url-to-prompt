/// <reference lib="dom" />
import type { Browser } from "puppeteer-core";

export type ScreenshotErrorCode =
  | "NAVIGATION_FAILED"
  | "TIMEOUT"
  | "BROWSER_LAUNCH_FAILED";

export class ScreenshotError extends Error {
  readonly code: ScreenshotErrorCode;
  constructor(
    code: ScreenshotErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "ScreenshotError";
    this.code = code;
  }
}

export type CapturedScreenshots = {
  aboveFold: Buffer;
  midPage: Buffer;
  fullPage: Buffer;
  meta: {
    finalUrl: string;
    viewportWidth: number;
    viewportHeight: number;
    pageHeight: number;
  };
};

const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 900;
const NAV_TIMEOUT_MS = 30_000;
const POST_LOAD_WAIT_MS = 1500;

async function launchBrowser(): Promise<Browser> {
  try {
    if (process.env.VERCEL) {
      const chromiumMod = (await import("@sparticuz/chromium")) as any;
      const chromium = chromiumMod.default ?? chromiumMod;
      const puppeteerMod = (await import("puppeteer-core")) as any;
      const puppeteer = puppeteerMod.default ?? puppeteerMod;
      return await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        defaultViewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      });
    }

    const puppeteerMod = (await import("puppeteer")) as any;
    const puppeteer = puppeteerMod.default ?? puppeteerMod;
    return await puppeteer.launch({
      headless: true,
      defaultViewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    });
  } catch (err) {
    throw new ScreenshotError(
      "BROWSER_LAUNCH_FAILED",
      `Failed to launch browser: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
}

function classifyNavError(err: unknown): ScreenshotError {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || /timeout/i.test(msg)) {
    return new ScreenshotError("TIMEOUT", `Navigation timed out: ${msg}`, { cause: err });
  }
  return new ScreenshotError("NAVIGATION_FAILED", `Navigation failed: ${msg}`, { cause: err });
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function captureScreenshots(url: string): Promise<CapturedScreenshots> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });

    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    } catch (err) {
      throw classifyNavError(err);
    }

    await delay(POST_LOAD_WAIT_MS);

    await page.evaluate(() => window.scrollTo(0, 0));
    const aboveFold = Buffer.from(await page.screenshot({ type: "png" }));

    const pageHeight: number = await page.evaluate(
      () => document.documentElement.scrollHeight
    );

    const midScroll = Math.max(0, Math.floor(pageHeight / 2) - 450);
    await page.evaluate((y: number) => window.scrollTo(0, y), midScroll);
    await delay(200);
    const midPage = Buffer.from(await page.screenshot({ type: "png" }));

    await page.evaluate(() => window.scrollTo(0, 0));
    const fullPage = Buffer.from(
      await page.screenshot({ type: "png", fullPage: true })
    );

    return {
      aboveFold,
      midPage,
      fullPage,
      meta: {
        finalUrl: page.url(),
        viewportWidth: VIEWPORT_WIDTH,
        viewportHeight: VIEWPORT_HEIGHT,
        pageHeight,
      },
    };
  } finally {
    try {
      await browser.close();
    } catch {
      // swallow close errors so the primary error surfaces
    }
  }
}
