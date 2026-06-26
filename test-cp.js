const fs = require('fs'); 
const path = require('path'); 
fs.mkdirSync('test-cp-src/sub', {recursive:true}); 
fs.writeFileSync('test-cp-src/sub/file.txt', 'hello'); 
fs.mkdirSync('test-cp-dest', {recursive:true}); 
fs.cpSync('test-cp-src/sub', 'test-cp-dest', {recursive:true}); 
console.log(fs.readdirSync('test-cp-dest'));
