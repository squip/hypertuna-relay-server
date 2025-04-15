# hypertuna-relay-server
a simple p2p NOSTR relay implementation built on the Pear stack

**Note:**

- This module is an ongoing work-in-progress to be used as part of a larger integrated application, but I'd like to make the current proof-of-concept state available to any NOSTR / Pear builders who may be interested. Feel free to fork, provide feedback / improvements, or use in your project if useful.
- the Hypertuna Proxy Server that this module interfaces with is currently optimized for use on a VPS with a registered domain / encryption certs. using this relay server module with a local instance of Hypertuna Proxy Server is currently for experimental use.


**Set-Up:**

1. `git clone https://github.com/squip/hypertuna-relay-server`
2. `npm install`
3. make sure you have the Hypertuna Proxy Server installed and running in a separate terminal
   - follow install / set-up instructions here: https://github.com/squip/hypertuna-proxy-server
5. once proxy server is initialized / running, initialize the Hypertuna Relay Server
   - run `node hypertuna-start-relay-server.mjs` - this will initialize the relay server instance and establish a connection with your Hypertuna Proxy Server.
6. once relay server is initialized / running, the CLI will present 2 main commands:
   - `create-relay` 
   - `join-relay <relayKey>`
7. the `create-relay` command will initialize a new Hypertuna Relay Instance, produce a relayKey and wss url for pointing to your relay instance (i.e. `wss://127.0.0.1:8443/<relayKey>`)
  - the CLI will then prompt the user to enter a name and description for your relay. 
