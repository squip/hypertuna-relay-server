// hypertuna-start-node.js

import { pbkdf2Sync } from 'node:crypto';
import tweetnaclPkg from 'tweetnacl';
import { utils, getPublicKey } from 'noble-secp256k1';
import { question } from 'readline-sync';
import base32Pkg from 'base32.js';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { Encoder, Decoder } = base32Pkg;
const { sign } = tweetnaclPkg;

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Function to decode a base32 NOSTR private key (nsec)
function decodeNsec(nsec) {
    const decoder = new Decoder();
    return Buffer.from(decoder.write(nsec).finalize());
}

// Function to encode a raw Ed25519 private key to base32 (for demonstration purposes)
function encodeBase32(buffer) {
    const encoder = new Encoder();
    return encoder.write(buffer).finalize().toLowerCase();
}

// Function to derive a new Ed25519 keypair
function deriveNewKeypair(nsecPrivateKey, context) {
    // Use HMAC-SHA256 as the key derivation function
    const derivedKey = pbkdf2Sync(nsecPrivateKey, context, 100000, 32, 'sha256');
    
    // Generate new Ed25519 keypair using the derived key
    const newKeypair = sign.keyPair.fromSeed(derivedKey);
    
    // Return the new private and public keys as Buffers
    return {
        privateKey: Buffer.from(newKeypair.secretKey),
        publicKey: Buffer.from(newKeypair.publicKey),
        seed: derivedKey.slice(0, 32).toString('hex') // Add seed (first 64 characters of privateKey)
    };
}

// Function to generate a new NOSTR keypair
async function generateNostrKeypair() {
    const privateKey = utils.randomPrivateKey();
    const publicKey = await getPublicKey(privateKey, true);

    const nsec = encodeBase32(Buffer.from(privateKey));
    const npub = encodeBase32(Buffer.from(publicKey.slice(1)));
    
    return { 
        nsec, 
        npub,
        privateKeyHex: Buffer.from(privateKey).toString('hex'),
        publicKeyHex: Buffer.from(publicKey.slice(1)).toString('hex')
    };
}

// CLI Workflow
async function cli() {
    const useExisting = question('Would you like to use an existing NOSTR keypair? (y/n): ');

    let privateKeyHex;
    let publicKeyHex;
    let npubPublicKey;
    let nsecPrivateKey;
    
    if (useExisting.toLowerCase() === 'y') {
        const nsec = question('Enter your nsec (private key): ');
        const privateKeyBytes = decodeNsec(nsec);
        privateKeyHex = privateKeyBytes.toString('hex');
        
        // Derive public key from private key
        const publicKeyBytes = await getPublicKey(privateKeyHex, true);
        publicKeyHex = Buffer.from(publicKeyBytes.slice(1)).toString('hex');
        npubPublicKey = encodeBase32(Buffer.from(publicKeyBytes.slice(1)));
    } else {
        console.log('Generating a new NOSTR keypair...');
        const newKeypair = await generateNostrKeypair();
        privateKeyHex = newKeypair.privateKeyHex;
        publicKeyHex = newKeypair.publicKeyHex;
        npubPublicKey = newKeypair.npub;
        nsecPrivateKey = newKeypair.nsec;
        
        console.log('Generated nostr pubkey (hex):', publicKeyHex);
        console.log('Generated nostr nsec (hex):', privateKeyHex);
    }

    // Prompt the user for a context string
    const contextString = 'hypertuna-relay';
    
    const derivedKeypair = deriveNewKeypair(nsecPrivateKey, contextString);
    
    console.log('Derived Relay Private Key:', derivedKeypair.privateKey.toString('hex'));
    console.log('Derived Relay Public Key:', derivedKeypair.publicKey.toString('hex'));

    // Prompt for gateway server address
    const proxy_server_address = question('Enter the hypertuna proxy server address you wish to register your node\'s public key with (ip or domain): ', {
        defaultInput: '127.0.0.1:8443'
    });

    // Save to JSON file
    const jsonData = {
        nostr_pubkey_hex: publicKeyHex,
        nostr_nsec_hex: privateKeyHex,
        proxy_privateKey: derivedKeypair.privateKey.toString('hex'),
        proxy_publicKey: derivedKeypair.publicKey.toString('hex'),
        proxy_seed: derivedKeypair.seed,
        proxy_server_address: proxy_server_address,
        gatewayUrl: `https://${proxy_server_address}`
    };

    const fileName = `hypertuna-peer-${derivedKeypair.publicKey.toString('hex')}.json`;
    writeFileSync(fileName, JSON.stringify(jsonData, null, 2));
    console.log(`hypertuna peer node keys saved to file: ${fileName}`);

// Prompt to join network
question('Node configuration complete. Press enter to join network.');

// Execute tunafish-node6.js with arguments
const nodeProcess = spawn('node', [join(__dirname, 'hypertuna-relay-server.mjs'), fileName], { stdio: 'inherit' });

nodeProcess.on('close', (code) => {
    console.log(`hypertuna-relay-server.mjs process exited with code ${code}`);
});

}

// Run the CLI
cli();
