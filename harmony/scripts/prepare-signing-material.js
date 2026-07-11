const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const signingDir = process.argv[2];
if (!signingDir) throw new Error('Signing directory is required.');

const components = [
  Buffer.from('11a32c4d5e6f708192a3b4c5d6e7f801', 'hex'),
  Buffer.from('2132435465768798a9bacbdcedfe0f10', 'hex'),
  Buffer.from('31425364758697a8b9cadbecfd0e1f20', 'hex')
];
const builtIn = Buffer.from([49, 243, 9, 115, 214, 175, 91, 184, 211, 190, 177, 88, 101, 131, 192, 119]);
const salt = Buffer.from('a15bc36de72f4981b3d5f7192b4d6f81', 'hex');
const workKey = Buffer.from('4d6f6f6e437574456d754b6579313233', 'hex');
const workIv = Buffer.from('102132435465768798a9bacb', 'hex');
const passwordIv = Buffer.from('cbdcedfe0f10213243546576', 'hex');

function xorAll(values) {
  const output = Buffer.from(values[0]);
  for (let valueIndex = 1; valueIndex < values.length; valueIndex += 1) {
    for (let index = 0; index < output.length; index += 1) output[index] ^= values[valueIndex][index];
  }
  return output;
}

function seal(key, iv, plaintext) {
  const cipher = crypto.createCipheriv('aes-128-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const size = Buffer.alloc(4);
  size.writeUInt32BE(encrypted.length + tag.length);
  return Buffer.concat([size, iv, encrypted, tag]);
}

function writeMaterial(relativeDirectory, data) {
  const directory = path.join(signingDir, 'material', relativeDirectory);
  fs.mkdirSync(directory, { recursive: true });
  writeIfChanged(path.join(directory, 'data'), data);
}

function writeIfChanged(file, data) {
  if (fs.existsSync(file) && fs.readFileSync(file).equals(data)) return;
  fs.writeFileSync(file, data);
}

const xored = xorAll([...components, builtIn]);
const rootKey = crypto.pbkdf2Sync(xored.toString(), salt, 10000, 16, 'sha256');
writeMaterial(path.join('fd', 'a'), components[0]);
writeMaterial(path.join('fd', 'b'), components[1]);
writeMaterial(path.join('fd', 'c'), components[2]);
writeMaterial('ac', salt);
writeMaterial('ce', seal(rootKey, workIv, workKey));

process.stdout.write(seal(workKey, passwordIv, Buffer.from('123456', 'utf8')).toString('hex'));
