export interface JournalEntry {
  title: string;
  subtitle: string;
  text: string;
  unlocked: boolean;
}

export interface JournalQuest {
  title: string;
  detail: string;
  status: 'todo' | 'active' | 'done';
}

export interface JournalData {
  /** « TON FRÈRE » / « TA SŒUR » */
  siblingLabel: string;
  logs: JournalEntry[];
  secrets: JournalEntry[];
  quests: JournalQuest[];
}

type Tab = 'logs' | 'secrets' | 'quests';

/**
 * Journal du runner : fragments du message de Sacha (réécoute), secrets trouvés
 * et quêtes de la Plaza. S'ouvre depuis la pause ou l'écran titre.
 */
export class Journal {
  onClose: (() => void) | null = null;
  onToggleSibling: (() => void) | null = null;

  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private tab: Tab = 'logs';
  private data: JournalData | null = null;
  private opened = false;
  private openedAt = 0;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'shop journal';
    this.panel = document.createElement('div');
    this.panel.className = 'shop-panel journal-panel';
    this.root.appendChild(this.panel);
    container.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      e.stopPropagation();
      if (performance.now() - this.openedAt < 350) return;
      const t = e.target as HTMLElement;
      const tab = t.closest<HTMLElement>('[data-tab]');
      if (tab) {
        this.tab = tab.dataset.tab as Tab;
        this.render();
        return;
      }
      if (t.closest('[data-sibling]')) {
        this.onToggleSibling?.();
        return;
      }
      if (t.closest('[data-close]') || t === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.opened) return;
      if (e.code === 'Escape' || e.code === 'KeyJ') {
        e.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(data: JournalData): void {
    this.data = data;
    this.opened = true;
    this.openedAt = performance.now();
    this.render();
    this.root.classList.add('show');
  }

  refresh(data: JournalData): void {
    this.data = data;
    if (this.opened) this.render();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.classList.remove('show');
    this.onClose?.();
  }

  private render(): void {
    const d = this.data!;
    const count = (list: JournalEntry[]) => `${list.filter((e) => e.unlocked).length}/${list.length}`;
    const tabs: [Tab, string][] = [
      ['logs', `FRAGMENTS ${count(d.logs)}`],
      ['secrets', `SECRETS ${count(d.secrets)}`],
      ['quests', `QUÊTES ${d.quests.filter((q) => q.status === 'done').length}/${d.quests.length}`],
    ];
    let body = '';
    if (this.tab === 'logs' || this.tab === 'secrets') {
      const list = this.tab === 'logs' ? d.logs : d.secrets;
      body = list
        .map((e) =>
          e.unlocked
            ? `<div class="jr-entry"><div class="jr-title">${e.title}<span>${e.subtitle}</span></div><div class="jr-text">${e.text}</div></div>`
            : `<div class="jr-entry locked"><div class="jr-title">${e.title}<span>${e.subtitle}</span></div><div class="jr-text">${e.text}</div></div>`,
        )
        .join('');
    } else {
      body = d.quests
        .map((q) => {
          const mark = q.status === 'done' ? '✓' : q.status === 'active' ? '◆' : '○';
          return `<div class="jr-entry quest ${q.status}"><div class="jr-title">${mark} ${q.title}</div><div class="jr-text">${q.detail}</div></div>`;
        })
        .join('');
    }
    this.panel.style.setProperty('--vendor', '#7fd8ff');
    this.panel.innerHTML = `
      <div class="shop-head">
        <div><div class="shop-title">JOURNAL DU RUNNER</div><div class="shop-vendor">NÉO-VÉRIDIAN · SECTEUR EN PURGE</div></div>
        <button class="jr-sibling" type="button" data-sibling>SACHA : ${d.siblingLabel} ⇄</button>
      </div>
      <div class="jr-tabs">${tabs.map(([id, label]) => `<button type="button" class="jr-tab${id === this.tab ? ' active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
      <div class="jr-list">${body}</div>
      <button class="overlay-btn shop-close" type="button" data-close>FERMER</button>`;
  }
}
