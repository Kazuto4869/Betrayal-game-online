import type { Trait } from '@bahoth/shared';

export const ALL_TRAITS: readonly Trait[] = [
  'speed',
  'might',
  'sanity',
  'knowledge',
] as const;

export const TRAIT_ICONS: Record<Trait, string> = {
  speed: '⚡',
  might: '⚔️',
  sanity: '🧠',
  knowledge: '📖',
};

export const TRAIT_LABELS: Record<Trait, string> = {
  speed: 'Speed',
  might: 'Might',
  sanity: 'Sanity',
  knowledge: 'Knowledge',
};

export const TRAIT_SHORT: Record<Trait, string> = {
  speed: 'Spd',
  might: 'Mgt',
  sanity: 'San',
  knowledge: 'Knw',
};
