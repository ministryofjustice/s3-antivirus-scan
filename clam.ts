import { Buffer } from "node:buffer";
import { createConnection } from "node:net";

// ClamAV connection configuration
const CLAMAV_HOST = Deno.env.get("CLAMAV_HOST") || "clamav";
const CLAMAV_PORT = parseInt(Deno.env.get("CLAMAV_PORT") || "3310");

export const streamToClamAv = async (
    stream: ReadableStream<Uint8Array>,
): Promise<{ isInfected: boolean; virusName?: string }> => {
    return new Promise((resolve, reject) => {
        const socket = createConnection(
            { host: CLAMAV_HOST, port: CLAMAV_PORT },
            () => {
                // Send the INSTREAM command to ClamAV
                socket.write("zINSTREAM\0");
    
                const reader = stream.getReader();
    
                const sendChunk = async () => {
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) {
                                // Send zero-length chunk to indicate end of stream
                                const sizeBuffer = Buffer.alloc(4);
                                sizeBuffer.writeUInt32BE(0, 0);
                                socket.write(sizeBuffer);
                                return;
                            }
        
                            // Send chunk size
                            const sizeBuffer = Buffer.alloc(4);
                            sizeBuffer.writeUInt32BE(value.length, 0);
                            socket.write(sizeBuffer);
        
                            // Send chunk data
                            socket.write(Buffer.from(value));
                        }
                    } catch (error) {
                        socket.destroy();
                        reject(error);
                    }
                };
    
                sendChunk();
            },
        );
    
        let responseData = "";
    
        socket.on("data", (data) => {
            responseData += data.toString();
        });
    
        socket.on("end", () => {
            // Parse ClamAV response
            // ClamAV responses end with null terminator, so we need to remove it
            const cleanedResponse = responseData.replace(/\0+$/, '').trim();
            
            // Example responses: 
            // Clean: "stream: OK"
            // Infected: "stream: Eicar-Test-Signature FOUND"
            const cleanMatch = cleanedResponse.match(/^stream:\s+OK$/i);
            const infectedMatch = cleanedResponse.match(/^stream:\s+(.+)\s+FOUND$/i);
            
            if (cleanMatch) {
                resolve({ isInfected: false });
            } else if (infectedMatch) {
                const virusName = infectedMatch[1];
                resolve({ isInfected: true, virusName });
            } else {
                reject(new Error(`Invalid ClamAV response: ${cleanedResponse} (raw: ${JSON.stringify(responseData)})`));
            }
        });
    
        socket.on("error", (err) => {
            socket.destroy();
            reject(err);
        });
    });
};
