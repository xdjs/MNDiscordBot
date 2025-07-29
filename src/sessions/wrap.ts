export const wrapGuilds = new Set<string>();

export function startWrap(guildId: string) {
  wrapGuilds.add(guildId);
}

export function stopWrap(guildId: string) {
  wrapGuilds.delete(guildId);
}

export function isWrapped(guildId: string): boolean {
  return wrapGuilds.has(guildId);
}