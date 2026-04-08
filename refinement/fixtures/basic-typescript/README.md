# Basic TypeScript Project

A sample TypeScript project for refinement scenario testing.

## API

### Config

```typescript
import { Config } from './src/config';

const config = new Config('production');
config.isProduction(); // true
config.port;           // 3000
```

## Setup

```bash
npm install
npm run build
npm start
```
