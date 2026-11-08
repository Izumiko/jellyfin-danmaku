import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const source = path.join(dist, 'jellyfin-danmaku.user.js');
const target = path.join(dist, 'ede.user.js');

if (!existsSync(source)) {
    throw new Error(`Missing userscript build output: ${source}`);
}

copyFileSync(source, target);
console.log(`Copied ${path.relative(process.cwd(), source)} -> ${path.relative(process.cwd(), target)}`);
