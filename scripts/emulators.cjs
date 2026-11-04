// Dedicated demo project only. Avoid Firebase CLI debug logging of inherited environment.
const {spawn}=require('node:child_process');
const path=require('node:path');
const pkgPath=require.resolve('firebase-tools/package.json');
const pkg=require(pkgPath);
const bin=path.resolve(path.dirname(pkgPath),typeof pkg.bin==='string'?pkg.bin:pkg.bin.firebase);
const test=process.argv[2]==='test';
const args=[bin,test?'emulators:exec':'emulators:start','--project','demo-orbis-victor','--only','auth,firestore',...process.argv.slice(3)];
if(test)args.push('npm run test:cloud:integration');
const child=spawn(process.execPath,args,{stdio:'inherit',env:{...process.env,DEBUG:''}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
