import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
await build({stdin:{contents:"export {createClient} from '@supabase/supabase-js';",resolveDir:process.cwd(),sourcefile:'supabase-client.mjs'},bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,legalComments:'inline',outfile:'assets/vendor/supabase.mjs'});
const packages=['@supabase/supabase-js','@supabase/auth-js','@supabase/functions-js','@supabase/postgrest-js','@supabase/realtime-js','@supabase/phoenix','@supabase/storage-js','iceberg-js','tslib'];
const notices=[];
for(const name of packages){const root=`node_modules/${name}/`,manifest=JSON.parse(await readFile(root+'package.json','utf8'));notices.push(`${name}@${manifest.version}\n${await readFile(root+(name==='tslib'?'LICENSE.txt':name==='@supabase/phoenix'?'LICENSE.md':'LICENSE'),'utf8')}`);if(name==='tslib')notices.push(await readFile(root+'CopyrightNotice.txt','utf8'));}
await writeFile('assets/vendor/LICENSES.txt',notices.join('\n\n----------------------------------------\n\n'));
