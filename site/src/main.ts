import { mount } from 'svelte';
import App from './App.svelte';
import { DataError, DataLoader, type Fetch, loadMeta } from './lib/data';
import { createPage } from './lib/page';
import { createStateStore, windowHashLocation } from './lib/state';
import './styles/tokens.css';
import './styles/base.css';

const target = document.getElementById('app');
if (!target) throw new Error('index.html has no #app element');

const dataUrl = `${import.meta.env.BASE_URL}data/`;
const fetchData: Fetch = (url) => fetch(url);

try {
  const meta = await loadMeta(dataUrl, fetchData);
  const selection = createStateStore(meta, windowHashLocation(window));
  const loader = new DataLoader(meta, dataUrl, fetchData);
  // The page is drawn at once and says what it is loading while the years arrive.
  mount(App, { target, props: { page: createPage(meta, selection, loader) } });
} catch (err) {
  target.textContent =
    err instanceof DataError
      ? `The page's data could not be loaded (${err.message}). Try reloading the page.`
      : 'The page could not be loaded. Try reloading the page.';
  throw err;
}
