import * as B from '../browser.ts';
import { truncateMiddle } from '../util.ts';
import { ok, str, type ToolDef } from './types.ts';

async function snapshot(note: string, withImage: boolean) {
  const shot = withImage ? 'data:image/jpeg;base64,' + (await B.screenshot(55)).toString('base64') : undefined;
  const info = B.browserInfo();
  return ok(`${note}\nURL: ${info.url}${withImage ? '\n(A screenshot of the viewport is attached.)' : ''}`, { image: shot });
}

const navigate: ToolDef = {
  name: 'browser_navigate',
  description:
    'Open a URL in the shared headless browser (visible to the user in the Browser panel). Works for websites and local dev servers (e.g. http://localhost:5173). Returns title + a screenshot.',
  parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  risk: 'network',
  async execute(a, ctx) {
    const r = await B.navigate(str(a.url, 'url'));
    return snapshot(`Navigated. Status ${r.status}. Title: "${r.title}"`, ctx.settings.model.vision);
  },
};

const shot: ToolDef = {
  name: 'browser_screenshot',
  description: 'Take a screenshot of the current browser page (to visually verify a UI). Also lists clickable elements with coordinates.',
  parameters: { type: 'object', properties: {} },
  risk: 'read',
  async execute(_a, ctx) {
    const els = await B.interactiveElements();
    return snapshot(`Interactive elements (tag "label" @(x,y)):\n${els || '(none)'}`, ctx.settings.model.vision);
  },
};

const read: ToolDef = {
  name: 'browser_read',
  description: 'Read the text content of the current browser page (as Markdown) plus its links. Optional CSS selector to read a part.',
  parameters: { type: 'object', properties: { selector: { type: 'string' } } },
  risk: 'read',
  async execute(a) {
    const r = await B.readPage(a.selector);
    return ok(truncateMiddle(`URL: ${r.url}\nTitle: ${r.title}\n\n${r.text}\n\nLinks:\n${r.links.join('\n')}`, 20_000).text);
  },
};

const click: ToolDef = {
  name: 'browser_click',
  description: 'Click an element in the browser by CSS selector, by visible text, or by viewport coordinates (x,y from browser_screenshot).',
  parameters: {
    type: 'object',
    properties: { selector: { type: 'string' }, text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } },
  },
  risk: 'network',
  async execute(a, ctx) {
    await B.clickTarget({ selector: a.selector, text: a.text, x: a.x, y: a.y });
    return snapshot('Clicked.', ctx.settings.model.vision);
  },
};

const type: ToolDef = {
  name: 'browser_type',
  description: 'Type text into an input (by CSS selector, replacing its value) or into the focused element. submit=true presses Enter afterwards.',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string' }, selector: { type: 'string' }, submit: { type: 'boolean' } },
    required: ['text'],
  },
  risk: 'network',
  async execute(a, ctx) {
    await B.typeText(str(a.text, 'text'), { selector: a.selector, submit: !!a.submit });
    return snapshot('Typed.', ctx.settings.model.vision);
  },
};

const press: ToolDef = {
  name: 'browser_press',
  description: 'Press a key in the browser (e.g. Enter, Escape, Tab, ArrowDown, Control+A).',
  parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  risk: 'network',
  async execute(a, ctx) {
    await B.pressKey(str(a.key, 'key'));
    return snapshot(`Pressed ${a.key}.`, ctx.settings.model.vision);
  },
};

export const browserTools: ToolDef[] = [navigate, shot, read, click, type, press];
