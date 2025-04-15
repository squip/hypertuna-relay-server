// hypertuna-node.mjs

import express from 'express';
import { spawn } from 'node:child_process';
import axios from 'axios';
import { join, dirname } from 'node:path';
import WebSocket from 'ws';
import { promises as fs } from 'node:fs';
const readline = require('readline');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Load configuration from JSON file
const configFile = process.argv[2];

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function initializeApp() {
  try {
    const configData = await fs.readFile(configFile, 'utf8');
    const config = JSON.parse(configData);

    const seed = config.derivedSeed;
    let publicKey = config.derivedPublicKey;
    const gatewayUrl = config.gatewayUrl;

    let activeRelays = new Map();
    let RelayManager, generateRandomPubkey;
    let hyperdriveProcess = null;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    });

// Helper function to ask questions asynchronously
function askQuestion(rl, question) {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer);
      });
    });
  }

// Dynamically import the ES module
(async () => {
  try {
    const module = await import('./hypertuna-relay.mjs');
    RelayManager = module.RelayManager;
    generateRandomPubkey = module.generateRandomPubkey;
    console.log('RelayManager module loaded successfully');
    rl.prompt();
  } catch (err) {
    console.error('Failed to load RelayManager module:', err);
  }
})();

// Serve static files from 'public' directory
app.use(express.static(join(__dirname, 'reader-dir')));

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log(`  Headers: ${JSON.stringify(req.headers)}`);
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error processing request: ${err.message}`);
  res.status(500).send('Internal Server Error');
});

// Add a route handler for the root path
app.get('/', (req, res) => {
  res.send('Welcome to the Hypertuna Relay Node');
});

// Endpoint to handle relay messages
app.post('/post/relay/:relayKey', async (req, res) => {
  const { relayKey } = req.params;
  const { message, connectionKey } = req.body;

  logWithTimestamp(`Received message for relay ${relayKey}, connectionKey: ${connectionKey}:`, message);

  const relayManager = activeRelays.get(relayKey);
  if (!relayManager) {
      logWithTimestamp(`Relay not found: ${relayKey}`);
      return res.status(404).json(['NOTICE', 'Relay not found']);
  }

  try {
      let nostrMessage;
      if (message && message.type === 'Buffer' && Array.isArray(message.data)) {
          const messageStr = Buffer.from(message.data).toString('utf8');
          try {
              nostrMessage = JSON.parse(messageStr);
          } catch (parseError) {
              throw new Error(`Failed to parse NOSTR message: ${parseError.message}`);
          }
      } else {
          nostrMessage = message;
      }

      if (!Array.isArray(nostrMessage)) {
          throw new Error('Invalid NOSTR message format - expected array');
      }

      if (nostrMessage.length < 2) {
          throw new Error('Invalid NOSTR message format - insufficient elements');
      }

      const sendResponse = (response) => {
          logWithTimestamp(`Sending response to gateway for relay ${relayKey}, connectionKey: ${connectionKey}:`, response);
          res.write(JSON.stringify(response) + '\n');
      };

      await relayManager.handleMessage(nostrMessage, sendResponse, connectionKey);

      res.end();
      logWithTimestamp(`Finished processing message for relay ${relayKey}, connectionKey: ${connectionKey}`);
  } catch (error) {
      logWithTimestamp(`Error processing message for relay ${relayKey}, connectionKey: ${connectionKey}:`, error.message);
      res.status(500).json([['NOTICE', `Error: ${error.message}`]]);
  }
});

// Endpoint to retrieve events
app.get('/get/relay/:relayKey/:connectionKey', async (req, res) => {
  const { relayKey, connectionKey } = req.params;

  logWithTimestamp(`Checking relay ${relayKey} for active subscriptions for connectionKey: ${connectionKey}`);

  const relayManager = activeRelays.get(relayKey);
  if (!relayManager) {
      logWithTimestamp(`Relay not found: ${relayKey}`);
      return res.status(404).json(['NOTICE', 'Relay not found']);
  }

  try {
      const [events, activeSubscriptionsUpdated] = await relayManager.handleSubscription(connectionKey);

      if (!Array.isArray(events)) {
          logWithTimestamp(`Invalid response format from handleSubscription for connectionKey: ${connectionKey}`);
          return res.status(500).json(['NOTICE', 'Internal server error: Invalid response format']);
      }

      if (events.length === 0) {
          logWithTimestamp(`No events found for connectionKey: ${connectionKey}`);
          return res.json([]);
      }

      if (activeSubscriptionsUpdated) {
          try {
              logWithTimestamp(`Updating subscriptions for connectionKey: ${connectionKey}`);
              await relayManager.updateSubscriptions(connectionKey, activeSubscriptionsUpdated);
          } catch (updateError) {
              logWithTimestamp(`Warning: Failed to update subscriptions for connectionKey: ${connectionKey}:`, updateError.message);
          }
      }

      logWithTimestamp(`Returning ${events.length} events for connectionKey: ${connectionKey}`);
      res.json(events);

  } catch (error) {
      logWithTimestamp(`Error processing subscription for relay ${relayKey}, connectionKey: ${connectionKey}:`, error.message);
      res.status(500).json(['NOTICE', `Error: ${error.message}`]);
  }
});

// Modified registerWithGateway function
function registerWithGateway(nip11Info = null) {
    if (!publicKey) {
      console.log(`[${new Date().toISOString()}] Public key not available yet. Skipping registration.`);
      return;
    }
  
    console.log(`[${new Date().toISOString()}] Attempting to register with gateway: ${gatewayUrl}/register`);
    const registrationData = { 
      publicKey,
      relays: Array.from(activeRelays.keys())
    };
  
    if (nip11Info) {
      registrationData.nip11Info = nip11Info;
    }
  
    axios.post(`${gatewayUrl}/register`, registrationData)
      .then(response => {
        console.log(`[${new Date().toISOString()}] Registered with gateway. Response:`, response.data);
        if (response.data.driveKey) {
          console.log(`[${new Date().toISOString()}] Received drive key: ${response.data.driveKey}`);
          startHyperdriveProcess(response.data.driveKey);
        }
      })
      .catch(error => {
        console.error(`[${new Date().toISOString()}] Failed to register with gateway:`, error.message);
      });
  }

async function removeDirectory(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
    console.log(`[${new Date().toISOString()}] Successfully removed directory: ${dir}`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error removing directory ${dir}:`, err);
  }
}

async function startHyperdriveProcess(driveKey) {
  if (hyperdriveProcess) {
    console.log(`[${new Date().toISOString()}] Hyperdrive process already running. Stopping it.`);
    hyperdriveProcess.kill();
    
    // Wait for the process to fully terminate
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Remove the storageDir directory
  const storageDir = join(__dirname, 'storage-hypertuna-drive');
  await removeDirectory(storageDir);

  console.log(`[${new Date().toISOString()}] Starting Hyperdrive process with key: ${driveKey}`);
  hyperdriveProcess = spawn('node', ['hypertuna-drive.mjs', driveKey], {
    stdio: ['inherit', 'inherit', 'inherit']
  });

  hyperdriveProcess.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] Failed to start Hyperdrive process:`, error);
  });

  hyperdriveProcess.on('exit', (code, signal) => {
    console.log(`[${new Date().toISOString()}] Hyperdrive process exited with code ${code} and signal ${signal}`);
    hyperdriveProcess = null;
  });
}

// Function to create a new relay
async function createRelay(storageDir = null) {
    if (!RelayManager) {
      console.error('RelayManager module not loaded yet');
      return;
    }
    const relayManager = new RelayManager(storageDir || './storage', null, rl);
    try {
      await relayManager.initialize();
      const relayKey = relayManager.getPublicKey();
      activeRelays.set(relayKey, relayManager);
      console.log(`[${new Date().toISOString()}] Created new relay with key: ${relayKey}`);
      
      // Prompt for NIP-11 information
      const nip11Info = {
        name: await askQuestion(rl, 'Give your relay a name: '),
        description: await askQuestion(rl, 'Relay description: '),
        pubkey: config.npub, // Use the NOSTR public key from the config file
        software: 'hypertuna-relay',
        version: '0.0.1',
        supported_nips: (await askQuestion(rl, 'Supported NIPs (comma-separated numbers): '))
          .split(',').map(nip => parseInt(nip.trim())),
      };
    
      // Save NIP-11 info to file
      const nip11FileName = `NIP-11-${relayKey}.json`;
      await fs.writeFile(nip11FileName, JSON.stringify(nip11Info, null, 2));
      console.log(`NIP-11 information saved to ${nip11FileName}`);
    
      registerWithGateway(nip11Info); // Register the new relay with the gateway
      return relayKey;
    } catch (error) {
      console.error('Failed to create relay:', error);
      return null;
    }
  }
  

// Function to join an existing relay
async function joinRelay(relayKey, storageDir = null) {
  if (!RelayManager) {
    console.error('RelayManager module not loaded yet');
    return;
  }
  
  if (!storageDir) {
    storageDir = `relay-storage-${relayKey.substring(0, 8)}`;
  }

  // Ensure the storage directory exists
  try {
    await fs.mkdir(storageDir, { recursive: true });
  } catch (err) {
    console.error(`Error creating directory ${storageDir}:`, err);
    return;
  }

  const relayManager = new RelayManager(storageDir, relayKey, rl);
  await relayManager.initialize();
  activeRelays.set(relayKey, relayManager);
  console.log(`[${new Date().toISOString()}] Joined relay with key: ${relayKey}`);
  registerWithGateway(); // Register the new relay with the gateway
  return relayKey;
}

// Handle commands
async function handleCommand(line) {
    const [command, ...args] = line.trim().split(' ');
  
    try {
      switch (command) {
        case 'create-relay':
          const newRelayKey = await createRelay();
          console.log(`New relay created with key: ${newRelayKey}`);
          rl.prompt();  // Re-prompt after relay creation
          break;
        case 'join-relay':
          if (args.length < 1) {
            console.log('Usage: join-relay <relayKey> [storageDir]');
            break;
          }
          const relayKey = args[0];
          const storageDir = args[1] || null;
          try {
            const joinedRelayKey = await joinRelay(relayKey, storageDir);
            console.log(`Joined relay with key: ${joinedRelayKey}`);
          } catch (error) {
            console.error('Error joining relay:', error.message);
          }
          break;
        default:
          // If it's not a command we handle here, pass it to the active relay
          const currentRelay = Array.from(activeRelays.values())[0];
          if (currentRelay) {
            await currentRelay.handleCommand(line);
          } else {
            console.log('No active relay. Please create or join a relay first.');
          }
          break;
      }
    } catch (error) {
      console.error('Error executing command:', error.message);
    }
    rl.prompt();  // Always re-prompt after handling a command
  }

// Set up readline interface
rl.on('line', async (line) => {
  await handleCommand(line);
  rl.prompt();
}).on('close', () => {
  console.log('Goodbye!');
  process.exit(0);
});

// Start hypertele-server
const hyperteleServer = spawn('hypertele-server', ['-l', PORT, '--seed', seed]);

hyperteleServer.stdout.on('data', (data) => {
  console.log(`[${new Date().toISOString()}] hypertele-server stdout: ${data}`);
  const match = data.toString().match(/hypertele: ([a-f0-9]+)/);
  if (match) {
    publicKey = match[1];
    console.log(`[${new Date().toISOString()}] Got public key: ${publicKey}`);
    registerWithGateway(); // Initial registration
  }
});

hyperteleServer.stderr.on('data', (data) => {
  console.error(`[${new Date().toISOString()}] hypertele-server stderr: ${data}`);
});

hyperteleServer.on('close', (code) => {
  console.log(`[${new Date().toISOString()}] hypertele-server process exited with code ${code}`);
});

// Periodic re-registration
setInterval(registerWithGateway, 5 * 60 * 1000); // Every 5 minutes

    // Start the local web server
    app.listen(PORT, () => {
      console.log(`[${new Date().toISOString()}] Local web server running on port ${PORT}`);
      console.log('Available commands:');
      console.log('  create-relay');
      console.log('  join-relay <relayKey> [storageDir]');
      console.log('  publish <eventJson>');
      console.log('  exit');
      rl.prompt();
    });

  } catch (error) {
    console.error('Error initializing the application:', error);
    process.exit(1);
  }
}

initializeApp();

// Modify the graceful shutdown to also kill the hyperdrive process
process.on('SIGINT', async () => {
  console.log('Gracefully shutting down...');
  for (const relayManager of activeRelays.values()) {
    await relayManager.close();
  }
  if (hyperdriveProcess) {
    hyperdriveProcess.kill();
  }
  hyperteleServer.kill();
  rl.close();
  process.exit(0);
});
