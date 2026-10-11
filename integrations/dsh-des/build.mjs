import { createRequire } from 'node:module';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
const modules=join(root,'node_modules/.pnpm');
const esbuildPath=(await readdir(modules)).filter(x=>x.startsWith('esbuild@')).sort().at(-1);
if(!esbuildPath)throw new Error('Install LogicPilot workspace dependencies first');
const require=createRequire(import.meta.url),{build}=require(join(modules,esbuildPath,'node_modules/esbuild'));
const ideRequire=createRequire(join(root,'web/apps/ide/package.json'));
const threeRoot=dirname(dirname(ideRequire.resolve('three')));
await mkdir(join(here,'lib'),{recursive:true});
const output=await build({entryPoints:[join(here,'src/client.jsx')],bundle:true,format:'cjs',platform:'browser',target:'es2022',write:false,minify:false,
  external:['react','react/jsx-runtime'],alias:{three:threeRoot},loader:{'.css':'text'},jsx:'automatic'});
const code=output.outputFiles[0].text;
await writeFile(join(here,'lib/client.js'),`window.__ModuleLoader__.load({id:"@logicpilot/dsh-des",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${code}\nreturn module.exports;}});\n`);
console.log(`Built @logicpilot/dsh-des client (${Math.round(code.length/1024)} KB)`);
