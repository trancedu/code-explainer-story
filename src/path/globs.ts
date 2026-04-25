export function matchesAnyGlob(filePath: string, globs: string[]): boolean {
  const normalized = filePath.replaceAll('\\', '/');
  return globs.some((glob) => globMatches(normalized, glob));
}

export function globMatches(filePath: string, glob: string): boolean {
  const normalizedGlob = glob.replaceAll('\\', '/');
  const regex = globToRegex(normalizedGlob);
  return regex.test(filePath);
}

function globToRegex(glob: string): RegExp {
  let source = '';

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];

    if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
      continue;
    }

    if (char === '*') {
      source += '[^/]*';
      continue;
    }

    source += escapeRegex(char);
  }

  return new RegExp(`(^|/)${source}$`);
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

