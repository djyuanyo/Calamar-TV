import { realpathSync } from 'node:fs';
import { addChannel } from './registry.mjs';

const match = /^(?:acestream:\/\/)?([a-f0-9]{40})\/?$/i.exec((process.argv[2] || '').trim());
if (!match || process.argv.length !== 3) {
  console.error('Uso: sudo node /opt/calamar-acestream/add-channel.mjs acestream://ID');
  process.exitCode = 2;
} else {
  try {
    const key = addChannel(realpathSync('/etc/calamar-acestream/channels.json'), match[1].toLowerCase());
    console.log(`https://video.calamarmenciano.com/ace-live/${key}.ts`);
  } catch (error) {
    console.error(`No se pudo guardar el canal (${error.code || 'configuración no válida'}).`);
    process.exitCode = 1;
  }
}
