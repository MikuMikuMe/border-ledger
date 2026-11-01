import type {Server} from 'node:http';
export function createGatewayServer(handle?:(request:Request)=>Promise<Response>):Server;
