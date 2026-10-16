// Panel "Alur": cerita langkah demi langkah antara HP, Firebase, Server, dan Dashboard.
import { on, esc, fmtTime } from './core.js';

const ACTOR = { hp: 'HP Merchant', firebase: 'Firebase', server: 'Server', admin: 'Dashboard', demo: 'Panduan' };

export function mountFlow(el, filterEl, clearBtn) {
  let filter = 'all';
  const entries = [];
  const list = el;
  const stickToBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 80;

  function row(n) {
    const li = document.createElement('li');
    li.className = `fl ${n.actor} ${n.tone || ''}`;
    li.dataset.actor = n.actor;
    li.hidden = filter !== 'all' && filter !== n.actor;
    li.innerHTML = `<time>${fmtTime(n.t)}</time><span class="who">${ACTOR[n.actor]}</span><div class="what">${esc(n.text)}${n.checks ? `<ul class="checks">${n.checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'} ${c.sub ? 'sub' : ''} ${c.strong ? 'strong' : ''}">${esc(c.label)}</li>`).join('')}</ul>` : ''}</div>`;
    return li;
  }
  on((m) => {
    if (m.kind !== 'narr') return;
    const stick = stickToBottom();
    entries.push(m.n);
    list.appendChild(row(m.n));
    while (list.children.length > 400) list.firstChild.remove();
    if (stick) list.scrollTop = list.scrollHeight;
  });
  filterEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]'); if (!b) return;
    filter = b.dataset.f;
    filterEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    for (const li of list.children) li.hidden = filter !== 'all' && filter !== li.dataset.actor;
    list.scrollTop = list.scrollHeight;
  });
  clearBtn.addEventListener('click', () => { list.innerHTML = ''; });
  return { clear() { list.innerHTML = ''; } };
}
