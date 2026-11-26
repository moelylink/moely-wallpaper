const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * Removes unused Windows shader compiler DLL from the unpacked Electron bundle
 * to keep the NSIS installer under GitHub's 100 MB single-file limit.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const target = path.join(context.appOutDir, 'dxcompiler.dll');
  if (!fs.existsSync(target)) return;

  const escaped = target.replace(/'/g, "''");
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')`
  ], { stdio: 'inherit' });
};
