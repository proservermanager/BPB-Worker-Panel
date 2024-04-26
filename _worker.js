// @ts-nocheck
// <!--GAMFC-->version base on commit 43fad05dcdae3b723c53c226f8181fc5bd47223e, time is 2023-06-22 15:20:02 UTC<!--GAMFC-END-->.
// @ts-ignore
// https://github.com/bia-pain-bache/BPB-Worker-Panel

import { connect } from 'cloudflare:sockets';

// How to generate your own UUID:
// https://www.uuidgenerator.net/
let userID = '89b3cbba-e6ac-485a-9481-976a0415eab9';

// https://www.nslookup.io/domains/cdn.xn--b6gac.eu.org/dns-records/
// https://www.nslookup.io/domains/cdn-all.xn--b6gac.eu.org/dns-records/
const proxyIPs= ['cdn.xn--b6gac.eu.org', 'cdn-all.xn--b6gac.eu.org', 'edgetunnel.anycast.eu.org'];

let proxyIP = proxyIPs[Math.floor(Math.random() * proxyIPs.length)];

let dohURL = 'https://cloudflare-dns.com/dns-query';

let panelVersion = '';

if (!isValidUUID(userID)) {
    throw new Error('uuid is not valid');
}

export default {
    /**
     * @param {import("@cloudflare/workers-types").Request} request
     * @param {{UUID: string, PROXYIP: string, DNS_RESOLVER_URL: string}} env
     * @param {import("@cloudflare/workers-types").ExecutionContext} ctx
     * @returns {Promise<Response>}
     */
    async fetch(request, env, ctx) {
        try {
            
            userID = env.UUID || userID;
            proxyIP = env.PROXYIP || proxyIP;
            dohURL = env.DNS_RESOLVER_URL || dohURL;
            const upgradeHeader = request.headers.get('Upgrade');
            
            if (!upgradeHeader || upgradeHeader !== 'websocket') {
                
                const url = new URL(request.url);
                const searchParams = new URLSearchParams(url.search);
                const host = request.headers.get('Host');
                const client = searchParams.get('app');

                switch (url.pathname) {

                    case '/cf':
                        return new Response(JSON.stringify(request.cf, null, 4), {
                            status: 200,
                            headers: {
                                'Content-Type': 'application/json;charset=utf-8',
                            },
                        });
                        
                    case `/sub/${userID}`:

                        if (client === 'sfa') {
                            const BestPingSFA = await getSingboxConfig(env, host);
                            return new Response(`${JSON.stringify(BestPingSFA, null, 4)}`, { status: 200 });                            
                        }
                        const normalConfigs = await getNormalConfigs(env, host, client);
                        return new Response(normalConfigs, { status: 200 });                        

                    case `/fragsub/${userID}`:

                        let fragConfigs = await getFragmentConfigs(env, host, 'v2ray');
                        fragConfigs = fragConfigs.map(config => config.config);

                        return new Response(`${JSON.stringify(fragConfigs, null, 4)}`, { status: 200 });

                    case '/panel':

                        if (!env.bpb) {
                            const errorPage = renderErrorPage('KV Dataset is not properly set!');
                            return new Response(errorPage, { status: 200, headers: {'Content-Type': 'text/html'}});
                        }

                        if (request.method === 'POST') {    

                            if (!(await Authenticate(request, env))) {                            
                                return new Response('Unauthorized', { status: 401 });  
                            }
                            
                            const formData = await request.formData();
                            await updateDataset(env, formData);

                            return new Response('Success', { status: 200 });
                        }
                            

                        if (!(await Authenticate(request, env))) {
                            return Response.redirect(`${url.origin}/login`, 302);        
                        }

                        if (! await env.bpb.get('proxySettings')) {
                            await updateDataset(env);
                        }

                        const fragConfs = await getFragmentConfigs(env, host, 'nekoray');                        
                        const htmlPage = await renderHomePage(env, host, fragConfs);

                        return new Response(htmlPage, {
                            status: 200,
                            headers: {
                                'Content-Type': 'text/html',
                                'Access-Control-Allow-Origin': url.origin,
                                'Access-Control-Allow-Methods': 'GET, POST',
                                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                                'X-Content-Type-Options': 'nosniff',
                                'X-Frame-Options': 'DENY',
                                'Referrer-Policy': 'strict-origin-when-cross-origin'
                            }
                        });
                                                      
                    case '/login':

                        if (!env.bpb) {
                            const errorPage = renderErrorPage('KV Dataset is not properly set!');
                            return new Response(errorPage, { status: 200, headers: {'Content-Type': 'text/html'}});
                        }

                        if (await Authenticate(request, env)) {
                            return Response.redirect(`${url.origin}/panel`, 302);       
                        }

                        let secretKey = await env.bpb.get('secretKey');
                        let pwd = await env.bpb.get('pwd');


                        if (!pwd) {
                            await env.bpb.put('pwd', 'admin');
                        }

                        if (!secretKey) {
                            secretKey = generateSecretKey();
                            await env.bpb.put('secretKey', secretKey);
                        }


                        if (request.method === 'POST') {
                            const password = await request.text();
                            const savedPass = await env.bpb.get('pwd');

                            if (password === savedPass) {
                                const jwtToken = generateJWTToken(secretKey, password);
                                const cookieHeader = `jwtToken=${jwtToken}; HttpOnly; Secure; Max-Age=${7 * 24 * 60 * 60}; Path=/; SameSite=Strict`;
                                
                                return new Response('Success', {
                                    status: 200,
                                    headers: {
                                      'Set-Cookie': cookieHeader,
                                      'Content-Type': 'text/plain',
                                    }
                                });        
                            } else {
                                return new Response('Method Not Allowed', { status: 405 });
                            }
                        }
                        
                        const loginPage = await renderLoginPage();

                        return new Response(loginPage, {
                            status: 200,
                            headers: {
                                'Content-Type': 'text/html',
                                'Access-Control-Allow-Origin': url.origin,
                                'Access-Control-Allow-Methods': 'GET, POST',
                                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                                'X-Content-Type-Options': 'nosniff',
                                'X-Frame-Options': 'DENY',
                                'Referrer-Policy': 'strict-origin-when-cross-origin'
                            }
                        });
                    
                    case '/logout':
                                    
                        return new Response('Success', {
                            status: 200,
                            headers: {
                                'Set-Cookie': 'jwtToken=; Secure; SameSite=None; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
                                'Content-Type': 'text/plain'
                            }
                        });        

                    case '/panel/password':

                        if (!(await Authenticate(request, env))) {                            
                            return new Response('Unauthorized!', { status: 401 });  
                        }
                        
                        const newPwd = await request.text();
                        const oldPwd = await env.bpb.get('pwd');

                        if (newPwd === oldPwd) {
                            return new Response('Please enter a new Password!', { status: 400 });
                        }

                        await env.bpb.put('pwd', newPwd);

                        return new Response('Success', {
                            status: 200,
                            headers: {
                                'Set-Cookie': 'jwtToken=; Path=/; Secure; SameSite=None; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
                                'Content-Type': 'text/plain',
                            }
                        });

                    default:
                        // return new Response('Not found', { status: 404 });
                        // For any other path, reverse proxy to 'www.fmprc.gov.cn' and return the original response
                        url.hostname = 'www.speedtest.net';
                        url.protocol = 'https:';
                        request = new Request(url, request);
                        return await fetch(request);
                }
            } else {
                return await vlessOverWSHandler(request);
            }
        } catch (err) {
            /** @type {Error} */ let e = err;
            const errorPage = renderErrorPage('Something went wrong!', e.toString());
            return new Response(errorPage, { status: 200, headers: {'Content-Type': 'text/html'}});
        }
    },
};

/**
 * Handles VLESS over WebSocket requests by creating a WebSocket pair, accepting the WebSocket connection, and processing the VLESS header.
 * @param {import("@cloudflare/workers-types").Request} request The incoming request object.
 * @returns {Promise<Response>} A Promise that resolves to a WebSocket response object.
 */
async function vlessOverWSHandler(request) {
	const webSocketPair = new WebSocketPair();
	const [client, webSocket] = Object.values(webSocketPair);
	webSocket.accept();

	let address = '';
	let portWithRandomLog = '';
	let currentDate = new Date();
	const log = (/** @type {string} */ info, /** @type {string | undefined} */ event) => {
		console.log(`[${currentDate} ${address}:${portWithRandomLog}] ${info}`, event || '');
	};
	const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';

	const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

	/** @type {{ value: import("@cloudflare/workers-types").Socket | null}}*/
	let remoteSocketWapper = {
		value: null,
	};
	let udpStreamWrite = null;
	let isDns = false;

	// ws --> remote
	readableWebSocketStream.pipeTo(new WritableStream({
		async write(chunk, controller) {
			if (isDns && udpStreamWrite) {
				return udpStreamWrite(chunk);
			}
			if (remoteSocketWapper.value) {
				const writer = remoteSocketWapper.value.writable.getWriter()
				await writer.write(chunk);
				writer.releaseLock();
				return;
			}

			const {
				hasError,
				message,
				portRemote = 443,
				addressRemote = '',
				rawDataIndex,
				vlessVersion = new Uint8Array([0, 0]),
				isUDP,
			} = processVlessHeader(chunk, userID);
			address = addressRemote;
			portWithRandomLog = `${portRemote} ${isUDP ? 'udp' : 'tcp'} `;
			if (hasError) {
				// controller.error(message);
				throw new Error(message); // cf seems has bug, controller.error will not end stream
				// webSocket.close(1000, message);
				return;
			}

			// If UDP and not DNS port, close it
			if (isUDP && portRemote !== 53) {
				throw new Error('UDP proxy only enabled for DNS which is port 53');
				// cf seems has bug, controller.error will not end stream
			}

			if (isUDP && portRemote === 53) {
				isDns = true;
			}

			// ["version", "附加信息长度 N"]
			const vlessResponseHeader = new Uint8Array([vlessVersion[0], 0]);
			const rawClientData = chunk.slice(rawDataIndex);

			// TODO: support udp here when cf runtime has udp support
			if (isDns) {
				const { write } = await handleUDPOutBound(webSocket, vlessResponseHeader, log);
				udpStreamWrite = write;
				udpStreamWrite(rawClientData);
				return;
			}
			handleTCPOutBound(remoteSocketWapper, addressRemote, portRemote, rawClientData, webSocket, vlessResponseHeader, log);
		},
		close() {
			log(`readableWebSocketStream is close`);
		},
		abort(reason) {
			log(`readableWebSocketStream is abort`, JSON.stringify(reason));
		},
	})).catch((err) => {
		log('readableWebSocketStream pipeTo error', err);
	});

	return new Response(null, {
		status: 101,
		webSocket: client,
	});
}

/**
 * Handles outbound TCP connections.
 *
 * @param {any} remoteSocket 
 * @param {string} addressRemote The remote address to connect to.
 * @param {number} portRemote The remote port to connect to.
 * @param {Uint8Array} rawClientData The raw client data to write.
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket The WebSocket to pass the remote socket to.
 * @param {Uint8Array} vlessResponseHeader The VLESS response header.
 * @param {function} log The logging function.
 * @returns {Promise<void>} The remote socket.
 */
async function handleTCPOutBound(remoteSocket, addressRemote, portRemote, rawClientData, webSocket, vlessResponseHeader, log,) {

	/**
	 * Connects to a given address and port and writes data to the socket.
	 * @param {string} address The address to connect to.
	 * @param {number} port The port to connect to.
	 * @returns {Promise<import("@cloudflare/workers-types").Socket>} A Promise that resolves to the connected socket.
	 */
	async function connectAndWrite(address, port) {
		/** @type {import("@cloudflare/workers-types").Socket} */
		const tcpSocket = connect({
			hostname: address,
			port: port,
		});
		remoteSocket.value = tcpSocket;
		log(`connected to ${address}:${port}`);
		const writer = tcpSocket.writable.getWriter();
		await writer.write(rawClientData); // first write, nomal is tls client hello
		writer.releaseLock();
		return tcpSocket;
	}

	/**
	 * Retries connecting to the remote address and port if the Cloudflare socket has no incoming data.
	 * @returns {Promise<void>} A Promise that resolves when the retry is complete.
	 */
	async function retry() {
		const tcpSocket = await connectAndWrite(proxyIP || addressRemote, portRemote)
		tcpSocket.closed.catch(error => {
			console.log('retry tcpSocket closed error', error);
		}).finally(() => {
			safeCloseWebSocket(webSocket);
		})
		remoteSocketToWS(tcpSocket, webSocket, vlessResponseHeader, null, log);
	}

	const tcpSocket = await connectAndWrite(addressRemote, portRemote);

	// when remoteSocket is ready, pass to websocket
	// remote--> ws
	remoteSocketToWS(tcpSocket, webSocket, vlessResponseHeader, retry, log);
}

/**
 * Creates a readable stream from a WebSocket server, allowing for data to be read from the WebSocket.
 * @param {import("@cloudflare/workers-types").WebSocket} webSocketServer The WebSocket server to create the readable stream from.
 * @param {string} earlyDataHeader The header containing early data for WebSocket 0-RTT.
 * @param {(info: string)=> void} log The logging function.
 * @returns {ReadableStream} A readable stream that can be used to read data from the WebSocket.
 */
function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
	let readableStreamCancel = false;
	const stream = new ReadableStream({
		start(controller) {
			webSocketServer.addEventListener('message', (event) => {
				const message = event.data;
				controller.enqueue(message);
			});

			webSocketServer.addEventListener('close', () => {
				safeCloseWebSocket(webSocketServer);
				controller.close();
			});

			webSocketServer.addEventListener('error', (err) => {
				log('webSocketServer has error');
				controller.error(err);
			});
			const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
			if (error) {
				controller.error(error);
			} else if (earlyData) {
				controller.enqueue(earlyData);
			}
		},

		pull(controller) {
			// if ws can stop read if stream is full, we can implement backpressure
			// https://streams.spec.whatwg.org/#example-rs-push-backpressure
		},

		cancel(reason) {
			log(`ReadableStream was canceled, due to ${reason}`)
			readableStreamCancel = true;
			safeCloseWebSocket(webSocketServer);
		}
	});

	return stream;
}

// https://xtls.github.io/development/protocols/vless.html
// https://github.com/zizifn/excalidraw-backup/blob/main/v2ray-protocol.excalidraw

/**
 * Processes the VLESS header buffer and returns an object with the relevant information.
 * @param {ArrayBuffer} vlessBuffer The VLESS header buffer to process.
 * @param {string} userID The user ID to validate against the UUID in the VLESS header.
 * @returns {{
 *  hasError: boolean,
 *  message?: string,
 *  addressRemote?: string,
 *  addressType?: number,
 *  portRemote?: number,
 *  rawDataIndex?: number,
 *  vlessVersion?: Uint8Array,
 *  isUDP?: boolean
 * }} An object with the relevant information extracted from the VLESS header buffer.
 */
function processVlessHeader(vlessBuffer, userID) {
	if (vlessBuffer.byteLength < 24) {
		return {
			hasError: true,
			message: 'invalid data',
		};
	}

	const version = new Uint8Array(vlessBuffer.slice(0, 1));
	let isValidUser = false;
	let isUDP = false;
	const slicedBuffer = new Uint8Array(vlessBuffer.slice(1, 17));
	const slicedBufferString = stringify(slicedBuffer);
	// check if userID is valid uuid or uuids split by , and contains userID in it otherwise return error message to console
	const uuids = userID.includes(',') ? userID.split(",") : [userID];
	// uuid_validator(hostName, slicedBufferString);


	// isValidUser = uuids.some(userUuid => slicedBufferString === userUuid.trim());
	isValidUser = uuids.some(userUuid => slicedBufferString === userUuid.trim()) || uuids.length === 1 && slicedBufferString === uuids[0].trim();

	console.log(`userID: ${slicedBufferString}`);

	if (!isValidUser) {
		return {
			hasError: true,
			message: 'invalid user',
		};
	}

	const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0];
	//skip opt for now

	const command = new Uint8Array(
		vlessBuffer.slice(18 + optLength, 18 + optLength + 1)
	)[0];

	// 0x01 TCP
	// 0x02 UDP
	// 0x03 MUX
	if (command === 1) {
		isUDP = false;
	} else if (command === 2) {
		isUDP = true;
	} else {
		return {
			hasError: true,
			message: `command ${command} is not support, command 01-tcp,02-udp,03-mux`,
		};
	}
	const portIndex = 18 + optLength + 1;
	const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2);
	// port is big-Endian in raw data etc 80 == 0x005d
	const portRemote = new DataView(portBuffer).getUint16(0);

	let addressIndex = portIndex + 2;
	const addressBuffer = new Uint8Array(
		vlessBuffer.slice(addressIndex, addressIndex + 1)
	);

	// 1--> ipv4  addressLength =4
	// 2--> domain name addressLength=addressBuffer[1]
	// 3--> ipv6  addressLength =16
	const addressType = addressBuffer[0];
	let addressLength = 0;
	let addressValueIndex = addressIndex + 1;
	let addressValue = '';
	switch (addressType) {
		case 1:
			addressLength = 4;
			addressValue = new Uint8Array(
				vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
			).join('.');
			break;
		case 2:
			addressLength = new Uint8Array(
				vlessBuffer.slice(addressValueIndex, addressValueIndex + 1)
			)[0];
			addressValueIndex += 1;
			addressValue = new TextDecoder().decode(
				vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
			);
			break;
		case 3:
			addressLength = 16;
			const dataView = new DataView(
				vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
			);
			// 2001:0db8:85a3:0000:0000:8a2e:0370:7334
			const ipv6 = [];
			for (let i = 0; i < 8; i++) {
				ipv6.push(dataView.getUint16(i * 2).toString(16));
			}
			addressValue = ipv6.join(':');
			// seems no need add [] for ipv6
			break;
		default:
			return {
				hasError: true,
				message: `invild  addressType is ${addressType}`,
			};
	}
	if (!addressValue) {
		return {
			hasError: true,
			message: `addressValue is empty, addressType is ${addressType}`,
		};
	}

	return {
		hasError: false,
		addressRemote: addressValue,
		addressType,
		portRemote,
		rawDataIndex: addressValueIndex + addressLength,
		vlessVersion: version,
		isUDP,
	};
}


/**
 * Converts a remote socket to a WebSocket connection.
 * @param {import("@cloudflare/workers-types").Socket} remoteSocket The remote socket to convert.
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket The WebSocket to connect to.
 * @param {ArrayBuffer | null} vlessResponseHeader The VLESS response header.
 * @param {(() => Promise<void>) | null} retry The function to retry the connection if it fails.
 * @param {(info: string) => void} log The logging function.
 * @returns {Promise<void>} A Promise that resolves when the conversion is complete.
 */
async function remoteSocketToWS(remoteSocket, webSocket, vlessResponseHeader, retry, log) {
	// remote--> ws
	let remoteChunkCount = 0;
	let chunks = [];
	/** @type {ArrayBuffer | null} */
	let vlessHeader = vlessResponseHeader;
	let hasIncomingData = false; // check if remoteSocket has incoming data
	await remoteSocket.readable
		.pipeTo(
			new WritableStream({
				start() {
				},
				/**
				 * 
				 * @param {Uint8Array} chunk 
				 * @param {*} controller 
				 */
				async write(chunk, controller) {
					hasIncomingData = true;
					remoteChunkCount++;
					if (webSocket.readyState !== WS_READY_STATE_OPEN) {
						controller.error(
							'webSocket.readyState is not open, maybe close'
						);
					}
					if (vlessHeader) {
						webSocket.send(await new Blob([vlessHeader, chunk]).arrayBuffer());
						vlessHeader = null;
					} else {
						// console.log(`remoteSocketToWS send chunk ${chunk.byteLength}`);
						// seems no need rate limit this, CF seems fix this??..
						// if (remoteChunkCount > 20000) {
						// 	// cf one package is 4096 byte(4kb),  4096 * 20000 = 80M
						// 	await delay(1);
						// }
						webSocket.send(chunk);
					}
				},
				close() {
					log(`remoteConnection!.readable is close with hasIncomingData is ${hasIncomingData}`);
					// safeCloseWebSocket(webSocket); // no need server close websocket frist for some case will casue HTTP ERR_CONTENT_LENGTH_MISMATCH issue, client will send close event anyway.
				},
				abort(reason) {
					console.error(`remoteConnection!.readable abort`, reason);
				},
			})
		)
		.catch((error) => {
			console.error(
				`remoteSocketToWS has exception `,
				error.stack || error
			);
			safeCloseWebSocket(webSocket);
		});

	// seems is cf connect socket have error,
	// 1. Socket.closed will have error
	// 2. Socket.readable will be close without any data coming
	if (hasIncomingData === false && retry) {
		log(`retry`)
		retry();
	}
}

/**
 * Decodes a base64 string into an ArrayBuffer.
 * @param {string} base64Str The base64 string to decode.
 * @returns {{earlyData: ArrayBuffer|null, error: Error|null}} An object containing the decoded ArrayBuffer or null if there was an error, and any error that occurred during decoding or null if there was no error.
 */
function base64ToArrayBuffer(base64Str) {
	if (!base64Str) {
		return { earlyData: null, error: null };
	}
	try {
		// go use modified Base64 for URL rfc4648 which js atob not support
		base64Str = base64Str.replace(/-/g, '+').replace(/_/g, '/');
		const decode = atob(base64Str);
		const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
		return { earlyData: arryBuffer.buffer, error: null };
	} catch (error) {
		return { earlyData: null, error };
	}
}

/**
 * Checks if a given string is a valid UUID.
 * Note: This is not a real UUID validation.
 * @param {string} uuid The string to validate as a UUID.
 * @returns {boolean} True if the string is a valid UUID, false otherwise.
 */
function isValidUUID(uuid) {
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	return uuidRegex.test(uuid);
}

const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
/**
 * Closes a WebSocket connection safely without throwing exceptions.
 * @param {import("@cloudflare/workers-types").WebSocket} socket The WebSocket connection to close.
 */
function safeCloseWebSocket(socket) {
	try {
		if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
			socket.close();
		}
	} catch (error) {
		console.error('safeCloseWebSocket error', error);
	}
}

const byteToHex = [];

for (let i = 0; i < 256; ++i) {
	byteToHex.push((i + 256).toString(16).slice(1));
}

function unsafeStringify(arr, offset = 0) {
	return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}

function stringify(arr, offset = 0) {
	const uuid = unsafeStringify(arr, offset);
	if (!isValidUUID(uuid)) {
		throw TypeError("Stringified UUID is invalid");
	}
	return uuid;
}


/**
 * Handles outbound UDP traffic by transforming the data into DNS queries and sending them over a WebSocket connection.
 * @param {import("@cloudflare/workers-types").WebSocket} webSocket The WebSocket connection to send the DNS queries over.
 * @param {ArrayBuffer} vlessResponseHeader The VLESS response header.
 * @param {(string) => void} log The logging function.
 * @returns {{write: (chunk: Uint8Array) => void}} An object with a write method that accepts a Uint8Array chunk to write to the transform stream.
 */
async function handleUDPOutBound(webSocket, vlessResponseHeader, log) {

	let isVlessHeaderSent = false;
	const transformStream = new TransformStream({
		start(controller) {

		},
		transform(chunk, controller) {
			// udp message 2 byte is the the length of udp data
			// TODO: this should have bug, beacsue maybe udp chunk can be in two websocket message
			for (let index = 0; index < chunk.byteLength;) {
				const lengthBuffer = chunk.slice(index, index + 2);
				const udpPakcetLength = new DataView(lengthBuffer).getUint16(0);
				const udpData = new Uint8Array(
					chunk.slice(index + 2, index + 2 + udpPakcetLength)
				);
				index = index + 2 + udpPakcetLength;
				controller.enqueue(udpData);
			}
		},
		flush(controller) {
		}
	});

	// only handle dns udp for now
	transformStream.readable.pipeTo(new WritableStream({
		async write(chunk) {
			const resp = await fetch(dohURL, // dns server url
				{
					method: 'POST',
					headers: {
						'content-type': 'application/dns-message',
					},
					body: chunk,
				})
			const dnsQueryResult = await resp.arrayBuffer();
			const udpSize = dnsQueryResult.byteLength;
			// console.log([...new Uint8Array(dnsQueryResult)].map((x) => x.toString(16)));
			const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff]);
			if (webSocket.readyState === WS_READY_STATE_OPEN) {
				log(`doh success and dns message length is ${udpSize}`);
				if (isVlessHeaderSent) {
					webSocket.send(await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer());
				} else {
					webSocket.send(await new Blob([vlessResponseHeader, udpSizeBuffer, dnsQueryResult]).arrayBuffer());
					isVlessHeaderSent = true;
				}
			}
		}
	})).catch((error) => {
		log('dns udp has error' + error)
	});

	const writer = transformStream.writable.getWriter();

	return {
		/**
		 * 
		 * @param {Uint8Array} chunk 
		 */
		write(chunk) {
			writer.write(chunk);
		}
	};
}

/**
 *
 * @param {string} userID
 * @param {string | null} hostName
 * @returns {string}
 */

const getNormalConfigs = async (env, hostName, client) => {
    let vlessWsTls = '';
    const { cleanIPs } = await env.bpb.get("proxySettings", {type: 'json'});
    const resolved = await resolveDNS(hostName);
    const Addresses = [
        hostName,
        'www.speedtest.net',
        ...(cleanIPs ? cleanIPs.split(',') : []),
        ...resolved.ipv4,
        ...resolved.ipv6.map((ip) => `[${ip}]`),
    ];

    Addresses.forEach((addr) => {
        let remark = `⭐️ ${addr}`;
        remark = remark.length <= 30 ? remark : `${remark.slice(0,29)}...`;

        vlessWsTls += 'vless' + `://${userID}@${addr}:443?encryption=none&security=tls&type=ws&host=${
            randomUpperCase(hostName)
        }&sni=${
            randomUpperCase(hostName)
        }&fp=randomized&alpn=http/1.1&path=${
            encodeURIComponent(`/${getRandomPath(16)}?ed=2560`)
        }#${encodeURIComponent(remark)}\n`;
    });

    const subscription = client === 'singbox' ? btoa(vlessWsTls) : btoa(vlessWsTls.replaceAll('http/1.1', 'h2,http/1.1'));
    return subscription;
}

const extractVlessParams = async (vlessConfig) => {
    const url = new URL(vlessConfig.replace('vless', 'http'));
    const params = new URLSearchParams(url.search);
    let configParams = {
        uuid : url.username,
        hostName : url.hostname,
        port : url.port
    };

    params.forEach( (value, key) => {
        configParams[key] = value;
    })

    return JSON.stringify(configParams);
}

const buildProxyOutbound = async (proxyParams) => {
    const { hostName, port, uuid, flow, security, type, sni, fp, alpn, pbk, sid, spx, headerType, host, path, authority, serviceName, mode } = proxyParams;
    let proxyOutbound = structuredClone(xrayOutboundTemp);   
    proxyOutbound.settings.vnext[0].address = hostName;
    proxyOutbound.settings.vnext[0].port = +port;
    proxyOutbound.settings.vnext[0].users[0].id = uuid;
    proxyOutbound.settings.vnext[0].users[0].flow = flow;
    proxyOutbound.streamSettings.security = security;
    proxyOutbound.streamSettings.network = type;
    proxyOutbound.tag = "out";
    proxyOutbound.streamSettings.sockopt.dialerProxy = "proxy";

    switch (security) {

        case 'tls':
            proxyOutbound.streamSettings.tlsSettings.serverName = sni;
            proxyOutbound.streamSettings.tlsSettings.fingerprint = fp;
            proxyOutbound.streamSettings.tlsSettings.alpn = alpn ? alpn?.split(',') : [];
            delete proxyOutbound.streamSettings.realitySettings;         
            break;

        case 'reality':
            proxyOutbound.streamSettings.realitySettings.publicKey = pbk;
            proxyOutbound.streamSettings.realitySettings.shortId = sid;
            proxyOutbound.streamSettings.realitySettings.serverName = sni;
            proxyOutbound.streamSettings.realitySettings.fingerprint = fp;
            proxyOutbound.streamSettings.realitySettings.spiderX = spx;
            delete proxyOutbound.mux;
            delete proxyOutbound.streamSettings.tlsSettings;
            break;

        default:
            delete proxyOutbound.streamSettings.tlsSettings;
            delete proxyOutbound.streamSettings.realitySettings;         
            break;
    }
 
    switch (type) {

        case 'tcp':
            delete proxyOutbound.streamSettings.grpcSettings;
            delete proxyOutbound.streamSettings.wsSettings;
            
            if (security === 'reality' && !headerType) {
                delete proxyOutbound.streamSettings.tcpSettings;
                break;
            }

            if (headerType === 'http') {
                proxyOutbound.streamSettings.tcpSettings.header.request.headers.Host = host?.split(',');
                proxyOutbound.streamSettings.tcpSettings.header.request.path = path?.split(',');
            } 
            
            if (!headerType) {
                proxyOutbound.streamSettings.tcpSettings.header.type = 'none';
                delete proxyOutbound.streamSettings.tcpSettings.header.request;
                delete proxyOutbound.streamSettings.tcpSettings.header.response;
            }
            
            break;

        case 'ws':
            
            proxyOutbound.streamSettings.wsSettings.headers.Host = host;
            proxyOutbound.streamSettings.wsSettings.path = path;
            delete proxyOutbound.streamSettings.grpcSettings;
            delete proxyOutbound.streamSettings.tcpSettings;
            break;

        case 'grpc':
            
            proxyOutbound.streamSettings.grpcSettings.authority = authority;
            proxyOutbound.streamSettings.grpcSettings.serviceName = serviceName;
            proxyOutbound.streamSettings.grpcSettings.multiMode = mode === 'multi';
            delete proxyOutbound.mux;
            delete proxyOutbound.streamSettings.tcpSettings;
            delete proxyOutbound.streamSettings.wsSettings;
            break;

        default:
            break;
    }
    
    return proxyOutbound;
}

const buildWorkerLessConfig = async (env, client) => {
    let proxySettings = await env.bpb.get("proxySettings", {type: 'json'});
    const { remoteDNS, lengthMin,  lengthMax,  intervalMin,  intervalMax, blockAds } = proxySettings;
    
    let fakeOutbound = structuredClone(xrayOutboundTemp);
    delete fakeOutbound.mux;
    fakeOutbound.settings.vnext[0].address = 'google.com';
    fakeOutbound.settings.vnext[0].users[0].id = userID;
    delete fakeOutbound.streamSettings.sockopt;
    fakeOutbound.streamSettings.tlsSettings.serverName = 'google.com';
    fakeOutbound.streamSettings.wsSettings.headers.Host = 'google.com';
    fakeOutbound.streamSettings.wsSettings.path = '/?ed=2560';
    delete fakeOutbound.streamSettings.grpcSettings;
    delete fakeOutbound.streamSettings.tcpSettings;
    delete fakeOutbound.streamSettings.realitySettings;
    fakeOutbound.tag = 'fake-outbound';

    let fragConfig = structuredClone(xrayConfigTemp);
    fragConfig.remarks  = 'WorkerLess'
    fragConfig.dns.servers[0] = remoteDNS;
    fragConfig.dns.servers.pop();
    fragConfig.outbounds[0].settings.domainStrategy = 'UseIP';
    fragConfig.outbounds[0].settings.fragment.length = `${lengthMin}-${lengthMax}`;
    fragConfig.outbounds[0].settings.fragment.interval = `${intervalMin}-${intervalMax}`;
    fragConfig.outbounds = [{...fragConfig.outbounds[0]}, {...fakeOutbound}, {...fragConfig.outbounds[1]}, {...fragConfig.outbounds[2]}];
    fragConfig.routing.rules.pop();
    if (!blockAds) {
        delete fragConfig.dns.hosts;
        fragConfig.routing.rules.pop();
    }
    fragConfig.routing.rules[1].domain = ["domain:.ir"];
    fragConfig.routing.rules.shift();
    delete fragConfig.routing.balancers;
    delete fragConfig.observatory;

    if (client === 'nekoray') {
        fragConfig.inbounds[0].port = 2080;
        fragConfig.inbounds[1].port = 2081;
    }

    return fragConfig;
}

const getFragmentConfigs = async (env, hostName, client) => {
    let Configs = [];
    let outbounds = [];
    let proxySettings = await env.bpb.get("proxySettings", {type: 'json'});
    const {
        remoteDNS, 
        localDNS, 
        lengthMin, 
        lengthMax, 
        intervalMin, 
        intervalMax,
        blockAds,
        bypassIran, 
        cleanIPs,
        outProxy,
        outProxyParams
    } = proxySettings;

    let proxyOutbound;
    const resolved = await resolveDNS(hostName);
    const Addresses = [
        hostName,
        "www.speedtest.net",
        ...(cleanIPs ? cleanIPs.split(",") : []),
        ...resolved.ipv4,
        ...resolved.ipv6.map((ip) => `[${ip}]`),
    ];

    if (outProxy) {
        const proxyParams = JSON.parse(outProxyParams);
        try {
            proxyOutbound = await buildProxyOutbound(proxyParams);
        } catch (error) {
            console.log(error);
            proxyOutbound = undefined;
            await env.bpb.put("proxySettings", JSON.stringify({
                ...proxySettings, 
                outProxy: '',
                outProxyParams: ''}));
        }
    }

    Addresses.forEach((addr, index) => {

        let fragConfig = structuredClone(xrayConfigTemp);
        let outbound = structuredClone(xrayOutboundTemp);
        let remark = `⭐️⭐️⭐️ ${addr}`;
        delete outbound.mux;
        delete outbound.streamSettings.grpcSettings;
        delete outbound.streamSettings.realitySettings;
        delete outbound.streamSettings.tcpSettings;
        outbound.settings.vnext[0].address = addr;
        outbound.settings.vnext[0].port = 443;
        outbound.settings.vnext[0].users[0].id = userID;
        outbound.streamSettings.tlsSettings.serverName = randomUpperCase(hostName);
        outbound.streamSettings.wsSettings.headers.Host = randomUpperCase(hostName);
        outbound.streamSettings.wsSettings.path = `/${getRandomPath(16)}?ed=2560`;
        
        fragConfig.remarks = remark.length <= 30 ? remark : `${remark.slice(0,29)}...`;;
        fragConfig.dns.servers[0] = remoteDNS;
        fragConfig.dns.servers[1].address = localDNS;
        fragConfig.outbounds[0].settings.fragment.length = `${lengthMin}-${lengthMax}`;
        fragConfig.outbounds[0].settings.fragment.interval = `${intervalMin}-${intervalMax}`;
        fragConfig.routing.rules[0].ip = [localDNS];

        if (proxyOutbound) {
            fragConfig.outbounds = [{...proxyOutbound}, { ...outbound}, ...fragConfig.outbounds];
        } else {
            fragConfig.outbounds = [{ ...outbound}, ...fragConfig.outbounds];
        }

        delete fragConfig.observatory;
        delete fragConfig.routing.balancers;
        fragConfig.routing.rules.pop();

        if (localDNS === 'localhost' && bypassIran) {
            fragConfig.dns.servers.pop();
            fragConfig.routing.rules.splice(0,1);
        }

        if (!bypassIran) {
            fragConfig.dns.servers.pop();
            fragConfig.routing.rules.splice(0,2);
            fragConfig.routing.rules[0].ip = ["geoip:private"];
        }

        if (!blockAds) {
            delete fragConfig.dns.hosts;
            fragConfig.routing.rules.pop();
        }

        if (client === 'nekoray') {
            fragConfig.inbounds[0].port = 2080;
            fragConfig.inbounds[1].port = 2081;
        }
                    
        Configs.push({
            address: addr,
            config: fragConfig
        }); 

        outbound.tag = `proxy_${index + 1}`;
    
        if (proxyOutbound) {
            let proxyOut = structuredClone(proxyOutbound);
            proxyOut.tag = `out_${index + 1}`;
            proxyOut.streamSettings.sockopt.dialerProxy = `proxy_${index + 1}`;
            outbounds.push({...proxyOut}, {...outbound});
        } else {
            outbounds.push({...outbound});
        }
    });


    let bestPing = structuredClone(xrayConfigTemp);
    bestPing.remarks = '⭐️⭐️⭐️ Best Ping';
    bestPing.dns.servers[0] = remoteDNS;
    bestPing.dns.servers[1].address = localDNS;
    bestPing.outbounds[0].settings.fragment.length = `${lengthMin}-${lengthMax}`;
    bestPing.outbounds[0].settings.fragment.interval = `${intervalMin}-${intervalMax}`;
    bestPing.routing.rules[0].ip = [localDNS];
    bestPing.outbounds = [...outbounds, ...bestPing.outbounds];
    
    if (!blockAds) {
        delete bestPing.dns.hosts;
        bestPing.routing.rules.splice(3,1);
    }

    if (localDNS === 'localhost' && bypassIran) {
        bestPing.dns.servers.pop();
        bestPing.routing.rules.splice(0,1);
    }
    
    if (!bypassIran) {
        bestPing.dns.servers.pop();
        bestPing.routing.rules.splice(0,2);
        bestPing.routing.rules[0].ip = ["geoip:private"];
    }
    
    if (proxyOutbound) {
        bestPing.observatory.subjectSelector = ["out"];
        bestPing.routing.balancers[0].selector = ["out"];
    }

    if (client === 'nekoray') {
        bestPing.inbounds[0].port = 2080;
        bestPing.inbounds[1].port = 2081;
    }

    const workerLessConfig = await buildWorkerLessConfig(env, client);
    
    Configs.push(
        { address: 'Best-Ping', config: bestPing}, 
        //{ address: 'WorkerLess', config: workerLessConfig}
    );

    return Configs;
}

const getSingboxConfig = async (env, hostName) => {
    const {
        remoteDNS, 
        localDNS,
        cleanIPs
    } = await env.bpb.get("proxySettings", {type: 'json'});

    let config = structuredClone(singboxConfigTemp);
    config.dns.servers[0].address = remoteDNS;
    config.dns.servers[1].address = localDNS;

    const resolved = await resolveDNS(hostName);
    const Addresses = [
        hostName,
        "www.speedtest.net",
        ...(cleanIPs ? cleanIPs.split(",") : []),
        ...resolved.ipv4,
        ...resolved.ipv6.map((ip) => `[${ip}]`),
    ];

    Addresses.forEach(addr => {
        let outbound = structuredClone(singboxOutboundTemp);
        outbound.server = addr;
        outbound.tag = addr;
        outbound.uuid = userID;
        outbound.tls.server_name = randomUpperCase(hostName);
        outbound.transport.headers.Host = randomUpperCase(hostName);
        outbound.transport.path += getRandomPath(16);
        config.outbounds.push(outbound);
        config.outbounds[0].outbounds.push(addr);
        config.outbounds[1].outbounds.push(addr);
    });

    return config;
}

const updateDataset = async (env, Settings) => {

    const vlessConfig = Settings?.get('outProxy');
    const proxySettings = {
        remoteDNS: Settings?.get('remoteDNS') || 'https://94.140.14.14/dns-query',
        localDNS: Settings?.get('localDNS') || '8.8.8.8',
        lengthMin: Settings?.get('fragmentLengthMin') || '100',
        lengthMax: Settings?.get('fragmentLengthMax') || '200',
        intervalMin: Settings?.get('fragmentIntervalMin') || '5',
        intervalMax: Settings?.get('fragmentIntervalMax') || '10',
        blockAds: Settings?.get('block-ads') || false,
        bypassIran: Settings?.get('bypass-iran') || false,
        cleanIPs: Settings?.get('cleanIPs')?.replaceAll(' ', '') || '',
        outProxy: vlessConfig || '',
        outProxyParams: vlessConfig ? await extractVlessParams(vlessConfig) : ''
    };

    try {    
        await env.bpb.put("proxySettings", JSON.stringify(proxySettings));          
    } catch (error) {
        throw new error(error);
    }
}

const randomUpperCase = (str) => {
    let result = '';
    for (let i = 0; i < str.length; i++) {
        result += Math.random() < 0.5 ? str[i].toUpperCase() : str[i];
    }
    return result;
}

const getRandomPath = (length) => {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

const resolveDNS = async (domain) => {
    const dohURLv4 = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`;
    const dohURLv6 = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=AAAA`;

    try {
        const [ipv4Response, ipv6Response] = await Promise.all([
            fetch(dohURLv4, { headers: { accept: 'application/dns-json' } }),
            fetch(dohURLv6, { headers: { accept: 'application/dns-json' } }),
        ]);

        const ipv4Addresses = await ipv4Response.json();
        const ipv6Addresses = await ipv6Response.json();

        const ipv4 = ipv4Addresses.Answer
            ? ipv4Addresses.Answer.map((record) => record.data)
            : [];
        const ipv6 = ipv6Addresses.Answer
            ? ipv6Addresses.Answer.map((record) => record.data)
            : [];

        return { ipv4, ipv6 };
    } catch (error) {
        console.error('Error resolving DNS:', error);
    }
}

const generateJWTToken = (password, secretKey) => {
    const header = {
        alg: 'HS256',
        typ: 'JWT'
    };

    const payload = {
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60),
        data: { password }
    };
    const encodedHeader = btoa(JSON.stringify(header));
    const encodedPayload = btoa(JSON.stringify(payload));
    const signature = btoa(crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${encodedHeader}.${encodedPayload}.${secretKey}`)));

    return `Bearer ${encodedHeader}.${encodedPayload}.${signature}`;
}

const generateSecretKey = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
  
const Authenticate = async (request, env) => {
    const secretKey = await env.bpb.get('secretKey');

    try {
        const cookie = request.headers.get('Cookie');
        const cookieMatch = cookie ? cookie.match(/(^|;\s*)jwtToken=([^;]*)/) : null;
        const token = cookieMatch ? cookieMatch.pop() : null;

        if (!token) return false;

        const tokenWithoutBearer = token.startsWith('Bearer ') ? token.slice(7) : token;
        const [encodedHeader, encodedPayload, signature] = tokenWithoutBearer.split('.');
        const payload = JSON.parse(atob(encodedPayload));

        const expectedSignature = btoa(crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(`${encodedHeader}.${encodedPayload}.${secretKey}`)
        ));

        if (signature !== expectedSignature) return false;

        const now = Math.floor(Date.now() / 1000);
        if (payload.exp < now) return false;

        return true;
    } catch (error) {
        return false;
    }
}

const renderHomePage = async (env, hostName, fragConfigs) => {
    const {
        remoteDNS, 
        localDNS, 
        lengthMin, 
        lengthMax, 
        intervalMin, 
        intervalMax, 
        blockAds,
        bypassIran,
        cleanIPs,
        outProxy
    } = await env.bpb.get("proxySettings", {type: 'json'});

    const genCustomConfRow = async (configs) => {
        let tableBlock = "";
        configs.forEach(config => {
            tableBlock += `
            <tr>
                <td>
                    ${config.address === 'Best-Ping' 
                        ? `<div  style="justify-content: center;"><span class="material-symbols-outlined">speed</span><span>&nbsp;<b>Best-Ping</b></span></div>` 
                        : config.address === 'WorkerLess'
                            ? `<div  style="justify-content: center;"><span class="material-symbols-outlined">star</span><span>&nbsp;<b>WorkerLess</b></span></div>`
                            : config.address
                    }
                </td>
                <td>
                    <button onclick="copyToClipboard('${encodeURIComponent(JSON.stringify(config.config, null, 4))}', true)">
                        Copy Config 
                        <span class="material-symbols-outlined">copy_all</span>
                    </button>
                </td>
            </tr>`;
        });

        return tableBlock;
    }

    const html = `
    <!DOCTYPE html>
    <html lang="en">

	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
		<style>
			body { font-family: system-ui; }
            .material-symbols-outlined {
                margin-left: 5px;
                font-variation-settings:
                'FILL' 0,
                'wght' 400,
                'GRAD' 0,
                'opsz' 24
            }
            h1 { font-size: 2.5em; text-align: center; color: #09639f }
			h2 { margin: 30px 0; text-align: center; color: #3b3b3b; }
			hr { border: 1px solid #ddd; margin: 20px 0; }
            .footer {
                display: flex;
                font-weight: 600;
                margin: 10px auto 0 auto;
                justify-content: center;
                align-items: center;
            }
            .footer button {margin: 0 20px; background: #212121; max-width: fit-content;}
            .footer button:hover, .footer button:focus { background: #3b3b3b;}
            .form-control a, a.link { text-decoration: none; }
			.form-control {
				margin-bottom: 15px;
				display: grid;
				grid-template-columns: 1fr 1fr;
				align-items: baseline;
				justify-content: flex-end;
				font-family: Arial, sans-serif;
			}
            .form-control button {
                background-color: white;
                font-size: 1.1rem;
                font-weight: 600;
                color: #09639f;
                border-color: #09639f;
                border: 2px solid;
            }
            #apply {display: block; margin-top: 30px;}
            input.button {font-weight: 600; padding: 15px 0; font-size: 1.1rem;}
			label {
				display: block;
				margin-bottom: 5px;
				font-size: 110%;
				font-weight: 600;
				color: #333;
			}
			input[type="text"],
			input[type="number"],
			input[type="url"],
			textarea,
			select {
				width: 100%;
				text-align: center;
				padding: 10px;
				border: 1px solid #ddd;
				border-radius: 5px;
				font-size: 16px;
				color: #333;
				background-color: #fff;
				box-sizing: border-box;
				margin-bottom: 15px;
				transition: border-color 0.3s ease;
			}	
			input[type="text"]:focus,
			input[type="number"]:focus,
			input[type="url"]:focus,
			textarea:focus,
			select:focus { border-color: #3498db; outline: none; }
			.button,
			table button {
				display: flex;
                align-items: center;
                justify-content: center;
                width: 100%;
				white-space: nowrap;
				padding: 10px 20px;
				font-size: 16px;
                font-weight: 600;
				letter-spacing: 1px;
				border: none;
				border-radius: 5px;
				color: #fff;
				background-color: #09639f;
				cursor: pointer;
				outline: none;
				box-shadow: 0 5px 10px rgba(0, 0, 0, 0.2);
				transition: all 0.3s ease;
			}
            table button { margin: auto; width: auto; }
            .button.disabled {
                background-color: #ccc;
                cursor: not-allowed;
                box-shadow: none;
                pointer-events: none;
            }
			.button:hover,
			.button:focus,
			table button:hover,
			table button:focus {
				background-color: #2980b9;
				box-shadow: 0 8px 15px rgba(0, 0, 0, 0.3);
				transform: translateY(-2px);
			}
            button.button:hover { color: white; }
			.button:active,
			table button:active { transform: translateY(1px); box-shadow: 0 3px 7px rgba(0, 0, 0, 0.3); }
			.form-container {
				max-width: 90%;
				margin: 0 auto;
				padding: 20px;
				background: #f9f9f9;
				border: 1px solid #eaeaea;
				border-radius: 10px;
				box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
			}
			.table-container { margin-top: 20px; overflow-x: auto; }
			table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
			th, td { padding: 8px 15px; border-bottom: 1px solid #ddd; }
            td div { display: flex; align-items: center; }
			th { background-color: #3498db; color: white; font-weight: bold; font-size: 1.1rem; width: 50%;}
			tr:nth-child(odd) { background-color: #f2f2f2; }
            #custom-configs-table td { text-align: center; }
			tr:hover { background-color: #f1f1f1; }
            .modal {
                display: none;
                position: fixed;
                z-index: 1;
                left: 0;
                top: 0;
                width: 100%;
                height: 100%;
                overflow: auto;
                background-color: rgba(0, 0, 0, 0.4);
            }
            .modal-content {
                background-color: #f9f9f9;
                margin: auto;
                padding: 20px;
                border: 1px solid #eaeaea;
                border-radius: 10px;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                width: 80%;
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
            }
            .close { color: #aaa; float: right; font-size: 28px; font-weight: bold; }
            .close:hover,
            .close:focus { color: black; text-decoration: none; cursor: pointer; }
            .form-control label {
                display: block;
                margin-bottom: 5px;
                font-size: 110%;
                font-weight: 600;
                color: #333;
            }
            .form-control input[type="password"] {
                width: 100%;
                padding: 10px;
                border: 1px solid #ddd;
                border-radius: 5px;
                font-size: 16px;
                color: #333;
                background-color: #fff;
                box-sizing: border-box;
                margin-bottom: 15px;
                transition: border-color 0.3s ease;
            }
            .routing { display: flex; justify-content: center; align-items: center; margin-bottom: 15px; }
            .routing label { margin: 0; font-weight: 400; font-size: 100%; }
            .form-control input[type="password"]:focus { border-color: #3498db; outline: none; }
            #passwordError { color: red; margin-bottom: 10px; }
            .symbol { margin-right: 8px; }
            @media only screen and (min-width: 768px) {
                .form-container { max-width: 70%; }
                #apply { display: block; margin: 30px auto 0 auto; max-width: 50%; }
                .modal-content { width: 30% }
            }
		</style>
	</head>
	
	<body>
		<h1> Panel <span style="font-size: smaller;">${panelVersion}</span> UINET</h1>
		<div class="form-container">
            <h2>FRAGMENT SETTINGS⚙️</h2>
			<form id="configForm">
				<div class="form-control">
					<label for="remoteDNS">🌏 Remote DNS</label>
					<input type="url" id="remoteDNS" name="remoteDNS" value="${remoteDNS}" required>
				</div>
				<div class="form-control">
					<label for="localDNS">🏚️ Local DNS</label>
					<input type="text" id="localDNS" name="localDNS" value="${localDNS}"
						pattern="^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|localhost$"
						title="Please enter a valid DNS IP Address or localhost!"  required>
				</div>	
				<div class="form-control">
					<label for="fragmentLengthMin">📐 Length</label>
					<div style="display: grid; grid-template-columns: 1fr auto 1fr; align-items: baseline;">
						<input type="number" id="fragmentLengthMin" name="fragmentLengthMin" value="${lengthMin}" min="10" required>
						<span style="text-align: center; white-space: pre;"> - </span>
						<input type="number" id="fragmentLengthMax" name="fragmentLengthMax" value="${lengthMax}" max="500" required>
					</div>
				</div>
				<div class="form-control">
					<label for="fragmentIntervalMin">🕞 Interval</label>
					<div style="display: grid; grid-template-columns: 1fr auto 1fr; align-items: baseline;">
						<input type="number" id="fragmentIntervalMin" name="fragmentIntervalMin"
						value="${intervalMin}" max="30" required>
						<span style="text-align: center; white-space: pre;"> - </span>
						<input type="number" id="fragmentIntervalMax" name="fragmentIntervalMax"
						value="${intervalMax}" max="30" required>
					</div>
				</div>
				<div class="form-control">
					<label for="outProxy">✈️ Chain Proxy</label>
					<input type="text" id="outProxy" name="outProxy" value="${outProxy}">
				</div>
                <h2>ROUTING RULES ⚙️</h2>
				<div class="form-control" style="margin-bottom: 20px;">			
                    <div class="routing">
                        <input type="checkbox" id="block-ads" name="block-ads" style="margin: 0 10px 0 0;" value="true" ${blockAds ? 'checked' : ''}>
                        <label for="block-ads">Block Ads</label>
                    </div>
                    <div class="routing">
						<input type="checkbox" id="bypass-iran" name="bypass-iran" style="margin: 0 10px 0 0;;" value="true" ${bypassIran ? 'checked' : ''}>
                        <label for="bypass-iran">Direct Iran</label>
					</div>
				</div>
                <h2>CLEAN IP ⚙️</h2>
				<div class="form-control">
					<label for="cleanIPs">✨ Clean IPs</label>
					<input type="text" id="cleanIPs" name="cleanIPs" value="${cleanIPs.replaceAll(",", " , ")}">
				</div>
                <div class="form-control">
                    <label>🔎 Online Scanner</label>
                    <a href="https://scanner.github1.cloud/" id="scanner" name="scanner" target="_blank">
                        <button type="button" class="button">
                            Scan now
                            <span class="material-symbols-outlined" style="margin-left: 5px;">open_in_new</span>
                        </button>
                    </a>
                </div>
				<div id="apply" class="form-control">
					<div style="grid-column: 2; width: 100%;">
						<input type="submit" id="applyButton" class="button disabled" value="APPLY SETTINGS 💥" form="configForm">
					</div>
				</div>
			</form>
            <hr>
            
			<h2>NORMAL CONFIGS 🔗</h2>
			<div class="table-container">
				<table id="normal-configs-table">
					<tr>
						<th>Application</th>
						<th>Subscription</th>
					</tr>
					<tr>
                        <td>
                            <div>
                                <span class="material-symbols-outlined symbol">verified</span>
                                <span>v2rayNG</span>
                            </div>
                            <div>
                                <span class="material-symbols-outlined symbol">verified</span>
                                <span>v2rayN</span>
                            </div>
                            <div>
                                <span class="material-symbols-outlined symbol">verified</span>
                                <span>Shadowrocket</span>
                            </div>
                            <div>
                                <span class="material-symbols-outlined symbol">verified</span>
                                <span>Streisand</span>
                            </div>
                            <div>
                                <span class="material-symbols-outlined symbol">verified</span>
                                <span>Nekoray (Xray)</span>
                            </div>
                        </td>
						<td>
                            <button onclick="copyToClipboard('https://${hostName}/sub/${userID}#TelegramID:@uinet_bot-(Normal)', false)">
                                Copy Sub
                                <span class="material-symbols-outlined">format_list_bulleted</span>
                            </button>
                        </td>
					</tr>
					<tr>
                        <td>
                            <div>
                                <span class="material-symbols-outlined symbol">verified</span>
                                <span>Nekobox</span>
                            </div>
                            <div>
                                <span class="material-symbols-outlined symbol">verified</span>
                                <span>Hiddify Next</span>
                            </div>
                            <div>
                                <span class="material-symbols-outlined symbol">verified</span>
                                <span>Nekoray (Sing-Box)</span>
                            </div>
                        </td>
						<td>
                            <button onclick="copyToClipboard('https://${hostName}/sub/${userID}#TelegramID:@uinet_bot-(Normal)', false)">
                                Copy Sub
                                <span class="material-symbols-outlined">format_list_bulleted</span>
                            </button>
						</td>
					</tr>
                    <tr>
                        <td>
                            <div>
                                <span class="material-symbols-outlined symbol">verified</span>
                                <span>Sing-box - <b>Best Ping</b></span>
                            </div>
                        </td>
                        <td>
                            <button onclick="copyToClipboard('https://${hostName}/sub/${userID}#TelegramID:@uinet_bot(Normal)', false)">
                                Copy Sub
                                <span class="material-symbols-outlined">format_list_bulleted</span>
                            </button>
                        </td>
                    </tr>
				</table>
			</div>
			<hr>
			<h2>FRAGMENT SUB ⛓️</h2>
			<div class="table-container">
                <table id="frag-sub-table">
                    <tr>
                        <th style="text-wrap: nowrap;">Application</th>
                        <th style="text-wrap: nowrap;">Fragment Subscription</th>
                    </tr>
                    <tr>
                        <td style="text-wrap: nowrap;">
                            <div>
                                <span class="material-symbols-outlined symbol">verified</span>
                                <span>v2rayNG</span>
                            </div>
                            <div>
                                <span class="material-symbols-outlined symbol">verified</span>
                                <span>v2rayN</span>
                            </div>
                            <div>
                                <span class="material-symbols-outlined symbol">verified</span>
                                <span>Streisand</span>
                            </div>
                        </td>
                        <td>
                            <button onclick="copyToClipboard('https://${hostName}/fragsub/${userID}#TelegramID:@uinet_bot-(Anti-filter)', true)">
                                Copy Sub
                                <span class="material-symbols-outlined">format_list_bulleted</span>
                            </button>
                        </td>
                    </tr>
                </table>
            </div>
            <h2>FRAGMENT - NEKORAY ⛓️</h2>
            <div class="table-container">
				<table id="custom-configs-table">
					<tr style="text-wrap: nowrap;">
						<th>Config Address</th>
						<th>Fragment Config</th>
					</tr>					
					${await genCustomConfRow(fragConfigs)}
				</table>
			</div>
            <div id="myModal" class="modal">
                <div class="modal-content">
                <span class="close">&times;</span>
                <form id="passwordChangeForm">
                    <h2>Change Password</h2>
                    <div class="form-control">
                        <label for="newPassword">New Password</label>
                        <input type="password" id="newPassword" name="newPassword" required>
                        </div>
                    <div class="form-control">
                        <label for="confirmPassword">Confirm Password</label>
                        <input type="password" id="confirmPassword" name="confirmPassword" required>
                    </div>
                    <div id="passwordError" style="color: red; margin-bottom: 10px;"></div>
                    <button id="changePasswordBtn" type="submit" class="button">Change Password</button>
                </form>
                </div>
            </div>
            <div class="footer">
                <i class="fa fa-github" style="font-size:36px; margin-right: 10px;"></i>
                <a class="link" href="https://github.com/bia-pain-bache/BPB-Worker-Panel" target="_blank">Github</a>
                <button id="openModalBtn" class="button">Change Password</button>
                <button type="button" id="logout" style="background: none; margin: 0; border: none; cursor: pointer;">
                    <i class="fa fa-power-off fa-2x" aria-hidden="true"></i>
                </button>
            </div>
        </div>

	<script>
		document.addEventListener('DOMContentLoaded', () => {
            const configForm = document.getElementById('configForm');            
            const modal = document.getElementById('myModal');
            const changePass = document.getElementById("openModalBtn");
            const closeBtn = document.querySelector(".close");
            const passwordChangeForm = document.getElementById('passwordChangeForm');            
            const applyBtn = document.getElementById('applyButton');         
            const initialFormData = new FormData(configForm);
          
            const hasFormDataChanged = () => {
                const currentFormData = new FormData(configForm);
                const currentFormDataEntries = [...currentFormData.entries()];

                const nonCheckboxFieldsChanged = currentFormDataEntries.some(
                    ([key, value]) => !initialFormData.has(key) || initialFormData.get(key) !== value
                );

                const checkboxFieldsChanged = Array.from(configForm.elements)
                    .filter((element) => element.type === 'checkbox')
                    .some((checkbox) => {
                    const initialValue = initialFormData.has(checkbox.name)
                        ? initialFormData.get(checkbox.name)
                        : false;
                    const currentValue = currentFormDataEntries.find(([key]) => key === checkbox.name)?.[1] || false;
                    return initialValue !== currentValue;
                });

                return nonCheckboxFieldsChanged || checkboxFieldsChanged;
            };
          
            const enableApplyButton = () => {
                const isChanged = hasFormDataChanged();
                applyButton.disabled = !isChanged;
                applyButton.classList.toggle('disabled', !isChanged);
            };
                      
            passwordChangeForm.addEventListener('submit', event => resetPassword(event));
            document.getElementById('logout').addEventListener('click', event => logout(event));
			configForm.addEventListener('submit', (event) => applySettings(event, configForm));
            configForm.addEventListener('input', enableApplyButton);
            configForm.addEventListener('change', enableApplyButton);
            changePass.addEventListener('click', () => {
                modal.style.display = "block";
                document.body.style.overflow = "hidden";
            });        
            closeBtn.addEventListener('click', () => {
                modal.style.display = "none";
                document.body.style.overflow = "";
            });

		});

		const copyToClipboard = (text, decode) => {
            const textarea = document.createElement('textarea');
            const value = decode ? decodeURIComponent(text) : text;
			textarea.value = value;
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			document.body.removeChild(textarea);
			alert('📋 Copied to clipboard:\\n\\n' +  value);
		}

        const applySettings = async (event, configForm) => {
            event.preventDefault();
            event.stopPropagation();
            const applyButton = document.getElementById('applyButton');
            const getValue = (id) => parseInt(document.getElementById(id).value, 10);              
            const lengthMin = getValue('fragmentLengthMin');
            const lengthMax = getValue('fragmentLengthMax');
            const intervalMin = getValue('fragmentIntervalMin');
            const intervalMax = getValue('fragmentIntervalMax');
            const cleanIP = document.getElementById('cleanIPs');
            const cleanIPs = cleanIP.value?.split(',');
            const chainProxy = document.getElementById('outProxy').value?.trim();                    
            const formData = new FormData(configForm);
            const isVless = /vless:\\/\\/[^\s@]+@[^\\s:]+:[^\\s]+/.test(chainProxy);
            const hasSecurity = /security=/.test(chainProxy);
            const validSecurityType = /security=(tls|none|reality)/.test(chainProxy);
            const validTransmission = /type=(tcp|grpc|ws)/.test(chainProxy);

            const invalidIPs = cleanIPs?.filter(value => {
                if (value !== "") {
                    const trimmedValue = value.trim();
                    return !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}|(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(trimmedValue);
                }
            });
    
            if (invalidIPs.length) {
                alert('⛔ Invalid IPs or Domains 🫤\\n\\n' + invalidIPs.map(ip => '⚠️ ' + ip).join('\\n'));
                return false;
            }

            if (lengthMin >= lengthMax || intervalMin > intervalMax) {
                alert('⛔ Minimum should be smaller or equal to Maximum! 🫤');               
                return false;
            }

            if (!(isVless && (hasSecurity && validSecurityType || !hasSecurity) && validTransmission) && chainProxy) {
                alert('⛔ Invalid Config! 🫤 \\n - The chain proxy should be VLESS!\\n - Transmission should be GRPC,WS or TCP\\n - Security should be TLS,Reality or None');               
                return false;
            }

            try {
                document.body.style.cursor = 'wait';
                const applyButtonVal = applyButton.value;
                applyButton.value = '⌛ Loading...';

                const response = await fetch('/panel', {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                });

                document.body.style.cursor = 'default';
                applyButton.value = applyButtonVal;

                if (response.ok) {
                    alert('Parameters applied successfully 😎');
                    window.location.reload(true);
                } else {
                    const errorMessage = await response.text();
                    console.error(errorMessage, response.status);
                    alert('⚠️ Session expired! Please login again.');
                    window.location.href = '/login';
                }           
            } catch (error) {
                console.error('Error:', error);
            }
        }

        const logout = async (event) => {
            event.preventDefault();

            try {
                const response = await fetch('/logout', {
                    method: 'GET',
                    credentials: 'same-origin'
                });
            
                if (response.ok) {
                    window.location.href = '/login';
                } else {
                    console.error('Failed to log out:', response.status);
                }
            } catch (error) {
                console.error('Error:', error);
            }
        }

        const resetPassword = async (event) => {
            event.preventDefault();
            const modal = document.getElementById('myModal');
            const newPasswordInput = document.getElementById('newPassword');
            const confirmPasswordInput = document.getElementById('confirmPassword');
            const passwordError = document.getElementById('passwordError');             
            const newPassword = newPasswordInput.value;
            const confirmPassword = confirmPasswordInput.value;
    
            if (newPassword !== confirmPassword) {
                passwordError.textContent = "Passwords do not match";
                return false;
            }

            const hasCapitalLetter = /[A-Z]/.test(newPassword);
            const hasNumber = /[0-9]/.test(newPassword);
            const isLongEnough = newPassword.length >= 8;

            if (!(hasCapitalLetter && hasNumber && isLongEnough)) {
                passwordError.textContent = '⚠️ Password must contain at least one capital letter, one number, and be at least 8 characters long.';
                return false;
            }
                    
            try {
                const response = await fetch('/panel/password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'text/plain'
                    },
                    body: newPassword,
                    credentials: 'same-origin'
                });
            
                if (response.ok) {
                    modal.style.display = "none";
                    document.body.style.overflow = "";
                    alert("Password changed successfully! 👍");
                    window.location.href = '/login';
                } else if (response.status === 401) {
                    const errorMessage = await response.text();
                    passwordError.textContent = '⚠️ ' + errorMessage;
                    console.error(errorMessage, response.status);
                    alert('⚠️ Session expired! Please login again.');
                    window.location.href = '/login';
                } else {
                    const errorMessage = await response.text();
                    passwordError.textContent = '⚠️ ' + errorMessage;
                    console.error(errorMessage, response.status);
                    return false;
                }
            } catch (error) {
                console.error('Error:', error);
            }
        }
	</script>
	</body>	
	</html>`;

    return html;
}

const renderLoginPage = async () => {
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>User Login</title>
    <style>

        html, body { height: 100%; margin: 0; }
        body {
            font-family: system-ui;
            background-color: #f9f9f9;
            position: relative;
            overflow: hidden;
        }
        .container {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 90%;
        }        
        h1 {
            text-align: center;
            color: #2980b9;
            margin-bottom: 30px;
            margin-top: 0px;
        }
        h2 {text-align: center;}
        .form-container {
            background: #f9f9f9;
            border: 1px solid #eaeaea;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            padding: 20px;
        }
        .form-control { margin-bottom: 15px; display: flex; align-items: center; }
        label {
            display: block;
            margin-bottom: 5px;
            padding-right: 20px;
            font-size: 110%;
            font-weight: 600;
            color: #333;
        }
        input[type="text"],
        input[type="password"] {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 5px;
            color: #333;
        }
        button {
            display: block;
            width: 100%;
            padding: 10px;
            font-size: 16px;
            font-weight: 600;
            border: none;
            border-radius: 5px;
            color: #fff;
            background-color: #09639f;
            cursor: pointer;
            transition: background-color 0.3s ease;
        }
        button:hover {background-color: #2980b9;}
        @media only screen and (min-width: 768px) {
            .container { width: 30%; }
        }
    </style>
    </head>
    <body>
        <div class="container">
            <h1>BPB Panel <span style="font-size: smaller;">${panelVersion}</span> UINET</h1>
            <div class="form-container">
                <h2>User Login</h2>
                <form id="loginForm">
                    <div class="form-control">
                        <label for="password">Password</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    <div id="passwordError" style="color: red; margin-bottom: 10px;"></div>
                    <button type="submit" class="button">Login</button>
                </form>
            </div>
        </div>
    <script>
        document.getElementById('loginForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const password = document.getElementById('password').value;

            try {
                const response = await fetch('/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'text/plain'
                    },
                    body: password
                });
            
                if (response.ok) {
                    window.location.href = '/panel';
                } else {
                    passwordError.textContent = '⚠️ Wrong Password!';
                    const errorMessage = await response.text();
                    console.error('Login failed:', errorMessage);
                }
            } catch (error) {
                console.error('Error during login:', error);
            }
        });
    </script>
    </body>
    </html>`;

    return html;
}

const renderErrorPage = (message, error) => {
    return `
    <!DOCTYPE html>
    <html lang="en">

    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error Page</title>
        <style>
            body,
            html {
                height: 100%;
                margin: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                font-family: system-ui;
            }
            h1 { text-align: center; color: #2980b9; font-size: 2.5rem; }
            #error-container { text-align: center; }
        </style>
    </head>

    <body>
        <div id="error-container">
            <h1>BPB Panel <span style="font-size: smaller;">${panelVersion}</span> UINET</h1>
            <div id="error-message">
                <h2>${message} Please try again or refer to <a href="https://github.com/bia-pain-bache/BPB-Worker-Panel/blob/main/README.md">documents</a></h2>
                <p><b>${error ? `⚠️ ${error}` : ''}</b></p>
            </div>
        </div>
    </body>

    </html>`;
}

const xrayConfigTemp = {
    remarks: "",
    dns: {
        hosts: {
            "geosite:category-ads-all": "127.0.0.1",
            "geosite:category-ads-ir": "127.0.0.1"
        },
        servers: [
            "",
            {
                address: "",
                domains: ["geosite:category-ir", "domain:.ir"],
                expectIPs: ["geoip:ir"],
                port: 53
            },
        ],
        queryStrategy: "UseIP",
        tag: "dns"
    },
    inbounds: [
        {
            port: 10808,
            protocol: "socks",
            settings: {
                auth: "noauth",
                udp: true,
                userLevel: 8,
            },
            sniffing: {
                destOverride: ["http", "tls", "fakedns"],
                enabled: true,
            },
            tag: "socks",
        },
        {
            port: 10809,
            protocol: "http",
            settings: {
                userLevel: 8,
            },
            tag: "http",
        },
    ],
    log: {
        loglevel: "warning",
    },
    outbounds: [
        {
            tag: "fragment",
            protocol: "freedom",
            settings: {
                fragment: {
                    packets: "tlshello",
                    length: "",
                    interval: "",
                },
            },
            streamSettings: {
                sockopt: {
                    tcpKeepAliveIdle: 100,
                    tcpNoDelay: true
                },
            },
        },
        {
            protocol: "freedom",
            settings: {
                domainStrategy: "UseIP",
            },
            tag: "direct",
        },
        {
            protocol: "blackhole",
            settings: {
                response: {
                    type: "http",
                },
            },
            tag: "block",
        }
    ],
    policy: {
        levels: {
            8: {
                connIdle: 300,
                downlinkOnly: 1,
                handshake: 4,
                uplinkOnly: 1,
            },
        },
        system: {
            statsOutboundUplink: true,
            statsOutboundDownlink: true,
        },
    },
    routing: {
        domainStrategy: "IPIfNonMatch",
        rules: [
            {
                ip: [],
                outboundTag: "direct",
                port: "53",
                type: "field",
            },
            {
                domain: ["geosite:category-ir", "domain:.ir"],
                outboundTag: "direct",
                type: "field",
            },
            {
                ip: ["geoip:private", "geoip:ir"],
                outboundTag: "direct",
                type: "field",
            },
            {
                domain: ["geosite:category-ads-all", "geosite:category-ads-ir"],
                outboundTag: "block",
                type: "field",
            },
            {
                balancerTag: "all",
                type: "field",
                network: "tcp,udp",
            }
        ],
        balancers: [
            {
                tag: "all",
                selector: ["proxy"],
                strategy: {
                    type: "leastPing",
                },
            },
        ],
    },
    observatory: {
        probeInterval: "3m",
        probeURL: "https://api.github.com/_private/browser/stats",
        subjectSelector: ["proxy"],
        EnableConcurrency: true,
    },
    stats: {},
};

const xrayOutboundTemp = 
{
    mux: {
        concurrency: 8,
        enabled: true,
        xudpConcurrency: 8,
        xudpProxyUDP443: "reject"
    },
    protocol: "vless",
    settings: {
        vnext: [
            {
                address: "",
                port: 443,
                users: [
                    {
                        encryption: "none",
                        flow: "",
                        id: "",
                        level: 8,
                        security: "auto"
                    }
                ]
            }
        ]
    },
    streamSettings: {
        network: "ws",
        security: "tls",
        sockopt: {
            dialerProxy: "fragment",
            tcpKeepAliveIdle: 100,
            tcpNoDelay: true
        },
        tlsSettings: {
            allowInsecure: false,
            fingerprint: "chrome",
            alpn: ["h2", "http/1.1"],
            serverName: ""
        },
        wsSettings: {
            headers: {
                Host: ""
            },
            path: ""
        },
        grpcSettings: {
            authority: "",
            multiMode: false,
            serviceName: ""
        },
        realitySettings: {
            fingerprint: "",
            publicKey: "",
            serverName: "",
            shortId: "",
            spiderX: ""
        },
        tcpSettings: {
            header: {
                request: {
                    headers: {
                        Host: []
                    },
                    method: "GET",
                    path: [],
                    version: "1.1"
                },
                response: {
                    headers: {
                        "Content-Type": ["application/octet-stream"]
                    },
                    reason: "OK",
                    status: "200",
                    version: "1.1"
                },
                type: "http"
            }
          }
    },
    tag: "proxy"
};

const singboxConfigTemp = {
    log: {
        level: "warn",
        timestamp: true
    },
    dns: {
        servers: [
            {
                tag: "dns-remote",
                address: "https://8.8.8.8/dns-query",
                address_resolver: "dns-direct"
            },
            {
                tag: "dns-direct",
                address: "8.8.8.8",
                address_resolver: "dns-local",
                detour: "direct"
            },
            {
                tag: "dns-local",
                address: "local",
                detour: "direct"
            },
            {
                tag: "dns-block",
                address: "rcode://success"
            }
        ],
        rules: [
            {
                domain_suffix: [".ir"],
                server: "dns-direct"
            },
            {
                outbound: "direct",
                server: "dns-direct"
            }
        ],
        independent_cache: true
    },
    inbounds: [
        {
            type: "direct",
            tag: "dns-in",
            listen: "127.0.0.1",
            listen_port: 6450,
            override_address: "8.8.8.8",
            override_port: 53
        },
        {
            type: "tun",
            tag: "tun-in",
            mtu: 9000,
            inet4_address: "172.19.0.1/28",
            auto_route: true,
            strict_route: true,
            endpoint_independent_nat: true,
            stack: "mixed",
            sniff: true,
            sniff_override_destination: false
        },
        {
            type: "mixed",
            tag: "mixed-in",
            listen: "127.0.0.1",
            listen_port: 2080,
            sniff: true,
            sniff_override_destination: false
        }
    ],
    outbounds: [
        {
            type: "selector",
            tag: "proxy",
            outbounds: ["Best-Ping"]
        },
        {
            type: "urltest",
            tag: "Best-Ping",
            outbounds: [],
            url: "https://www.gstatic.com/generate_204",
            interval: "3m",
            tolerance: 50
        },
        {
            type: "direct",
            tag: "direct"
        },
        {
            type: "block",
            tag: "block"
        },
        {
            type: "dns",
            tag: "dns-out"
        }
    ],
    route: {
        rules: [
            {
                port: 53,
                outbound: "dns-out"
            },
            {
                inbound: "dns-in",
                outbound: "dns-out"
            },
            {
                network: "udp",
                port: 443,
                port_range: [],
                outbound: "block"
            },
            {
                ip_is_private: true,
                outbound: "direct"
            },
            {
                rule_set: [
                    "geosite-category-ads-all",
                    "geosite-malware",
                    "geosite-phishing",
                    "geosite-cryptominers",
                    "geoip-malware",
                    "geoip-phishing"
                ],
                outbound: "block"
            },
            {
                rule_set: ["geosite-ir", "geoip-ir"],
                outbound: "direct"
            },
            {
                ip_cidr: ["224.0.0.0/3", "ff00::/8"],
                source_ip_cidr: ["224.0.0.0/3", "ff00::/8"],
                outbound: "block"
            }
        ],
        rule_set: [
            {
                type: "remote",
                tag: "geosite-ir",
                format: "binary",
                url: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-ir.srs",
                download_detour: "direct"
            },
            {
                type: "remote",
                tag: "geosite-category-ads-all",
                format: "binary",
                url: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-category-ads-all.srs",
                download_detour: "direct"
            },
            {
                type: "remote",
                tag: "geosite-malware",
                format: "binary",
                url: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-malware.srs",
                download_detour: "direct"
            },
            {
                type: "remote",
                tag: "geosite-phishing",
                format: "binary",
                url: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-phishing.srs",
                download_detour: "direct"
            },
            {
                type: "remote",
                tag: "geosite-cryptominers",
                format: "binary",
                url: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geosite-cryptominers.srs",
                download_detour: "direct"
            },
            {
                type: "remote",
                tag: "geoip-ir",
                format: "binary",
                url: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geoip-ir.srs",
                download_detour: "direct"
            },
            {
                type: "remote",
                tag: "geoip-malware",
                format: "binary",
                url: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geoip-malware.srs",
                download_detour: "direct"
            },
            {
                type: "remote",
                tag: "geoip-phishing",
                format: "binary",
                url: "https://raw.githubusercontent.com/Chocolate4U/Iran-sing-box-rules/rule-set/geoip-phishing.srs",
                download_detour: "direct"
            }
        ],
        auto_detect_interface: true,
        override_android_vpn: true,
        final: "proxy"
    },
    experimental: {
        clash_api: {
            external_controller: "0.0.0.0:9090",
            external_ui: "yacd",
            external_ui_download_url: "https://github.com/MetaCubeX/Yacd-meta/archive/gh-pages.zip",
            external_ui_download_detour: "direct",
            secret: "",
            default_mode: "rule"
        }
    }
};

const singboxOutboundTemp = {
    type: "vless",
    server: "",
    server_port: 443,
    uuid: "",
    domain_strategy: "prefer_ipv6",
    packet_encoding: "",
    tls: {
        alpn: [
            "http/1.1"
        ],
        enabled: true,
        insecure: false,
        server_name: "",
        utls: {
            enabled: true,
            fingerprint: "randomized"
        }
    },
    transport: {
        early_data_header_name: "Sec-WebSocket-Protocol",
        headers: {
            Host: ""
        },
        max_early_data: 2048,
        path: "/",
        type: "ws"
    },
    tag: ""
};
