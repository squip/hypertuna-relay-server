// hypertuna-node.mjs

import express from 'express';
import { spawn } from 'node:child_process';
import axios from 'axios';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'https';
import WebSocket from 'ws';
import { promises as fs } from 'node:fs';
import { createInterface } from 'node:readline';

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load configuration from JSON file
const configFile = process.argv[2];

// Health monitoring state
const healthState = {
    startTime: Date.now(),
    lastCheck: Date.now(),
    status: 'initializing',
    activeRelaysCount: 0,
    metrics: {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        lastMetricsReset: Date.now()
    },
    services: {
        hyperdriveStatus: 'disconnected',
        hyperteleStatus: 'initializing',
        webserver: 'active'
    }
};

function logWithTimestamp(message, data = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
    if (data) {
        console.log(typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
    }
}

async function initializeApp() {
    try {
        logWithTimestamp('Starting application initialization...');
        
        // Initialize health states
        healthState.status = 'initializing';
        healthState.services.webserver = 'active';
        healthState.services.hyperteleStatus = 'initializing';
        healthState.services.hyperdriveStatus = 'disconnected';
        
        // Read and parse config file
        const configData = await fs.readFile(configFile, 'utf8');
        const config = JSON.parse(configData);

        // Extract configuration
        const seed = config.proxy_seed;
        let publicKey = config.derivedPublicKey;
        const gatewayUrl = config.gatewayUrl;

        let activeRelays = new Map();
        let RelayManager, generateRandomPubkey;
        let hyperdriveProcess = null;

        const rl = createInterface({
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

        function updateMetrics(success = true) {
            healthState.metrics.totalRequests++;
            if (success) {
                healthState.metrics.successfulRequests++;
            } else {
                healthState.metrics.failedRequests++;
            }
            
            // Reset metrics every hour
            if (Date.now() - healthState.metrics.lastMetricsReset > 60 * 60 * 1000) {
                healthState.metrics.totalRequests = 0;
                healthState.metrics.successfulRequests = 0;
                healthState.metrics.failedRequests = 0;
                healthState.metrics.lastMetricsReset = Date.now();
            }
        }  

        // Dynamically import the ES module
        try {
            const module = await import('./hypertuna-relay-manager.mjs');
            RelayManager = module.RelayManager;
            generateRandomPubkey = module.generateRandomPubkey;
            logWithTimestamp('RelayManager module loaded successfully');
            rl.prompt();
        } catch (err) {
            logWithTimestamp('Failed to load RelayManager module:', err);
            throw err;
        }

        // Serve static files from 'reader-dir' directory
        app.use(express.static(join(__dirname, 'reader-dir')));

        // Logging middleware
        app.use((req, res, next) => {
            if (req.path === '/') {
                logWithTimestamp('ROOT PATH REQUEST RECEIVED');
            }
            logWithTimestamp(`${req.method} ${req.url}`);
            logWithTimestamp(`Headers: ${JSON.stringify(req.headers)}`);
            next();
        });

        // Metrics tracking middleware
        app.use((req, res, next) => {
            const originalSend = res.send;
            res.send = function(...args) {
                updateMetrics(res.statusCode < 400);
                return originalSend.apply(res, args);
            };
            next();
        });

        // Add periodic health check for internal monitoring
        setInterval(() => {
            const now = Date.now();
            if (now - healthState.lastCheck > 30000) {
                healthState.status = 'warning';
            }
            
            logWithTimestamp('Internal health check:', {
                status: healthState.status,
                activeRelays: healthState.activeRelaysCount,
                services: {
                    hyperdrive: healthState.services.hyperdriveStatus,
                    hypertele: healthState.services.hyperteleStatus,
                    webserver: healthState.services.webserver
                }
            });
        }, 30000);

        // Error handling middleware
        app.use((err, req, res, next) => {
            logWithTimestamp(`Error processing request: ${err.message}`);
            res.status(500).send('Internal Server Error');
        });

        // Add a route handler for the root path
        app.get('/', async (req, res, next) => {
            const indexPath = join(__dirname, 'reader-dir', 'index.html');
            try {
                await fs.access(indexPath);
                res.sendFile(indexPath);
                logWithTimestamp('Serving index.html for root path');
            } catch {
                res.send('Welcome to the Hypertuna Relay Node');
                logWithTimestamp('No index.html found, served default message');
            }
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

        const axiosWithSelfSignedCert = axios.create({
            httpsAgent: new https.Agent({
                rejectUnauthorized: false // Accept self-signed certs
            })
        });
        
        // Register with gateway
        function registerWithGateway(relayProfileInfo = null) {
            if (!publicKey) {
                logWithTimestamp('Public key not available yet. Skipping registration.');
                return;
            }

            logWithTimestamp(`Attempting to register with gateway: ${gatewayUrl}/register`);
            const registrationData = { 
                publicKey,
                relays: Array.from(activeRelays.keys())
            };

            if (relayProfileInfo) {
                registrationData.relayProfileInfo = relayProfileInfo;
            }

            axiosWithSelfSignedCert.post(`${gatewayUrl}/register`, registrationData)
                .then(response => {
                    logWithTimestamp('Registered with gateway. Response:', response.data);
                    if (response.data.driveKey) {
                        logWithTimestamp(`Received drive key: ${response.data.driveKey}`);
                        startHyperdriveProcess(response.data.driveKey);
                    }
                })
                .catch(error => {
                    logWithTimestamp(`Failed to register with gateway: ${error.message}`);
                });
        }

        async function removeDirectory(dir) {
            try {
                await fs.rm(dir, { recursive: true, force: true });
                logWithTimestamp(`Successfully removed directory: ${dir}`);
            } catch (err) {
                logWithTimestamp(`Error removing directory ${dir}:`, err);
            }
        }

        async function startHyperdriveProcess(driveKey) {
            if (hyperdriveProcess) {
                logWithTimestamp('Hyperdrive process already running. Stopping it.');
                hyperdriveProcess.kill();
                healthState.services.hyperdriveStatus = 'restarting';
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            const storageDir = join(__dirname, 'storage-hypertuna-drive');
            await removeDirectory(storageDir);

            logWithTimestamp(`Starting Hyperdrive process with key: ${driveKey}`);
            hyperdriveProcess = spawn('node', ['hypertuna-drive.mjs', driveKey], {
                stdio: ['inherit', 'inherit', 'inherit']
            });

            healthState.services.hyperdriveStatus = 'connected';

            hyperdriveProcess.on('error', (error) => {
                logWithTimestamp(`Failed to start Hyperdrive process: ${error}`);
                healthState.services.hyperdriveStatus = 'error';
            });

            hyperdriveProcess.on('exit', (code, signal) => {
                logWithTimestamp(`Hyperdrive process exited with code ${code} and signal ${signal}`);
                hyperdriveProcess = null;
                healthState.services.hyperdriveStatus = 'disconnected';
            });
        }

        // Health endpoint
        app.get('/health', (req, res) => {
            try {
                const now = Date.now();
                healthState.lastCheck = now;
                healthState.activeRelaysCount = activeRelays.size;
                
                const isCriticalServicesHealthy = 
                    healthState.services.hyperdriveStatus === 'connected' &&
                    healthState.services.hyperteleStatus === 'connected' &&
                    activeRelays.size > 0;
                
                healthState.status = isCriticalServicesHealthy ? 'healthy' : 'degraded';
              
                const healthResponse = {
                    status: healthState.status,
                    uptime: now - healthState.startTime,
                    lastCheck: healthState.lastCheck,
                    activeRelays: {
                        count: healthState.activeRelaysCount,
                        keys: Array.from(activeRelays.keys())
                    },
                    services: {
                        hyperdrive: healthState.services.hyperdriveStatus,
                        hypertele: healthState.services.hyperteleStatus,
                        webserver: healthState.services.webserver
                    },
                    metrics: {
                        ...healthState.metrics,
                        successRate: healthState.metrics.totalRequests === 0 ? 100 : 
                            (healthState.metrics.successfulRequests / healthState.metrics.totalRequests) * 100
                    },
                    timestamp: new Date().toISOString()
                };
              
                updateMetrics(true);
                res.json(healthResponse);
            } catch (error) {
                logWithTimestamp(`Health check error: ${error}`);
                healthState.status = 'error';
                res.status(500).json({
                    status: 'error',
                    message: 'Internal health check failed',
                    timestamp: new Date().toISOString()
                });
            }
        });

        // Function to create a new relay
        async function createRelay(storageDir = null) {
            if (!RelayManager) {
                console.error('RelayManager module not loaded yet');
                return;
            }

            try {
                // Create storage directory if not provided
                if (!storageDir) {
                    storageDir = `./storage-relay-${Math.floor( Date.now() / 1000 )}`;
                }

                await fs.mkdir(storageDir, { recursive: true });

                const relayManager = new RelayManager(storageDir, null, rl);
                await relayManager.initialize();
                
                const relayKey = relayManager.getPublicKey();
                activeRelays.set(relayKey, relayManager);
                logWithTimestamp(`///////////////////////////////////////`);
                logWithTimestamp(`NEW HYPERTUNA RELAY CREATED`);
                logWithTimestamp(`Created new relay with key: ${relayKey}`);
                logWithTimestamp(`Connect to your relay at: wss://${config.proxy_server_address}/${relayKey}`);
                logWithTimestamp(`///////////////////////////////////////`);
                // Prompt for relay profile information
                const relayProfileInfo = {
                    name: await askQuestion(rl, 'Give your relay a name: '),
                    description: await askQuestion(rl, 'Relay description: '),
                    pubkey: config.nostr_pubkey_hex // Use the NOSTR public key from the config file
                };
            
                // Save relay profile to file
                const relayProfileFileName = `relay-profile-${relayKey}.json`;
                await fs.writeFile(relayProfileFileName, JSON.stringify(relayProfileInfo, null, 2));
                logWithTimestamp(`Relay profile information saved to ${relayProfileFileName}`);
            
                registerWithGateway(relayProfileInfo);
                return relayKey;
            } catch (error) {
                logWithTimestamp(`Failed to create relay: ${error}`);
                return null;
            }
        }

        // Function to join an existing relay
        async function joinRelay(relayKey, storageDir = null) {
            if (!RelayManager) {
                logWithTimestamp('RelayManager module not loaded yet');
                return;
            }
            
            if (!storageDir) {
                storageDir = `relay-storage-${relayKey.substring(0, 8)}`;
            }

            // Ensure the storage directory exists
            try {
                await fs.mkdir(storageDir, { recursive: true });
            } catch (err) {
                logWithTimestamp(`Error creating directory ${storageDir}: ${err}`);
                return;
            }

            try {
                const relayManager = new RelayManager(storageDir, relayKey, rl);
                await relayManager.initialize();
                activeRelays.set(relayKey, relayManager);
                logWithTimestamp(`Joined relay with key: ${relayKey}`);
                registerWithGateway();
                return relayKey;
            } catch (error) {
                logWithTimestamp(`Error joining relay: ${error}`);
                throw error;
            }
        }

        // Handle commands
        async function handleCommand(line) {
            const [command, ...args] = line.trim().split(' ');

            try {
                switch (command) {
                    case 'create-relay':
                        const newRelayKey = await createRelay();
                        console.log(`New relay created with key: ${newRelayKey}`);
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
                    case 'list-relays':
                        console.log('Active relays:');
                        for (const [key, relay] of activeRelays.entries()) {
                            console.log(`- ${key}`);
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
            rl.prompt();
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
        logWithTimestamp(`Starting hypertele-server with seed: ${seed}`);
        const hyperteleServer = spawn('hypertele-server', ['-l', PORT, '--seed', seed]);

        hyperteleServer.stdout.on('data', (data) => {
            logWithTimestamp(`hypertele-server stdout: ${data}`);
            const match = data.toString().match(/hypertele: ([a-f0-9]+)/);
            if (match) {
                publicKey = match[1];
                logWithTimestamp(`Got public key: ${publicKey}`);
                healthState.services.hyperteleStatus = 'connected';
                registerWithGateway();
            }
        });

        hyperteleServer.stderr.on('data', (data) => {
            logWithTimestamp(`hypertele-server stderr: ${data}`);
            if (data.toString().toLowerCase().includes('error')) {
                healthState.services.hyperteleStatus = 'error';
            }
        });

        hyperteleServer.on('close', (code) => {
            logWithTimestamp(`hypertele-server process exited with code ${code}`);
            healthState.services.hyperteleStatus = 'disconnected';
        });

        // Periodic re-registration
        setInterval(registerWithGateway, 5 * 60 * 1000); // Every 5 minutes

        // Start the local web server
        app.listen(PORT, () => {
            logWithTimestamp(`Local web server running on port ${PORT}`);
            console.log('Available commands:');
            console.log('  create-relay                 - Create a new relay');
            console.log('  join-relay <relayKey> [dir]  - Join an existing relay');
            console.log('  list-relays                  - List active relays');
            console.log('  exit                         - Exit the application');
            rl.prompt();
        });

    } catch (error) {
        console.error('Error initializing the application:', error);
        process.exit(1);
    }
}

// Start the application
initializeApp();

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Gracefully shutting down...');
    
    for (const [key, relayManager] of activeRelays.entries()) {
        try {
            await relayManager.close();
            console.log(`Closed relay: ${key}`);
        } catch (error) {
            console.error(`Error closing relay ${key}:`, error);
        }
    }
    
    if (hyperdriveProcess) {
        hyperdriveProcess.kill();
        console.log('Terminated hyperdrive process');
    }
    
    hyperteleServer.kill();
    console.log('Terminated hypertele server');
    
    rl.close();
    process.exit(0);
});
