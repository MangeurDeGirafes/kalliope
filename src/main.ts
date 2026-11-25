import './style.css';
import { Game } from './Game';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('app');
  const boot = document.getElementById('boot');
  if (!container) throw new Error('#app introuvable');
  try {
    const game = await Game.create(container);
    boot?.remove();
    game.start();
    if (import.meta.env.DEV) {
      // Accès console pour le débogage en développement uniquement.
      (window as unknown as { __game: Game }).__game = game;
    }
  } catch (err) {
    console.error(err);
    if (boot) {
      boot.classList.add('error');
      boot.textContent = `ÉCHEC DU DÉMARRAGE : ${err instanceof Error ? err.message : String(err)} — WebGL est-il disponible ?`;
    }
  }
}

void bootstrap();
