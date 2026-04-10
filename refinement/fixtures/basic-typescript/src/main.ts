import { defaultConfig } from "./config";

function greet(name: string): string {
  return `Hello, ${name}! Running in ${defaultConfig.env} mode on port ${defaultConfig.port}.`;
}

console.log(greet("World"));
