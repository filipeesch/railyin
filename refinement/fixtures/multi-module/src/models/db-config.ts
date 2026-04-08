/** Database connection configuration. */
export class Config {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly ssl: boolean;

  constructor(opts?: { host?: string; port?: number; database?: string; ssl?: boolean }) {
    this.host = opts?.host ?? process.env.DB_HOST ?? "localhost";
    this.port = opts?.port ?? parseInt(process.env.DB_PORT ?? "5432", 10);
    this.database = opts?.database ?? process.env.DB_NAME ?? "app";
    this.ssl = opts?.ssl ?? process.env.DB_SSL === "true";
  }

  connectionString(): string {
    const proto = this.ssl ? "postgresql+ssl" : "postgresql";
    return `${proto}://${this.host}:${this.port}/${this.database}`;
  }
}
