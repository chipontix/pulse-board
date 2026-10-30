import { expect, test, type Page } from "@playwright/test";

const TARGET = process.env.TARGET_URL ?? "http://localhost:17383";
const USER = process.env.ADMIN_USERNAME ?? "admin";
const PASS = process.env.ADMIN_PASSWORD ?? "";

/** Opens the public page, waits for the SSE connection and plants a marker a reload would wipe. */
async function openLive(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("conn")).toHaveAttribute("data-state", "live");
  await page.evaluate(() => { (window as unknown as { marker: number }).marker = 42; });
}
const notReloaded = (page: Page) => page.evaluate(() => (window as unknown as { marker?: number }).marker);

async function signIn(page: Page) {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel("Username").fill(USER);
  await page.getByLabel("Password").fill(PASS);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
}

test("an incident created in the admin panel appears on an open public page without reload", async ({ browser }) => {
  const pub = await (await browser.newContext()).newPage();
  await openLive(pub);
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin);

  const title = `E2E: elevated API errors ${Date.now()}`;
  await admin.getByLabel("Title").fill(title);
  await admin.getByLabel("Impact").selectOption("major");
  await admin.getByRole("checkbox", { name: "API" }).check();
  await admin.getByLabel("First update").fill("We are investigating elevated error rates.");
  await admin.getByRole("button", { name: "Create incident" }).click();

  const card = pub.getByTestId("incident").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card).toContainText("major · investigating");
  await expect(card).toContainText("Affects: API");

  const form = admin.getByTestId("admin-incident").filter({ hasText: title });
  await form.getByRole("combobox").selectOption("resolved");
  await form.getByPlaceholder("Update message").fill("Error rates are back to normal.");
  await form.getByRole("button", { name: "Post update" }).click();

  await expect(card).toContainText("major · resolved");
  await expect(pub.getByRole("heading", { name: "Resolved in the last 7 days" })).toBeVisible();
  expect(await notReloaded(pub)).toBe(42);
});

test("a failing probe turns the service degraded then down on an open page without reload, and back", async ({ page, request }) => {
  const slug = "search";
  await openLive(page);
  const status = page.getByTestId(`status-${slug}`);
  await expect(status).toHaveText("operational");
  try {
    await request.post(`${TARGET}/svc/${slug}/fail`);
    // Seeded probe interval is 10 s: the first failure means degraded, the third down.
    await expect(status).toHaveText("degraded", { timeout: 25_000 });
    await expect(status).toHaveText("down", { timeout: 40_000 });
    await expect(page.getByTestId("overall")).toHaveText("Major outage");
  } finally {
    await request.post(`${TARGET}/svc/${slug}/ok`);
  }
  await expect(status).toHaveText("operational", { timeout: 25_000 });
  expect(await notReloaded(page)).toBe(42);
});

test("the admin panel needs a session and refuses a wrong password", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel("Username").fill(USER);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Wrong username or password.")).toBeVisible();

  await signIn(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("the public API reports its rate limit, and a spoofed X-Forwarded-For doesn't buy a new bucket", async ({ request }) => {
  const get = (ip: string) => request.get("/api/v1/status", { headers: { "x-forwarded-for": ip } });
  const a = await get("203.0.113.1");
  const b = await get("203.0.113.2");
  expect(a.status()).toBe(200);
  expect(a.headers()["x-ratelimit-limit"]).toBe("60");
  // nginx replaced both headers with the real address: one bucket, two requests
  expect(Number(b.headers()["x-ratelimit-remaining"])).toBe(Number(a.headers()["x-ratelimit-remaining"]) - 1);
  expect((await a.json()).services.map((s: { slug: string }) => s.slug)).toContain("search");
});
