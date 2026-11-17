import './styles/base.css';
import './styles/board.css';
import { mountAppShell } from './app/AppShell';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('missing #app');

mountAppShell(root);
