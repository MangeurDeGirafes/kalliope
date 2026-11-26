/** Article affiché dans la boutique d'un marchand. */
export interface ShopItem {
  id: string;
  name: string;
  desc: string;
  price: number;
  owned: boolean;
  /** Déjà possédé mais pas équipé (encres) : bouton « ÉQUIPER ». */
  equip?: boolean;
  /** Libellé quand l'article est possédé (défaut « INSTALLÉ ✓ »). */
  ownedLabel?: string;
}

export interface ShopVendor {
  name: string;
  title: string;
  /** Réplique d'accueil. */
  line: string;
  color: string;
}

/**
 * Fenêtre de boutique des marchands de la Plaza : liste d'améliorations avec
 * prix, achat en un clic / une touche, fermeture par bouton ou Échap / E.
 */
export class Shop {
  onBuy: ((id: string) => void) | null = null;
  onClose: (() => void) | null = null;

  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private opened = false;
  private openedAt = 0;
  private vendor: ShopVendor | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'shop';
    this.panel = document.createElement('div');
    this.panel.className = 'shop-panel';
    this.root.appendChild(this.panel);
    container.appendChild(this.root);

    this.root.addEventListener('click', (e) => {
      // Anti « clic fantôme » du doigt qui vient d'ouvrir la boutique
      if (performance.now() - this.openedAt < 350) return;
      const target = e.target as HTMLElement;
      const buy = target.closest<HTMLElement>('[data-buy]');
      if (buy && !buy.hasAttribute('disabled')) {
        this.onBuy?.(buy.dataset.buy!);
        return;
      }
      if (target.closest('[data-close]') || target === this.root) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.opened) return;
      if (e.code === 'Escape' || e.code === 'KeyE' || e.code === 'KeyF') {
        e.preventDefault();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(vendor: ShopVendor, items: ShopItem[], credits: number): void {
    this.vendor = vendor;
    this.opened = true;
    this.openedAt = performance.now();
    this.render(items, credits, null);
    this.root.classList.add('show');
  }

  /** Rafraîchit après un achat (message facultatif du marchand). */
  refresh(items: ShopItem[], credits: number, message: string | null): void {
    if (this.opened) this.render(items, credits, message);
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.classList.remove('show');
    this.onClose?.();
  }

  private render(items: ShopItem[], credits: number, message: string | null): void {
    const v = this.vendor!;
    const rows = items
      .map((it) => {
        const state = it.owned ? 'owned' : it.equip || credits >= it.price ? 'buyable' : 'poor';
        const btn = it.owned
          ? `<span class="shop-owned">${it.ownedLabel ?? 'INSTALLÉ ✓'}</span>`
          : it.equip
            ? `<button class="shop-buy" type="button" data-buy="${it.id}">ÉQUIPER</button>`
            : `<button class="shop-buy" type="button" data-buy="${it.id}" ${credits >= it.price ? '' : 'disabled'}>${it.price === 0 ? 'GRATUIT' : `${it.price} ¢`}</button>`;
        return `<div class="shop-item ${state}"><div class="shop-info"><div class="shop-name">${it.name}</div><div class="shop-desc">${it.desc}</div></div>${btn}</div>`;
      })
      .join('');
    this.panel.style.setProperty('--vendor', v.color);
    this.panel.innerHTML = `
      <div class="shop-head">
        <div><div class="shop-title">${v.title}</div><div class="shop-vendor">${v.name}</div></div>
        <div class="shop-credits">${credits} ¢</div>
      </div>
      <div class="shop-line">« ${message ?? v.line} »</div>
      <div class="shop-list">${rows}</div>
      <button class="overlay-btn shop-close" type="button" data-close>QUITTER</button>`;
  }
}
