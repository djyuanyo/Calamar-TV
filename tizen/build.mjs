import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const tizen = dirname(fileURLToPath(import.meta.url));
const root = dirname(tizen);
const web = join(root, 'web');
const destination = resolve(process.argv[2] || 'build/Calamar-TV-Tizen.wgt');
const stage = await mkdtemp(join(tmpdir(), 'calamar-tizen-'));
const files = ['styles.css', 'library-episodes.css', 'vps-panel.css', 'sleep-timer.css', 'assets', 'images/manifest.json'];
const sdk = /^https:\/\/www\.gstatic\.com\/firebasejs\/13\.0\.0\/firebase-(app|auth|firestore)\.js$/;

try {
  for (const file of files) {
    await mkdir(dirname(join(stage, file)), { recursive: true });
    await cp(join(web, file), join(stage, file), { recursive: true });
  }
  await cp(join(tizen, 'config.xml'), join(stage, 'config.xml'));
  await cp(join(tizen, 'node_modules/hls.js/dist/hls.min.js'), join(stage, 'hls.js'));
  await cp(join(tizen, 'node_modules/mpegts.js/dist/mpegts.js'), join(stage, 'mpegts.js'));
  await mkdir(join(stage, 'licenses'));
  for (const library of ['hls.js', 'mpegts.js']) {
    await cp(join(tizen, 'node_modules', library, 'LICENSE'), join(stage, 'licenses', library + '.txt'));
  }
  await cp(join(tizen, 'node_modules/mpegts.js/dist/mpegts.js.LICENSE.txt'), join(stage, 'mpegts.js.LICENSE.txt'));

  const data = {};
  for (const file of ['tdt.json', 'custom.json', 'sports.json']) {
    data['data/' + file] = JSON.parse(await readFile(join(root, 'data', file), 'utf8'));
  }
  data['data/logos.json'] = {};
  await writeFile(join(stage, 'data.js'), 'window.calamarTizenData = ' + JSON.stringify(data) + ';\n');
  await cp(join(tizen, 'tizen.css'), join(stage, 'tizen.css'));

  const options = {
    nodePaths: [join(tizen, 'node_modules')],
    bundle: true, platform: 'browser', format: 'iife', target: 'chrome94', minify: true,
    legalComments: 'linked',
    plugins: [{
      name: 'firebase-local',
      setup(build) {
        build.onResolve({ filter: sdk }, args => build.resolve('firebase/' + args.path.match(sdk)[1], {
          kind: args.kind, resolveDir: tizen,
        }));
      },
    }],
  };
  for (const page of ['index', 'direct-player']) {
    const main = page === 'index';
    const script = main ? 'app' : page;
    const html = (await readFile(join(web, page + '.html'), 'utf8'))
      .replace('<html lang="es">', '<html lang="es" data-platform="tizen">')
      .replace('</head>', '<link rel="stylesheet" href="tizen.css" />\n  </head>')
      .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/hls\.js@[^"]+/, 'hls.js')
      .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/mpegts\.js@[^"]+/, 'mpegts.js')
      .replace(`<script type="module" src="${script}.js"></script>`,
        (main ? '<script src="data.js"></script>\n    ' : '') + `<script src="${script}.js"></script>`);
    if (/type="module"|<script src="https?:/.test(html) || !html.includes(`src="${script}.js"`)
        || (main && (!html.includes('data-platform="tizen"') || !html.includes('src="data.js"'))))
      throw new Error('El inicio local de Tizen no se pudo preparar: ' + page);
    await writeFile(join(stage, page + '.html'), html);
    await build({
      ...options,
      stdin: {
        contents: `import './tizen/compat.js'; import './web/${script}.js';` +
          (main ? "import { setupTizenRemote } from './tizen/remote.js'; setupTizenRemote();" : ''),
        resolveDir: root, sourcefile: 'calamar-tizen.js',
      },
      outfile: join(stage, script + '.js'),
    });
  }
  await mkdir(dirname(destination), { recursive: true });
  await rm(destination, { force: true });
  execFileSync('zip', ['-q', '-r', destination, ...await readdir(stage)], { cwd: stage });
  console.log(destination);
} finally {
  await rm(stage, { recursive: true, force: true });
}
