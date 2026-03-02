# Playwright Skill

Browser automation for end-to-end testing using Playwright. Use this skill when implementing or debugging browser-based tests, UI interaction tests, or any test requiring a real browser.

## When to Use This Skill

- Writing new Playwright tests for UI flows
- Debugging failing Playwright tests
- Automating browser interactions (click, fill, navigate, assert)
- Capturing screenshots or tracing browser behaviour
- Testing across multiple browsers (Chromium, Firefox, WebKit)

## Core Concepts

### Test Structure

```typescript
import { test, expect } from "@playwright/test";

test("descriptive test name", async ({ page }) => {
  // arrange
  await page.goto("http://localhost:3000");

  // act
  await page.getByRole("button", { name: "Submit" }).click();

  // assert
  await expect(page.getByText("Success")).toBeVisible();
});
```

### Locator Priority (prefer in this order)

1. `page.getByRole()` — semantic, accessible, most stable
2. `page.getByLabel()` — form elements via associated label
3. `page.getByPlaceholder()` — inputs by placeholder text
4. `page.getByText()` — visible text content
5. `page.getByTestId()` — `data-testid` attributes (for elements with no semantic role)
6. `page.locator("css-selector")` — last resort

**Never use**: XPath, positional selectors (`:nth-child`), or text that is likely to change.

### Waiting and Assertions

Playwright auto-waits — do NOT add manual `sleep()` or `waitForTimeout()` unless debugging.

```typescript
// ✅ Correct — auto-waits for element
await expect(page.getByText("Loading...")).toBeHidden();

// ✅ Correct — waits for navigation
await page.waitForURL("**/dashboard");

// ❌ Wrong — fragile, hides real issues
await page.waitForTimeout(2000);
```

### Common Assertions

```typescript
await expect(locator).toBeVisible();
await expect(locator).toBeHidden();
await expect(locator).toHaveText("exact text");
await expect(locator).toContainText("partial");
await expect(locator).toHaveValue("input value");
await expect(locator).toBeEnabled();
await expect(locator).toBeDisabled();
await expect(locator).toHaveCount(3);
await expect(page).toHaveURL(/dashboard/);
await expect(page).toHaveTitle("Page Title");
```

### Network Interception

```typescript
// Mock an API response
await page.route("**/api/users", (route) => {
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ id: 1, name: "Alice" }]),
  });
});

// Wait for a specific request
const response = await page.waitForResponse("**/api/submit");
expect(response.status()).toBe(200);
```

### Screenshots and Traces (debugging)

```typescript
// Take a screenshot on failure
await page.screenshot({ path: "failure.png", fullPage: true });

// Trace for detailed debugging
// Run with: playwright test --trace on
```

## Configuration (playwright.config.ts)

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bun run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
```

## Page Object Model (for complex flows)

```typescript
// pages/LoginPage.ts
export class LoginPage {
  constructor(private page: Page) {}

  async login(email: string, password: string) {
    await this.page.getByLabel("Email").fill(email);
    await this.page.getByLabel("Password").fill(password);
    await this.page.getByRole("button", { name: "Log in" }).click();
  }

  async expectError(message: string) {
    await expect(this.page.getByRole("alert")).toContainText(message);
  }
}
```

## Running Tests

```bash
# Run all tests
bunx playwright test

# Run specific file
bunx playwright test tests/e2e/login.spec.ts

# Run with UI (interactive)
bunx playwright test --ui

# Debug mode (step through)
bunx playwright test --debug

# Show HTML report
bunx playwright show-report
```

## Anti-Patterns to Avoid

- **Hardcoded waits**: `waitForTimeout(ms)` — use `waitFor*` with conditions instead.
- **Fragile selectors**: CSS classes that change with builds, positional selectors.
- **Testing implementation details**: Test behaviour visible to users, not internal state.
- **Sequential tests with shared state**: Tests must be independent; use `beforeEach` for setup.
- **Ignoring flaky tests**: Fix root cause (race condition, timing) rather than adding retries.
