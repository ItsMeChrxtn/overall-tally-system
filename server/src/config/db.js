import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB(uri = env.mongoUri) {
  mongoose.set('strictQuery', true);
  const redacted = uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
  try {
    await mongoose.connect(uri);
    console.log(`[db] Connected to ${redacted}`);
  } catch (err) {
    console.error(`[db] Could not connect to ${redacted}: ${err.message}`);
    process.exit(1);
  }
}
