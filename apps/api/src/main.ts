import { loadConfig } from './config.js';
import { createApp } from './app.factory.js';

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.PORT);
console.log(`API ouvindo em http://localhost:${config.PORT}/api`);
