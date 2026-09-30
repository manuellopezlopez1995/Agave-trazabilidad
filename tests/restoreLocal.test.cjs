const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
test('local restore cannot address remote or operational databases or inject connection overrides',async()=>{
 const {localDatabase}=await import('../scripts/restore-local.mjs');
 for(const url of ['postgres://u:p@db.project.supabase.co/agave_restore_test','postgres://u:p@localhost/postgres','postgres://u:p@localhost/agave_restore_test?host=remote','postgres://u:p@127.0.0.1.evil/agave_restore_test','https://localhost/agave_restore_test'])assert.throws(()=>localDatabase(url));
 const local=localDatabase('postgres://u:secret@127.0.0.1:5432/agave_restore_test');
 assert.equal(local.password,'secret');assert.equal(new URL(local.url).password,'');
});
test('restore rejects traversal and corrupted originals even if byte count matches',async()=>{
 const {relativeObject,verifyBytes}=await import('../scripts/restore-local.mjs');
 for(const [bucket,path] of [['x','../private'],['../x','photo.jpg'],['x','/private'],['x','a\\private']])assert.throws(()=>relativeObject(bucket,path));
 const bytes=Buffer.from('original');const manifest={size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 verifyBytes(bytes,manifest);assert.throws(()=>verifyBytes(Buffer.from('tampered'),manifest));
 assert.throws(()=>verifyBytes(bytes,{...manifest,size:0}));
});
