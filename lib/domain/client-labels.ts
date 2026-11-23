const clientAliases = new Map([
  ['epic3', 'Topco'],
  ['epic 3', 'Topco'],
  ['epic3/hill', 'Topco'],
  ['burns', 'Topco'],
  ['hillenmeyer', 'Topco'],
  ['steve', 'Sartorius'],
  ['steve sartorius · minneapolis', 'Sartorius'],
]);

export function clientDisplayName(name: string): string {
  return clientAliases.get(name.trim().toLowerCase()) ?? name;
}
