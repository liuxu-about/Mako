const windowsRootPattern = /^[A-Za-z]:\/$/

export function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')

  if (normalized === '/' || windowsRootPattern.test(normalized)) {
    return normalized
  }

  const trimmed = normalized.replace(/\/+$/g, '')
  return trimmed || '/'
}

export function getPathBasename(path: string): string {
  const normalized = normalizePath(path)

  if (normalized === '/' || windowsRootPattern.test(normalized)) {
    return normalized
  }

  const segments = normalized.split('/')
  return segments[segments.length - 1] || normalized
}

export function getPathDirname(path: string): string {
  const normalized = normalizePath(path)

  if (normalized === '/' || windowsRootPattern.test(normalized)) {
    return normalized
  }

  const lastSeparatorIndex = normalized.lastIndexOf('/')
  if (lastSeparatorIndex < 0) return '.'
  if (lastSeparatorIndex === 0) return '/'

  const dirname = normalized.slice(0, lastSeparatorIndex)
  if (/^[A-Za-z]:$/.test(dirname)) {
    return `${dirname}/`
  }

  return dirname
}

export function isPathWithinRoot(rootPath: string, targetPath: string): boolean {
  const normalizedRoot = normalizePath(rootPath)
  const normalizedTarget = normalizePath(targetPath)

  if (normalizedRoot === normalizedTarget) {
    return true
  }

  if (normalizedRoot === '/' || windowsRootPattern.test(normalizedRoot)) {
    return normalizedTarget.startsWith(normalizedRoot)
  }

  return normalizedTarget.startsWith(`${normalizedRoot}/`)
}

export function getAncestorDirectories(rootPath: string, targetPath: string): string[] {
  if (!isPathWithinRoot(rootPath, targetPath)) {
    return []
  }

  const normalizedRoot = normalizePath(rootPath)
  let currentDirectory = normalizePath(getPathDirname(targetPath))
  const directories: string[] = []

  while (true) {
    directories.push(currentDirectory)

    if (currentDirectory === normalizedRoot) {
      break
    }

    const parentDirectory = normalizePath(getPathDirname(currentDirectory))
    if (parentDirectory === currentDirectory) {
      break
    }

    currentDirectory = parentDirectory
  }

  return directories.reverse()
}
