// Preserve notices for the libraries bundled into lazy document readers, including their dependencies.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
export function readerNotices(nodeModules) {
 const seen=new Set(),targets=[];
 function visit(candidate) {
  if(!existsSync(join(candidate,"package.json")))return;
  const directory=realpathSync(candidate);if(seen.has(directory))return;seen.add(directory);
  const manifest=JSON.parse(readFileSync(join(directory,"package.json"),"utf8"));
  for(const name of readdirSync(directory))if(/^(license|licence|notice)(\.|$)/i.test(name))targets.push({src:join(directory,name),dest:`reader-licenses/${manifest.name.replaceAll("/","-")}@${manifest.version}`,rename:{stripBase:true}});
  let siblings=dirname(directory);while(!siblings.endsWith("/node_modules")&&dirname(siblings)!==siblings)siblings=dirname(siblings);
  for(const name of Object.keys(manifest.dependencies??{}))visit(existsSync(join(directory,"node_modules",name))?join(directory,"node_modules",name):join(siblings,name));
 }
 for(const name of ["react-resizable-panels","react-markdown","remark-gfm","remark-math","rehype-katex","rehype-highlight","rehype-slug","react-pdf","pdfjs-dist","papaparse","highlight.js","katex"])visit(join(nodeModules,name));
 return targets;
}
