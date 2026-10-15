'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '../..');
const outDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'dist-pack');

// Binary / .app folder use no spaces; Finder shows CFBundleDisplayName.
const appName = 'TSGLauncher';
const productName = 'TSG Launcher';
const version = (() => {
  try {
    return require(path.join(root, 'package.json')).version || '0.2.0';
  } catch (_) {
    return '0.2.0';
  }
})();

function buildIcns() {
  const png = path.join(repoRoot, 'Icon.png');
  if (!fs.existsSync(png)) {
    throw new Error(`App icon missing: ${png}`);
  }
  const buildDir = path.join(root, 'build');
  const iconset = path.join(buildDir, 'icon.iconset');
  const icns = path.join(buildDir, 'icon.icns');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });

  const sizes = [
    [16, 'icon_16x16.png'],
    [32, 'diana.w@example.org'],
    [32, 'icon_32x32.png'],
    [64, 'ivan.p@example.net'],
    [128, 'icon_128x128.png'],
    [256, 'wendy.h@example.net'],
    [256, 'icon_256x256.png'],
    [512, 'wendy.h@example.net'],
    [512, 'icon_512x512.png'],
    [1024, 'walt.e@example.net'],
  ];
  for (const [px, name] of sizes) {
    const dest = path.join(iconset, name);
    execFileSync('/usr/bin/sips', ['-z', String(px), String(px), png, '--out', dest], {
      stdio: 'ignore',
    });
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', icns], { stdio: 'ignore' });
  fs.rmSync(iconset, { recursive: true, force: true });
  return icns;
}

async function main() {
  const packager = require('@electron/packager');
  fs.mkdirSync(path.dirname(outDir), { recursive: true });

  const icon = buildIcns();

  // Packager writes <out>/<name>-darwin-arm64/<name>.app
  const tmpOut = path.join(root, '.pack-out');
  fs.rmSync(tmpOut, { recursive: true, force: true });

  const appPaths = await packager({
    dir: root,
    name: appName,
    executableName: appName,
    platform: 'darwin',
    arch: 'arm64',
    out: tmpOut,
    overwrite: true,
    prune: true,
    asar: true,
    quiet: false,
    icon,
    appBundleId: 'com.tsglauncher.app',
    appCategoryType: 'public.app-category.games',
    appVersion: version,
    buildVersion: version,
    darwinDarkModeSupport: true,
    ignore: [
      /^\/\.pack-out($|\/)/,
      /^\/dist-pack($|\/)/,
      /^\/build($|\/)/,
      /^\/scripts($|\/)/,
      /^\/node_modules($|\/)/,
      /\.md$/i,
      /package-lock\.json$/,
    ],
  });

  const packed = appPaths[0];
  const srcApp = path.join(packed, `${appName}.app`);
  if (!fs.existsSync(srcApp)) {
    throw new Error(`Packaged app not found at ${srcApp}`);
  }

  // Final destination may be .../TSG Launcher.app
  let destApp = outDir;
  if (!destApp.endsWith('.app')) {
    destApp = path.join(outDir, `${productName}.app`);
  }
  fs.rmSync(destApp, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destApp), { recursive: true });
  execFileSync('/bin/cp', ['-R', srcApp, destApp]);

  // Ensure display name + icon keys in Info.plist
  const plist = path.join(destApp, 'Contents/Info.plist');
  if (fs.existsSync(plist)) {
    try {
      execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleDisplayName', '-string', productName, plist]);
      execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleName', '-string', appName, plist]);
      execFileSync('/usr/bin/plutil', ['-replace', 'LSMinimumSystemVersion', '-string', '14.0', plist]);
      execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleIconFile', '-string', 'icon.icns', plist]);
    } catch (_) {}
  }

  // Make sure icon.icns is present (packager usually copies it as electron.icns / icon.icns)
  const resources = path.join(destApp, 'Contents/Resources');
  const destIcns = path.join(resources, 'icon.icns');
  if (!fs.existsSync(destIcns) && fs.existsSync(icon)) {
    fs.copyFileSync(icon, destIcns);
  }
  // Replace default Electron icon if packager left it under another name
  for (const name of ['electron.icns', `${appName}.icns`]) {
    const p = path.join(resources, name);
    if (fs.existsSync(p) && fs.existsSync(icon)) fs.copyFileSync(icon, p);
  }

  fs.rmSync(tmpOut, { recursive: true, force: true });
  // Nudge Finder to refresh the icon
  try {
    execFileSync('/usr/bin/touch', [destApp]);
  } catch (_) {}
  console.log(`Built: ${destApp}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
