import { config as loadEnv } from 'dotenv';
import { createApp } from './app';
import { mountFrontend } from './frontend';

loadEnv({ path: '.env.local', quiet: true });
const application = createApp({
  apiKey: process.env.OPENAI_API_KEY?.trim() ?? '',
  liveModel: process.env.OPENAI_LIVE_MODEL || 'gpt-live-1',
  realtimeModel: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
  textModel: process.env.OPENAI_TEXT_MODEL || 'gpt-5.6-luna',
});
mountFrontend(application.app);
const server = application.app.listen(3017,'127.0.0.1',() => console.info('Motion Atlas API / production frontend: http://127.0.0.1:3017'));
let stopping = false;
async function shutdown() {
  if(stopping) return;
  stopping = true;
  server.close();
  const results = await application.shutdown();
  if(results.some(result => result.status === 'rejected')) console.warn('Some voice sessions could not confirm finalization.');
  process.exitCode = 0;
}
process.once('SIGINT',() => void shutdown());
process.once('SIGTERM',() => void shutdown());
