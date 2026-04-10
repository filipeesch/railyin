/** HTTP server configuration. */
export class Config {
  readonly host: string;
  readonly port: number;
  readonly timeout: number;
  readonly maxConnections: number;

  constructor() {
    this.host = process.env.SERVER_HOST ?? "0.0.0.0";
    this.port = parseInt(process.env.SERVER_PORT ?? "8080", 10);
    this.timeout = parseInt(process.env.SERVER_TIMEOUT ?? "30000", 10);
    this.maxConnections = parseInt(process.env.MAX_CONNECTIONS ?? "1000", 10);
  }

  listenAddress(): string {
    return `${this.host}:${this.port}`;
  }
}
