import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

type AxeViolation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];
type AxeNode = AxeViolation['nodes'][number];

/**
 * The violations a person meets. The client's tab bar sticks to the bottom, so at the first scroll it can cover the
 * edge of whatever sits there, and axe calls that target too small. Such a target is checked again where a person
 * reaches it, scrolled into view, which the app's scroll padding keeps clear of the bar (audit CLIENT-7). A target
 * still too small or too crowded there, or covered by anything else, still fails.
 */
export async function personFacing(
  page: Page,
  violations: readonly AxeViolation[],
): Promise<AxeViolation[]> {
  const kept: AxeViolation[] = [];
  for (const violation of violations) {
    if (violation.id !== 'target-size') {
      kept.push(violation);
      continue;
    }
    const nodes = await stillTooSmall(page, violation.nodes);
    if (nodes.length > 0) kept.push({ ...violation, nodes });
  }
  return kept;
}

async function stillTooSmall(page: Page, nodes: readonly AxeNode[]): Promise<AxeNode[]> {
  const kept: AxeNode[] = [];
  for (const node of nodes) {
    const selector = node.target.join(' ');
    const neighbours = [...node.any, ...node.all, ...node.none]
      .flatMap((check) => check.relatedNodes ?? [])
      .map((related) => related.target.join(' '));
    const onlyTheTabBar =
      neighbours.length > 0 &&
      (await page.evaluate(
        (selectors) =>
          selectors.every((each) => !!document.querySelector(each)?.closest('app-client-tabs')),
        neighbours,
      ));
    if (!onlyTheTabBar) {
      kept.push(node);
      continue;
    }
    await page
      .locator(selector)
      .first()
      .evaluate((element) => element.scrollIntoView({ block: 'nearest' }));
    const again = await new AxeBuilder({ page })
      .include(selector)
      .withRules(['target-size'])
      .analyze();
    await page.evaluate(() => window.scrollTo(0, 0));
    if (again.violations.length > 0) kept.push(node);
  }
  return kept;
}
