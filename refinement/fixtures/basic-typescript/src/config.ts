/**
 * Application configuration.
 * Manages environment-specific settings.
 */
export class Config {
  readonly env: string;
  readonly port: number;
  readonly debug: boolean;

  constructor(env?: string) {
    this.env = env ?? process.env.NODE_ENV ?? "development";
    this.port = parseInt(process.env.PORT ?? "3000", 10);
    this.debug = this.env !== "production";
  }

  isProduction(): boolean {
    return this.env === "production";
  }

  toJSON() {
    return { env: this.env, port: this.port, debug: this.debug };
  }
}

export const defaultConfig = new Config();
