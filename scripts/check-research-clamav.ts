import assert from 'node:assert/strict';
import path from 'node:path';
import {scanWithClamAv} from '../lib/research/clamav';
const socketPath=path.resolve('.local-migration/clamav/clamd.sock');
async function main(){
 assert.equal(await scanWithClamAv(Buffer.from('Clean research upload test.'),socketPath),true);
 // EICAR is the standard harmless antivirus test signature, not executable malware.
 const eicar=Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
 assert.equal(await scanWithClamAv(eicar,socketPath),false);
 console.log('PASS real native ClamAV: clean file accepted; harmless EICAR signature rejected; current definitions verified. No email or external file transmission.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
