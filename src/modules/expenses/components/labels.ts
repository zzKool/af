// Client-safe labels shared by the components.
export const groupLabel = (g: { number: number; description: string }) =>
  `${g.number} — ${g.description}`;
