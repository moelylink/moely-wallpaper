import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsyncDefault = promisify(execFile);

const WINDOWS_NATIVE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp']);

const SCALE_TO_REGISTRY = {
  fill: { style: '10', tile: '0' },
  fit: { style: '6', tile: '0' },
  stretch: { style: '2', tile: '0' },
  center: { style: '0', tile: '0' },
  tile: { style: '0', tile: '1' },
  span: { style: '22', tile: '0' }
};

const POWERSHELL_SET_WALLPAPER_SCRIPT = `
$ErrorActionPreference = 'Stop'
$targetPath = $env:MOELY_WALLPAPER_PATH
if (-not $targetPath -or -not (Test-Path -LiteralPath $targetPath)) {
  throw 'Wallpaper file not found'
}
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value $env:MOELY_WALLPAPER_STYLE
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value $env:MOELY_WALLPAPER_TILE
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MoelyWallpaperNative {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool SystemParametersInfoW(uint uiAction, uint uiParam, string pvParam, uint fWinIni);
}
"@
if (-not [MoelyWallpaperNative]::SystemParametersInfoW(0x0014, 0, $targetPath, 0x03)) {
  throw ("SystemParametersInfoW failed with Win32 error " + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
}
`.trim();

/**
 * Maps wallpaper scale modes to Windows desktop registry values.
 */
export function getWindowsScaleRegistryValues(scale) {
  return SCALE_TO_REGISTRY[scale] || SCALE_TO_REGISTRY.fill;
}

/**
 * Ensures an image is in a format directly supported by Windows SystemParametersInfoW.
 */
export async function ensureWindowsCompatibleImage(imagePath, { outputDir, convertToPng }) {
  if (typeof imagePath !== 'string' || !imagePath.trim()) {
    throw new Error('Invalid wallpaper image path');
  }
  const resolved = path.resolve(imagePath);
  const ext = path.extname(resolved).toLowerCase();
  if (WINDOWS_NATIVE_EXTENSIONS.has(ext)) {
    return resolved;
  }
  if (typeof convertToPng !== 'function') {
    throw new Error(`Unsupported Windows wallpaper format: ${ext || 'unknown'}`);
  }
  const pngBuffer = await convertToPng(resolved);
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length === 0) {
    throw new Error('Failed to convert wallpaper image to PNG');
  }
  await fs.mkdir(outputDir, { recursive: true });
  const targetPath = path.join(outputDir, 'fallback-wallpaper.png');
  await fs.writeFile(targetPath, pngBuffer);
  return targetPath;
}

/**
 * Sets the Windows desktop wallpaper via SystemParametersInfoW and desktop registry settings.
 */
export async function setWindowsWallpaperViaSystemApi(
  imagePath,
  { scale = 'fill', execFileAsync = execFileAsyncDefault, timeoutMs = 15000 } = {}
) {
  if (typeof imagePath !== 'string' || !imagePath.trim()) {
    throw new Error('Invalid wallpaper image path');
  }
  const resolvedPath = path.resolve(imagePath);
  const { style, tile } = getWindowsScaleRegistryValues(scale);
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_SET_WALLPAPER_SCRIPT],
    {
      timeout: timeoutMs,
      windowsHide: true,
      env: {
        ...process.env,
        MOELY_WALLPAPER_PATH: resolvedPath,
        MOELY_WALLPAPER_STYLE: style,
        MOELY_WALLPAPER_TILE: tile
      }
    }
  );
}
