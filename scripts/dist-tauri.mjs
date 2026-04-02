#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, '..')
const configPath = join(rootDir, 'src-tauri', 'tauri.conf.json')
const tauriConfig = JSON.parse(readFileSync(configPath, 'utf8'))
const productName = tauriConfig.productName ?? 'Mako'
const releaseBundleDir = join(rootDir, 'src-tauri', 'target', 'release', 'bundle')
const distDir = join(rootDir, 'dist')
const tauriBinary = resolve(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tauri.cmd' : 'tauri'
)

const requestedPlatform = normalizePlatform(process.argv[2] ?? process.platform)
const hostPlatform = normalizePlatform(process.platform)

if (!requestedPlatform) {
  fail(`Unsupported platform argument: ${process.argv[2] ?? process.platform}`)
}

if (!hostPlatform) {
  fail(`Unsupported host platform: ${process.platform}`)
}

if (requestedPlatform !== hostPlatform) {
  fail(
    `Cross-platform Tauri packaging is not supported from this host. ` +
      `Run the ${requestedPlatform} bundle on a native ${requestedPlatform} machine or CI runner.`
  )
}

mkdirSync(distDir, { recursive: true })

switch (requestedPlatform) {
  case 'macos':
    buildMacRelease()
    break
  case 'windows':
    buildAndCopyArtifacts(['nsis'], [{ dir: 'nsis', extensions: ['.exe', '.msi'] }])
    break
  case 'linux':
    buildAndCopyArtifacts(
      ['deb', 'appimage'],
      [
        { dir: 'deb', extensions: ['.deb'] },
        { dir: 'appimage', extensions: ['.AppImage', '.appimage'] }
      ]
    )
    break
  default:
    fail(`Unsupported normalized platform: ${requestedPlatform}`)
}

function buildMacRelease() {
  runTauriBuild(['app'])

  const appSourcePath = join(releaseBundleDir, 'macos', `${productName}.app`)
  if (!existsSync(appSourcePath)) {
    fail(`Expected app bundle was not created: ${appSourcePath}`)
  }

  const appDestinationPath = join(distDir, `${productName}.app`)
  const dmgDestinationPath = join(distDir, `${productName}.dmg`)

  removePath(appDestinationPath)
  removePath(dmgDestinationPath)

  copyPath(appSourcePath, appDestinationPath)
  createMacDmg(appSourcePath, dmgDestinationPath)

  console.log(`Created ${relativeToRoot(appDestinationPath)}`)
  console.log(`Created ${relativeToRoot(dmgDestinationPath)}`)
}

function buildAndCopyArtifacts(bundleTargets, artifactSources) {
  runTauriBuild(bundleTargets)

  let copiedArtifactCount = 0
  for (const artifactSource of artifactSources) {
    const sourceDir = join(releaseBundleDir, artifactSource.dir)
    if (!existsSync(sourceDir)) {
      continue
    }

    for (const entry of readdirSync(sourceDir)) {
      const sourcePath = join(sourceDir, entry)
      if (!statSync(sourcePath).isFile()) {
        continue
      }

      if (!artifactSource.extensions.some(extension => entry.endsWith(extension))) {
        continue
      }

      const destinationPath = join(distDir, basename(sourcePath))
      removePath(destinationPath)
      copyFileSync(sourcePath, destinationPath)
      copiedArtifactCount += 1
      console.log(`Created ${relativeToRoot(destinationPath)}`)
    }
  }

  if (copiedArtifactCount === 0) {
    fail('No release artifacts were found after the Tauri build completed.')
  }
}

function createMacDmg(appSourcePath, dmgDestinationPath) {
  const stagingDir = mkdtempSync(join(tmpdir(), 'mako-dmg-'))
  const stagedAppPath = join(stagingDir, `${productName}.app`)
  const applicationsLinkPath = join(stagingDir, 'Applications')

  try {
    copyPath(appSourcePath, stagedAppPath)
    symlinkSync('/Applications', applicationsLinkPath)

    runCommand('hdiutil', [
      'create',
      '-volname',
      productName,
      '-srcfolder',
      stagingDir,
      '-ov',
      '-format',
      'UDZO',
      dmgDestinationPath
    ])
  } finally {
    removePath(stagingDir)
  }
}

function runTauriBuild(bundleTargets) {
  runCommand(tauriBinary, ['build', '--bundles', bundleTargets.join(',')])
}

function copyPath(sourcePath, destinationPath) {
  removePath(destinationPath)

  if (process.platform === 'darwin') {
    runCommand('ditto', [sourcePath, destinationPath])
    return
  }

  const sourceStats = statSync(sourcePath)
  if (sourceStats.isDirectory()) {
    cpSync(sourcePath, destinationPath, { recursive: true, dereference: false })
    return
  }

  copyFileSync(sourcePath, destinationPath)
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit'
  })

  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function removePath(targetPath) {
  rmSync(targetPath, { force: true, recursive: true })
}

function relativeToRoot(targetPath) {
  return targetPath.startsWith(`${rootDir}/`) ? targetPath.slice(rootDir.length + 1) : targetPath
}

function normalizePlatform(platform) {
  switch (platform) {
    case 'darwin':
    case 'mac':
    case 'macos':
      return 'macos'
    case 'win32':
    case 'windows':
      return 'windows'
    case 'linux':
      return 'linux'
    default:
      return null
  }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
