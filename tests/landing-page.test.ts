// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../src/App';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('public landing page', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    container?.remove();
    container = null;
  });

  function renderLandingPage() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(createElement(App, { initialRoute: 'landing' }));
    });
  }

  function clickButton(label: string) {
    const button = Array.from(container?.querySelectorAll('button') ?? []).find((item) => item.textContent?.trim() === label);
    expect(button).toBeDefined();

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  it('introduces the product and offers a protected workspace handoff', () => {
    renderLandingPage();

    expect(container?.querySelector('main.landing-page')).not.toBeNull();
    expect(container?.textContent).toContain('See the whole border, one ledger at a time.');
    expect(container?.textContent).toContain('LIVE LEDGER SNAPSHOT');
    expect(container?.textContent?.toLowerCase()).not.toContain('demo');
    expect(container?.querySelector('a.landing-primary-action[href="/app"]')?.textContent).toContain('Enter private ledger');
  });

  it('updates the sample reporting window and provisional state', () => {
    renderLandingPage();

    clickButton('Today');
    expect(container?.textContent).toContain('TODAY');

    clickButton('Include provisional alerts');
    expect(container?.textContent).toContain('Provisional included');
  });
});

